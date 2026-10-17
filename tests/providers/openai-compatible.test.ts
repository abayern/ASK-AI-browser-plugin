import { describe, expect, it } from 'vitest';

import { ProviderError } from '../../core/providers/errors';
import { createOpenAiCompatibleAdapter } from '../../core/providers/openai-compatible';
import type { ChatRequest } from '../../core/providers/types';

const KEY = 'sk-test-key-1234567890';
const BASE = 'https://api.example.com/v1';

function streamResponse(chunks: string[]): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
  return new Response(body, {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  });
}

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function baseRequest(overrides: Partial<ChatRequest> = {}): ChatRequest {
  return {
    baseUrl: BASE,
    apiKey: KEY,
    model: 'gpt-test',
    messages: [{ role: 'user', content: '你好' }],
    ...overrides,
  };
}

async function collect(request: ChatRequest, fetchImpl: typeof fetch): Promise<string> {
  const adapter = createOpenAiCompatibleAdapter({ fetchImpl });
  let text = '';
  for await (const delta of adapter.streamChat(request)) {
    text += delta.text;
  }
  return text;
}

/** 一直不返回、只在收到 abort 时拒绝的 fetch，用于验证超时与取消。 */
const hangingFetch = (async (_input: unknown, init?: RequestInit) => {
  return new Promise<Response>((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () => {
      const error = new Error('aborted');
      error.name = 'AbortError';
      reject(error);
    });
  });
}) as unknown as typeof fetch;

describe('OpenAI-compatible 适配器 · 正常流', () => {
  it('逐段产出增量，且能处理被切开的 SSE 事件', async () => {
    const chunks = [
      'data: {"choices":[{"delta":{"content":"你"}}]}\n\n',
      'data: {"choices":[{"del',
      'ta":{"content":"好"}}]}\n\n',
      'data: [DONE]\n\n',
    ];
    const fetchImpl = (async () => streamResponse(chunks)) as unknown as typeof fetch;
    await expect(collect(baseRequest(), fetchImpl)).resolves.toBe('你好');
  });

  it('忽略无法解析的心跳事件，不中断整条流', async () => {
    const chunks = [
      'data: {"choices":[{"delta":{"content":"A"}}]}\n\n',
      'data: not-json\n\n',
      'data: {"choices":[{"delta":{"content":"B"}}]}\n\n',
      'data: [DONE]\n\n',
    ];
    const fetchImpl = (async () => streamResponse(chunks)) as unknown as typeof fetch;
    await expect(collect(baseRequest(), fetchImpl)).resolves.toBe('AB');
  });

  it('服务商忽略 stream 参数、直接返回 JSON 时也能取到内容', async () => {
    const fetchImpl = (async () =>
      jsonResponse({ choices: [{ message: { content: '完整回答' } }] })) as unknown as typeof fetch;
    await expect(collect(baseRequest(), fetchImpl)).resolves.toBe('完整回答');
  });
});

describe('OpenAI-compatible 适配器 · 请求构造与密钥安全', () => {
  it('请求地址、头部与请求体符合预期，且 Key 只出现在 Authorization 头里', async () => {
    let capturedUrl = '';
    let capturedInit: RequestInit | undefined;

    const fetchImpl = (async (input: unknown, init?: RequestInit) => {
      capturedUrl = String(input);
      capturedInit = init;
      return streamResponse(['data: [DONE]\n\n']);
    }) as unknown as typeof fetch;

    await collect(baseRequest({ temperature: 0.4 }), fetchImpl);

    expect(capturedUrl).toBe('https://api.example.com/v1/chat/completions');
    expect(capturedUrl).not.toContain(KEY);
    expect(capturedUrl).not.toContain('sk-');

    const headers = capturedInit?.headers as Record<string, string>;
    expect(headers.Authorization).toBe(`Bearer ${KEY}`);
    expect(headers['Content-Type']).toBe('application/json');

    // Key 绝不能出现在请求体里
    const bodyText = String(capturedInit?.body);
    expect(bodyText).not.toContain(KEY);

    expect(JSON.parse(bodyText)).toMatchObject({
      model: 'gpt-test',
      stream: true,
      temperature: 0.4,
    });

    // 不把 Cookie 带给第三方服务商
    expect(capturedInit?.credentials).toBe('omit');
  });

  it('未配置 temperature 时不下发该字段', async () => {
    let capturedInit: RequestInit | undefined;
    const fetchImpl = (async (_input: unknown, init?: RequestInit) => {
      capturedInit = init;
      return streamResponse(['data: [DONE]\n\n']);
    }) as unknown as typeof fetch;

    await collect(baseRequest(), fetchImpl);

    const body = JSON.parse(String(capturedInit?.body)) as Record<string, unknown>;
    expect('temperature' in body).toBe(false);
  });

  it('请求体只包含白名单字段，不夹带调用方塞进来的属性', async () => {
    let capturedInit: RequestInit | undefined;
    const fetchImpl = (async (_input: unknown, init?: RequestInit) => {
      capturedInit = init;
      return streamResponse(['data: [DONE]\n\n']);
    }) as unknown as typeof fetch;

    const polluted = baseRequest() as ChatRequest & { evil?: string };
    polluted.evil = 'should-not-be-sent';
    await collect(polluted, fetchImpl);

    const body = JSON.parse(String(capturedInit?.body)) as Record<string, unknown>;
    expect(body.evil).toBeUndefined();
    expect(Object.keys(body).sort()).toEqual(['messages', 'model', 'stream']);
  });

  it('http 地址默认被拒绝，且不会发起请求', async () => {
    let called = false;
    const fetchImpl = (async () => {
      called = true;
      return streamResponse(['data: [DONE]\n\n']);
    }) as unknown as typeof fetch;

    await expect(
      collect(baseRequest({ baseUrl: 'http://example.com/v1' }), fetchImpl),
    ).rejects.toMatchObject({ code: 'not_configured' });
    expect(called).toBe(false);
  });

  it('显式允许本地开发时，http 回环地址可用', async () => {
    let capturedUrl = '';
    const fetchImpl = (async (input: unknown) => {
      capturedUrl = String(input);
      return streamResponse(['data: [DONE]\n\n']);
    }) as unknown as typeof fetch;

    await collect(
      baseRequest({ baseUrl: 'http://localhost:11434/v1', allowInsecureLocalDev: true }),
      fetchImpl,
    );

    expect(capturedUrl).toBe('http://localhost:11434/v1/chat/completions');
  });

  it('空 Key 视为未配置', async () => {
    const fetchImpl = (async () => streamResponse(['data: [DONE]\n\n'])) as unknown as typeof fetch;
    await expect(collect(baseRequest({ apiKey: '   ' }), fetchImpl)).rejects.toMatchObject({
      code: 'not_configured',
    });
  });
});

