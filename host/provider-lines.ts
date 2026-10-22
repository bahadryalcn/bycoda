// Resumed Codex threads can contain several base64 images in one JSONL frame.
export const PROVIDER_STDOUT_LINE_BYTES = 64 * 1024 * 1024;
export const PROVIDER_STDERR_LINE_BYTES = 8 * 1024 * 1024;

/** Assemble fragmented lines without repeatedly copying a large image payload. */
export class ProviderLines {
  private chunks: string[] = [];
  private bytes = 0;
  private stopped = false;

  constructor(
    private readonly maxBytes: number,
    private readonly onLine: (line: string) => void,
    private readonly onOverflow: () => void,
  ) {}

  push(data: string): void {
    if (this.stopped) return;
    let start = 0;
    while (start < data.length) {
      const end = data.indexOf("\n", start);
      const part = data.slice(start, end < 0 ? undefined : end);
      const bytes = Buffer.byteLength(part, "utf8");
      if (this.bytes + bytes > this.maxBytes) {
        this.stopped = true;
        this.chunks = [];
        this.bytes = 0;
        this.onOverflow();
        return;
      }
      if (part) this.chunks.push(part);
      this.bytes += bytes;
      if (end < 0) return;
      this.flush();
      start = end + 1;
    }
  }

  end(): void {
    if (!this.stopped && this.chunks.length) this.flush();
  }

  private flush(): void {
    const line = this.chunks.join("").replace(/\r$/, "");
    this.chunks = [];
    this.bytes = 0;
    this.onLine(line);
  }
}
