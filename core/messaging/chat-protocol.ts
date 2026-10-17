/**
 * 聊天通道协议（长连接 port）。
 *
 * 为什么用 port 而不是 sendMessage：流式输出需要服务端主动推送多段增量，
 * 一问一答的 sendMessage 无法表达，只能靠轮询或攒完再回。
 *
 * 载荷一律逐字段校验并重新构造，不接受调用方透传任意对象。
 */
import type { ChatMessage } from '../providers/types';
import { isRecord, type Result } from '../shared/result';

export const CHAT_PORT_NAME = 'ask-ai-chat';

/** 单条请求 id 的最大长度。 */
const REQUEST_ID_MAX = 64;
/** 随请求携带的历史消息条数上限（与上下文组装的上限一致）。 */
const RECENT_MAX_MESSAGES = 8;
/** 单条历史消息的长度上限。 */
const RECENT_MESSAGE_MAX_CHARS = 2_000;

export interface ChatStartMessage {
  type: 'chat/start';
  payload: {
    requestId: string;
    question: string;
    selection?: string;
    recent?: ChatMessage[];
  };
}

export interface ChatAbortMessage {
  type: 'chat/abort';
  payload: { requestId: string };
}

export type ChatClientMessage = ChatStartMessage | ChatAbortMessage;

export type ChatServerMessage =
  | { type: 'chat/delta'; payload: { requestId: string; text: string } }
  | { type: 'chat/done'; payload: { requestId: string } }
  | { type: 'chat/error'; payload: { requestId: string; error: { code: string; message: string } } };

type ParseError = { code: string; message: string };

function reject(message: string): Result<never, ParseError> {
  return { ok: false, error: { code: 'invalid_message', message } };
}

function readRequestId(value: unknown): Result<string, ParseError> {
  if (typeof value !== 'string' || value.length === 0 || value.length > REQUEST_ID_MAX) {
    return reject('requestId 不合法。');
  }
  return { ok: true, value };
}

/** 解析并校验来自 UI 的聊天消息。 */
export function parseChatClientMessage(raw: unknown): Result<ChatClientMessage, ParseError> {
  if (!isRecord(raw)) return reject('消息必须是对象。');

  const type = raw.type;
  const payload = isRecord(raw.payload) ? raw.payload : null;
  if (!payload) return reject('缺少 payload。');

  if (type === 'chat/abort') {
    const requestId = readRequestId(payload.requestId);
    if (!requestId.ok) return requestId;
    return { ok: true, value: { type, payload: { requestId: requestId.value } } };
  }

  if (type !== 'chat/start') return reject('未知的消息类型。');

  const requestId = readRequestId(payload.requestId);
  if (!requestId.ok) return requestId;

  const rawQuestion = payload.question;
  if (typeof rawQuestion !== 'string') return reject('question 必须是字符串。');
  const question = rawQuestion.trim();
  if (question.length === 0) return reject('问题不能为空。');
  if (question.length > 4_000) return reject('问题过长。');

  let selection: string | undefined;
  if (payload.selection !== undefined) {
    if (typeof payload.selection !== 'string') return reject('selection 必须是字符串。');
    if (payload.selection.length > 20_000) return reject('选中文字过长。');
    selection = payload.selection;
  }

  const recent: ChatMessage[] = [];
  if (payload.recent !== undefined) {
    if (!Array.isArray(payload.recent)) return reject('recent 必须是数组。');
    if (payload.recent.length > RECENT_MAX_MESSAGES) return reject('历史消息过多。');

    for (const entry of payload.recent) {
      if (!isRecord(entry)) return reject('历史消息格式不正确。');
      const role = entry.role;
      // 只接受 user / assistant：system 角色不得由客户端注入。
      if (role !== 'user' && role !== 'assistant') return reject('历史消息的角色不合法。');
      const content = entry.content;
      if (typeof content !== 'string') return reject('历史消息内容必须是字符串。');
      if (content.length > RECENT_MESSAGE_MAX_CHARS) return reject('历史消息过长。');
      recent.push({ role, content });
    }
  }

  return {
    ok: true,
    value: {
      type: 'chat/start',
      payload: {
        requestId: requestId.value,
        question,
        ...(selection === undefined ? {} : { selection }),
        ...(recent.length === 0 ? {} : { recent }),
      },
    },
  };
}
