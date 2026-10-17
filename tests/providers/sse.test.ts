import { describe, expect, it } from 'vitest';

import { SseParser } from '../../core/providers/sse';

describe('SseParser', () => {
  it('按事件分隔符解析完整数据行', () => {
    const parser = new SseParser();
    expect(parser.push('data: {"a":1}\n\ndata: {"a":2}\n\n')).toEqual(['{"a":1}', '{"a":2}']);
  });

  it('单个事件被切成两段时不会丢数据', () => {
    const parser = new SseParser();
    expect(parser.push('data: {"choices":[{"del')).toEqual([]);
    expect(parser.push('ta":{"content":"你"}}]}\n\n')).toEqual([
      '{"choices":[{"delta":{"content":"你"}}]}',
    ]);
  });

  it('支持 CRLF 行尾', () => {
    const parser = new SseParser();
    expect(parser.push('data: hello\r\n\r\n')).toEqual(['hello']);
  });

  it('忽略注释行与其它字段', () => {
    const parser = new SseParser();
    expect(parser.push(': keep-alive\nevent: x\nid: 1\ndata: real\n\n')).toEqual(['real']);
  });

  it('多行 data 按规范用换行拼接', () => {
    const parser = new SseParser();
    expect(parser.push('data: line1\ndata: line2\n\n')).toEqual(['line1\nline2']);
  });

  it('只去掉 data: 后的一个前导空格，其余空格保留', () => {
    const parser = new SseParser();
    expect(parser.push('data:  two-spaces\n\n')).toEqual([' two-spaces']);
  });

  it('flush 会交出最后一个没有空行结尾的事件', () => {
    const parser = new SseParser();
    expect(parser.push('data: tail')).toEqual([]);
    expect(parser.flush()).toEqual(['tail']);
  });

  it('flush 对空缓冲返回空数组', () => {
    const parser = new SseParser();
    expect(parser.flush()).toEqual([]);
  });

  it('空行之间没有数据时不产生空事件', () => {
    const parser = new SseParser();
    expect(parser.push('\n\n\n')).toEqual([]);
  });
});
