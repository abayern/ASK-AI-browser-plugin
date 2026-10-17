import { describe, expect, it } from 'vitest';

import {
  codeForStatus,
  extractSafeErrorDetail,
  httpError,
  messageForCode,
  ProviderError,
} from '../../core/providers/errors';

describe('codeForStatus', () => {
  it('按状态码归类', () => {
    expect(codeForStatus(401)).toBe('unauthorized');
    expect(codeForStatus(403)).toBe('forbidden');
    expect(codeForStatus(402)).toBe('quota_exceeded');
    expect(codeForStatus(404)).toBe('model_not_found');
    expect(codeForStatus(429)).toBe('rate_limited');
    expect(codeForStatus(400)).toBe('invalid_request');
    expect(codeForStatus(422)).toBe('invalid_request');
    expect(codeForStatus(500)).toBe('server_error');
    expect(codeForStatus(503)).toBe('server_error');
    expect(codeForStatus(302)).toBe('unknown');
  });
});

describe('extractSafeErrorDetail', () => {
  it('提取形如标识符的 code / type', () => {
    expect(extractSafeErrorDetail('{"error":{"code":"insufficient_quota"}}')).toBe(
      'insufficient_quota',
    );
    expect(extractSafeErrorDetail('{"error":{"type":"invalid_request_error"}}')).toBe(
      'invalid_request_error',
    );
  });

  it('拒绝任何非标识符形状的内容', () => {
    const bodies = [
      '{"error":{"code":"has space here"}}',
      '{"error":{"code":"line\\nbreak"}}',
      '{"error":{"code":"<script>alert(1)</script>"}}',
      '{"error":{"code":123}}',
      '{"error":{"code":"' + 'a'.repeat(200) + '"}}',
      'not json at all',
      '',
    ];
    for (const body of bodies) {
      expect(extractSafeErrorDetail(body), body.slice(0, 30)).toBeNull();
    }
  });

  it('响应体里回显了 API Key 时不会把它带出来', () => {
    const body =
      '{"error":{"message":"Incorrect API key provided: sk-1234567890abcdef","code":""}}';
    const detail = extractSafeErrorDetail(body);
    expect(detail).toBeNull();
    expect(JSON.stringify(detail)).not.toContain('sk-1234567890abcdef');
  });
});

describe('httpError', () => {
  it('文案包含状态码与类别，但不含响应体内容', () => {
    const error = httpError(401, null);
    expect(error).toBeInstanceOf(ProviderError);
    expect(error.code).toBe('unauthorized');
    expect(error.status).toBe(401);
    expect(error.message).toContain('401');
    expect(error.message).not.toContain('{"');
  });

  it('带上脱敏后的错误标识', () => {
    const error = httpError(429, 'rate_limit_exceeded');
    expect(error.message).toContain('rate_limit_exceeded');
    expect(error.status).toBe(429);
  });
});

describe('messageForCode', () => {
  it('每种错误码都有稳定且非空的文案', () => {
    const codes = [
      'not_configured',
      'unauthorized',
      'forbidden',
      'rate_limited',
      'quota_exceeded',
      'invalid_request',
      'model_not_found',
      'server_error',
      'network_error',
      'timeout',
      'aborted',
      'incomplete_stream',
      'invalid_response',
      'unknown',
    ] as const;

    for (const code of codes) {
      const message = messageForCode(code);
      expect(message.length, code).toBeGreaterThan(0);
      // 面向用户的文案里不应出现 HTTP 头名等实现细节
      expect(message.toLowerCase()).not.toContain('authorization');
      expect(message).not.toContain('sk-');
    }
  });
});
