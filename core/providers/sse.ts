/**
 * Server-Sent Events 行解析。
 *
 * 单独抽成纯类的原因：网络分片会在任意位置切断字节流，
 * 「半个事件」和「一行被拆成两段」是常态而不是异常。
 * 这类边界最适合用单测穷举，而不是等到线上偶发才发现。
 */
export class SseParser {
  private buffer = '';
  private dataLines: string[] = [];

  /**
   * 喂入一段已解码文本，返回其中**已经完整**的事件数据。
   * 不完整的尾部会留在内部缓冲里，等下一次 push。
   */
  push(chunk: string): string[] {
    this.buffer += chunk;
    const payloads: string[] = [];

    let newlineIndex = this.buffer.indexOf('\n');
    while (newlineIndex !== -1) {
      const rawLine = this.buffer.slice(0, newlineIndex);
      this.buffer = this.buffer.slice(newlineIndex + 1);
      this.consumeLine(rawLine.replace(/\r$/, ''), payloads);
      newlineIndex = this.buffer.indexOf('\n');
    }

    return payloads;
  }

  /** 流结束时调用：把缓冲区里最后一个没有换行结尾的事件交出来。 */
  flush(): string[] {
    const payloads: string[] = [];

    if (this.buffer.length > 0) {
      this.consumeLine(this.buffer.replace(/\r$/, ''), payloads);
      this.buffer = '';
    }
    // 空行是事件分隔符；流结束时若还有未派发的数据，一并交出。
    this.dispatch(payloads);

    return payloads;
  }

  private consumeLine(line: string, payloads: string[]): void {
    if (line === '') {
      this.dispatch(payloads);
      return;
    }
    // 注释行（以冒号开头）与其它字段（event:、id:、retry:）对本协议无用。
    if (line.startsWith(':')) return;
    if (!line.startsWith('data:')) return;

    // 规范要求去掉 "data:" 后的单个前导空格，其余空格保留。
    const value = line.slice(5);
    this.dataLines.push(value.startsWith(' ') ? value.slice(1) : value);
  }

  private dispatch(payloads: string[]): void {
    if (this.dataLines.length === 0) return;
    payloads.push(this.dataLines.join('\n'));
    this.dataLines = [];
  }
}
