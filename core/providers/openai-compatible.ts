/**
 * OpenAI-compatible 适配器（首期唯一实现）。
 *
 * 安全要点：
 * - 发送前重新校验 Base URL，并自检 Key 没有被拼进地址；
 * - Key 只出现在 Authorization 头里，绝不进 URL、查询参数或错误文案；
 * - HTTP 错误只保留状态码与一个「形状受限」的错误标识，响应体原文一律不向上传；
 * - 请求体字段显式白名单构造，不接受调用方夹带任意参数；
 * - `credentials: 'omit'`，避免把任何 Cookie 带给模型服务商。
 *
 * 健壮性要点：
 * - SSE 分片在任意字节位置切断都能正确重组（见 sse.ts）；
 * - 区分「整体超时」「用户取消」「网络错误」三种失败；
 * - 流在未收到 [DONE]/finish_reason 时结束，报告为「不完整」而不是假装成功。
 */
import { containsSecret, normalizeBaseUrl } from '../config/validate';
import { extractSafeErrorDetail, httpError, messageForCode, ProviderError } from './errors';
import { SseParser } from './sse';
import type { ChatDelta, ChatRequest, ProviderAdapter } from './types';

const DEFAULT_TIMEOUT_MS = 120_000;
/** 读取错误响应体时的最大字节数，避免异常响应把内存撑爆。 */
const ERROR_BODY_MAX_BYTES = 8_192;

export interface AdapterDeps {
  /** 注入 fetch 以便单测；默认使用全局 fetch。 */
  fetchImpl?: typeof fetch;
  defaultTimeoutMs?: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** 从一条 SSE 事件负载里取出增量文本与结束原因。 */
interface ParsedChunk {
  text: string;
  finishReason: string | null;
}

function parseChunk(payload: string): ParsedChunk | null {
  let json: unknown;
  try {
    json = JSON.parse(payload);
  } catch {
    // 部分服务商会插入心跳或注释，无法解析就跳过，不中断整条流。
    return null;
  }
  if (!isRecord(json)) return null;

  // 少数服务商在 200 的流里塞错误对象，必须识别出来而不是当成空增量。
  if (isRecord(json.error)) {
    throw new ProviderError('server_error', messageForCode('server_error'));
  }

  const choices = json.choices;
  if (!Array.isArray(choices) || choices.length === 0) {
    return { text: '', finishReason: null };
  }

  const first = choices[0];
  if (!isRecord(first)) return { text: '', finishReason: null };

  const finishReason = typeof first.finish_reason === 'string' ? first.finish_reason : null;

  let text = '';
  const delta = first.delta;
  if (isRecord(delta) && typeof delta.content === 'string') {
    text = delta.content;
  } else {
    // 非流式但同样走 event-stream 的实现会放在 message.content 里。
    const message = first.message;
    if (isRecord(message) && typeof message.content === 'string') {
      text = message.content;
    }
  }

  return { text, finishReason };
}

function extractWholeContent(json: unknown): string | null {
  if (!isRecord(json)) return null;
  const choices = json.choices;
  if (!Array.isArray(choices) || choices.length === 0) return null;

  const first = choices[0];
  if (!isRecord(first)) return null;

  const message = first.message;
  if (isRecord(message) && typeof message.content === 'string') return message.content;

  const delta = first.delta;
  if (isRecord(delta) && typeof delta.content === 'string') return delta.content;

  const text = first.text;
  if (typeof text === 'string') return text;

  return null;
}

async function readLimitedText(response: Response): Promise<string> {
  try {
    const text = await response.text();
    return text.length > ERROR_BODY_MAX_BYTES ? text.slice(0, ERROR_BODY_MAX_BYTES) : text;
  } catch {
    return '';
  }
}

/**
 * 把底层异常归类为 ProviderError。
 *
 * 顺序很重要：先看我们自己置的超时标记，再看外部是否已取消，
 * 最后才按 AbortError/其它网络异常兜底——否则「用户取消」会被误报成超时。
 */
function classifyTransportError(
  error: unknown,
  timedOut: boolean,
  external: AbortSignal | undefined,
): ProviderError {
  if (timedOut) return new ProviderError('timeout', messageForCode('timeout'));
  if (external?.aborted) return new ProviderError('aborted', messageForCode('aborted'));

  const name = isRecord(error) && typeof error.name === 'string' ? error.name : '';
  if (name === 'AbortError') return new ProviderError('aborted', messageForCode('aborted'));

  return new ProviderError('network_error', messageForCode('network_error'));
}

/** 消费 event-stream 响应体，逐段 yield 文本。 */
async function* consumeEventStream(
  body: ReadableStream<Uint8Array>,
  classify: (error: unknown) => ProviderError,
): AsyncGenerator<ChatDelta, void, void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  const parser = new SseParser();

  let sawDone = false;
  let sawFinishReason = false;