describe('OpenAI-compatible 适配器 · 失败路径', () => {
  it('HTTP 错误按状态码归类，且不把响应体（可能含 Key）带进文案', async () => {
    const body = JSON.stringify({
      error: { message: `Incorrect API key provided: ${KEY}`, code: 'invalid_api_key' },
    });
    const fetchImpl = (async () =>
      new Response(body, {
        status: 401,
        headers: { 'content-type': 'application/json' },
      })) as unknown as typeof fetch;

    let caught: unknown;
    try {
      await collect(baseRequest(), fetchImpl);
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(ProviderError);
    const providerError = caught as ProviderError;
    expect(providerError.code).toBe('unauthorized');
    expect(providerError.status).toBe(401);
    expect(providerError.message).not.toContain(KEY);
    expect(providerError.message).not.toContain('Incorrect API key provided');
  });

  it('429 归类为限流', async () => {
    const fetchImpl = (async () =>
      new Response('{}', { status: 429 })) as unknown as typeof fetch;
    await expect(collect(baseRequest(), fetchImpl)).rejects.toMatchObject({
      code: 'rate_limited',
      status: 429,
    });
  });

  it('5xx 归类为服务商错误', async () => {
    const fetchImpl = (async () =>
      new Response('{}', { status: 503 })) as unknown as typeof fetch;
    await expect(collect(baseRequest(), fetchImpl)).rejects.toMatchObject({ code: 'server_error' });
  });

  it('正常响应里夹带的 error 对象会被识别为服务商错误', async () => {
    const fetchImpl = (async () =>
      streamResponse(['data: {"error":{"code":"overloaded"}}\n\n'])) as unknown as typeof fetch;
    await expect(collect(baseRequest(), fetchImpl)).rejects.toMatchObject({ code: 'server_error' });
  });

  it('断流（没有 [DONE] 也没有 finish_reason）报告为不完整', async () => {
    const fetchImpl = (async () =>
      streamResponse([
        'data: {"choices":[{"delta":{"content":"半"}}]}\n\n',
      ])) as unknown as typeof fetch;

    const adapter = createOpenAiCompatibleAdapter({ fetchImpl });
    const parts: string[] = [];
    let caught: unknown;
    try {
      for await (const delta of adapter.streamChat(baseRequest())) parts.push(delta.text);
    } catch (error) {
      caught = error;
    }

    // 已收到的部分内容不丢弃，便于界面提示「回答可能不完整」
    expect(parts.join('')).toBe('半');
    expect((caught as ProviderError).code).toBe('incomplete_stream');
  });

  it('有 finish_reason 但没有 [DONE] 视为正常结束', async () => {
    const fetchImpl = (async () =>
      streamResponse([
        'data: {"choices":[{"delta":{"content":"完"},"finish_reason":"stop"}]}\n\n',
      ])) as unknown as typeof fetch;
    await expect(collect(baseRequest(), fetchImpl)).resolves.toBe('完');
  });

  it('非 JSON 的非流式响应报告为无法解析', async () => {
    const fetchImpl = (async () =>
      new Response('not json', {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })) as unknown as typeof fetch;
    await expect(collect(baseRequest(), fetchImpl)).rejects.toMatchObject({
      code: 'invalid_response',
    });
  });

  it('网络异常归类为网络错误', async () => {
    const fetchImpl = (async () => {
      throw new TypeError('failed to fetch');
    }) as unknown as typeof fetch;
    await expect(collect(baseRequest(), fetchImpl)).rejects.toMatchObject({
      code: 'network_error',
    });
  });

  it('外部取消归类为「已停止」而不是超时', async () => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 5);

    await expect(
      collect(baseRequest({ signal: controller.signal }), hangingFetch),
    ).rejects.toMatchObject({ code: 'aborted' });
  });

  it('超时单独归类为 timeout', async () => {
    await expect(collect(baseRequest({ timeoutMs: 10 }), hangingFetch)).rejects.toMatchObject({
      code: 'timeout',
    });
  });

  it('已经取消的信号在发请求前就返回', async () => {
    const controller = new AbortController();
    controller.abort();
    let called = false;
    const fetchImpl = (async () => {
      called = true;
      return streamResponse(['data: [DONE]\n\n']);
    }) as unknown as typeof fetch;

    await expect(
      collect(baseRequest({ signal: controller.signal }), fetchImpl),
    ).rejects.toMatchObject({ code: 'aborted' });
    expect(called).toBe(false);
  });
});
