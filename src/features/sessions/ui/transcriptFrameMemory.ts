/**
 * What the last committed frame produced, kept for the next derivation that
 * wants to reuse it. Render only reads it; a commit effect writes it, so a
 * render React discards never moves the baseline.
 */
export class FrameMemory<T> {
  private value: T | null = null;

  read(): T | null {
    return this.value;
  }

  write(value: T): void {
    this.value = value;
  }
}
