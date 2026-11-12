/** Keep the sealed-block prefix while a parsed markdown tail grows. */
export class MarkdownSource {
  private blocks: readonly string[] = [];
  private prefix = "";
  private source = "";

  read(blocks: readonly string[]): string {
    if (blocks === this.blocks) return this.source;
    let shared = 0;
    while (
      shared < Math.min(blocks.length, this.blocks.length) &&
      blocks[shared] === this.blocks[shared]
    )
      shared++;
    if (shared === blocks.length && shared === this.blocks.length) {
      this.blocks = blocks;
      return this.source;
    }
    const last = Math.max(0, blocks.length - 1);
    if (shared >= this.blocks.length && this.blocks.length > 0)
      this.prefix = this.source + blocks.slice(shared, last).join("");
    else if (shared >= this.blocks.length - 1 && blocks.length >= this.blocks.length)
      this.prefix += blocks.slice(shared, last).join("");
    else this.prefix = blocks.slice(0, last).join("");
    this.source = this.prefix + (blocks[last] ?? "");
    this.blocks = blocks;
    return this.source;
  }
}