  const handle = (payloads: string[]): ChatDelta[] => {
    const deltas: ChatDelta[] = [];
    for (const payload of payloads) {
      if (payload === '[DONE]') {
        sawDone = true;
        continue;
      }
      const chunk = parseChunk(payload);
      if (!chunk) continue;
      if (chunk.finishReason !== null) sawFinishReason = true;
      if (chunk.text.length > 0) deltas.push({ text: chunk.text });
    }
    return deltas;
  };

  try {
    while (!sawDone) {
      let result: ReadableStreamReadResult<Uint8Array>;
      try {
        result = await reader.read();
      } catch (error) {
        throw classify(error);
      }

      if (result.done) break;

      const text = decoder.decode(result.value, { stream: true });
      for (const delta of handle(parser.push(text))) yield delta;
    }

    for (const delta of handle(parser.flush())) yield delta;
  } finally {
    // 无论正常结束还是被取消，都要释放读取锁。
    try {
      await reader.cancel();
    } catch {
      // 流已关闭时 cancel 可能抛错，忽略即可。
    }
  }

  // 只有确实没有收到结束标记时才算「断流」。
  if (!sawDone && !sawFinishReason) {
    throw new ProviderError('incomplete_stream', messageForCode('incomplete_stream'));
  }
}

/** 非 event-stream 的响应：整体当 JSON 解析，一次性给出内容。 */
async function* consumeWholeJson(response: Response): AsyncGenerator<ChatDelta, void, void> {
  const text = await readLimitedText(response);

  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new ProviderError('invalid_response', messageForCode('invalid_response'));
  }

  if (isRecord(json) && isRecord(json.error)) {
    throw new ProviderError('server_error', messageForCode('server_error'));
  }

  const content = extractWholeContent(json);
  if (content === null) {
    throw new ProviderError('invalid_response', messageForCode('invalid_response'));
  }
  if (content.length > 0) yield { text: content };
}

export function createOpenAiCompatibleAdapter(deps: AdapterDeps = {}): ProviderAdapter {
  const fetchImpl = deps.fetchImpl ?? globalThis.fetch;
  const defaultTimeoutMs = deps.defaultTimeoutMs ?? DEFAULT_TIMEOUT_MS;

  return {
    id: 'openai-compatible',

    async *streamChat(request: ChatRequest): AsyncGenerator<ChatDelta, void, void> {
      const normalized = normalizeBaseUrl(request.baseUrl, {
        allowInsecureLocalDev: request.allowInsecureLocalDev === true,
      });
      if (!normalized.ok) {
        // 不把用户填的地址原文回显进错误里，避免它出现在日志或界面快照中。
        throw new ProviderError('not_configured', '服务商地址不合法，请到设置页检查。');
      }

      const apiKey = request.apiKey.trim();
      if (apiKey === '') {
        throw new ProviderError('not_configured', messageForCode('not_configured'));
      }

      const endpoint = `${normalized.url}/chat/completions`;

      // 纵深防御：即使前面的校验全都通过，也不允许 Key 出现在请求地址里。
      if (containsSecret(endpoint, apiKey)) {
        throw new ProviderError('invalid_request', '请求地址中包含敏感信息，已拒绝发送。');
      }

      const payload: Record<string, unknown> = {
        model: request.model,
        messages: request.messages.map((message) => ({
          role: message.role,
          content: message.content,
        })),
        stream: true,
      };
      // temperature 仅在用户显式配置时下发：不同服务商对它的支持程度不同。
      if (request.temperature !== undefined) {
        payload.temperature = request.temperature;
      }

      const controller = new AbortController();
      let timedOut = false;
      const external = request.signal;

      if (external?.aborted) {
        throw new ProviderError('aborted', messageForCode('aborted'));
      }

      const onExternalAbort = () => controller.abort();
      external?.addEventListener('abort', onExternalAbort, { once: true });

      const timer = setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, request.timeoutMs ?? defaultTimeoutMs);

      try {
        let response: Response;
        try {
          response = await fetchImpl(endpoint, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Accept: 'text/event-stream',
              Authorization: `Bearer ${apiKey}`,
            },
            body: JSON.stringify(payload),
            signal: controller.signal,
            // 不携带 Cookie，减少跨站信息泄露面。
            credentials: 'omit',
            cache: 'no-store',
          });
        } catch (error) {
          throw classifyTransportError(error, timedOut, external);
        }

        if (!response.ok) {
          const body = await readLimitedText(response);
          throw httpError(response.status, extractSafeErrorDetail(body));
        }

        if (!response.body) {
          throw new ProviderError('invalid_response', messageForCode('invalid_response'));
        }

        const contentType = (response.headers.get('content-type') ?? '').toLowerCase();
        const classify = (error: unknown) => classifyTransportError(error, timedOut, external);

        if (contentType.includes('text/event-stream')) {
          yield* consumeEventStream(response.body, classify);
        } else {
          // 有些「兼容」服务商忽略 stream 参数，直接返回完整 JSON。
          yield* consumeWholeJson(response);
        }
      } finally {
        clearTimeout(timer);
        external?.removeEventListener('abort', onExternalAbort);
      }
    },
  };
}
