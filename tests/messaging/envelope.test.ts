import { describe, expect, it } from 'vitest';

import { MessageError, toDisplayMessage, unwrapEnvelope } from '../../core/messaging/envelope';

describe('unwrapEnvelope', () => {
  it('成功响应返回 data', () => {
    const data = { configured: true, masked: '••••••••cdef', updatedAt: 1 };
    expect(unwrapEnvelope({ ok: true, data })).toEqual(data);
  });

  it('失败响应抛出带 code 与文案的 MessageError', () => {
    try {
      unwrapEnvelope({ ok: false, error: { code: 'validation_failed', message: '配置不合法。' } });
      expect.unreachable('应当抛出');
    } catch (error) {
      expect(error).toBeInstanceOf(MessageError);
      const err = error as MessageError;
      expect(err.code).toBe('validation_failed');
      expect(err.message).toBe('配置不合法。');
    }
  });

  it('畸形响应一律按传输错误处理', () => {
    for (const bad of [null, undefined, 'ok', 42, [], {}, { ok: 'yes' }]) {
      expect(() => unwrapEnvelope(bad), JSON.stringify(bad)).toThrow(MessageError);
      try {
        unwrapEnvelope(bad);
      } catch (error) {
        expect((error as MessageError).code).toBe('transport_error');
      }
    }
  });

  it('成功但缺少 data 不被当作成功', () => {
    expect(() => unwrapEnvelope({ ok: true })).toThrow(MessageError);
  });

  it('失败但缺少 error 结构时给出兜底文案', () => {
    for (const bad of [{ ok: false }, { ok: false, error: 'nope' }, { ok: false, error: {} }]) {
      try {
        unwrapEnvelope(bad);
        expect.unreachable('应当抛出');
      } catch (error) {
        const err = error as MessageError;
        expect(err.code).toBe('internal_error');
        expect(err.message.length).toBeGreaterThan(0);
      }
    }
  });

  it('非字符串的 code 会被降级，不会把对象塞进界面', () => {
    try {
      unwrapEnvelope({ ok: false, error: { code: { evil: true }, message: 42 } });
      expect.unreachable('应当抛出');
    } catch (error) {
      const err = error as MessageError;
      expect(err.code).toBe('internal_error');
      expect(typeof err.message).toBe('string');
    }
  });
});

describe('toDisplayMessage', () => {
  it('透传 MessageError 文案', () => {
    expect(toDisplayMessage(new MessageError('invalid_message', '载荷不合法。'))).toBe(
      '载荷不合法。',
    );
  });

  it('其它异常使用兜底文案，不泄露底层信息', () => {
    expect(toDisplayMessage(new Error('boom'))).toBe('操作失败，请重试。');
    expect(toDisplayMessage(new Error('boom'), '读取失败。')).toBe('读取失败。');
    expect(toDisplayMessage('string-error')).toBe('操作失败，请重试。');
  });
});
