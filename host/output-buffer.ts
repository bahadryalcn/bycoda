const PAGE_UNITS = 4096;

/** Bounded decoded output. Limits and offsets remain exact UTF-16 string units.
 * Lazy fixed pages bound retained bytes without retaining a large source string
 * or allocating one queue node per tiny chunk. Append copies new units only;
 * readers materialize only the requested range. ANSI/surrogates stay untouched.
 */
export class OutputBuffer {
  private readonly pages: Array<Uint16Array | undefined> = [];
  private position = 0;
  private retained = 0;

  constructor(private readonly capacity: number) {
    if (!Number.isSafeInteger(capacity) || capacity < 1)
      throw new Error("Output capacity must be a positive safe integer.");
  }

  get length(): number {
    return this.retained;
  }

  append(text: string): void {
    let offset = 0;
    if (text.length >= this.capacity) {
      // Nothing preceding this suffix survives. Do not copy discarded input.
      offset = text.length - this.capacity;
      this.position = 0;
      this.retained = 0;
    }
    const added = text.length - offset;
    while (offset < text.length) {
      const pageIndex = Math.floor(this.position / PAGE_UNITS);
      const within = this.position % PAGE_UNITS;
      const page = this.pages[pageIndex] ??= new Uint16Array(
        Math.min(PAGE_UNITS, this.capacity - pageIndex * PAGE_UNITS),
      );
      const count = Math.min(page.length - within, text.length - offset);
      for (let index = 0; index < count; index++)
        page[within + index] = text.charCodeAt(offset + index);
      offset += count;
      this.position = (this.position + count) % this.capacity;
    }
    this.retained = Math.min(this.capacity, this.retained + added);
  }

  slice(start = 0, end = this.retained): string {
    // Match String.slice for the integer ranges used by output readers, including
    // negative tail offsets. No Unicode normalization or boundary repair.
    const relative = (value: number) => value < 0
      ? Math.max(this.retained + value, 0)
      : Math.min(value, this.retained);
    const from = relative(start);
    let remaining = Math.max(0, relative(end) - from);
    let position = (this.position - this.retained + from + this.capacity) % this.capacity;
    const parts: string[] = [];
    while (remaining > 0) {
      const page = this.pages[Math.floor(position / PAGE_UNITS)]!;
      const within = position % PAGE_UNITS;
      const count = Math.min(page.length - within, remaining);
      parts.push(String.fromCharCode(...page.subarray(within, within + count)));
      remaining -= count;
      position = (position + count) % this.capacity;
    }
    return parts.join("");
  }
}
