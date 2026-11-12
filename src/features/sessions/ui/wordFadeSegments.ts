type Segment = { start: number; end: number; space: boolean; fades: boolean };

export function isWordFadeSpace(code: number): boolean {
  return code === 32 || code === 10 || code === 9 || code === 13;
}

/** Retain text offsets, splitting only appended characters, including partial words. */
export class WordFadeSegments {
  text = "";
  parts: Segment[] = [];
  words: Segment[] = [];
  count = 0;

  update(text: string): this {
    if (text === this.text) return this;
    if (!text.startsWith(this.text)) {
      this.text = "";
      this.parts = [];
      this.words = [];
      this.count = 0;
    }
    let offset = this.text.length;
    let inWord = offset > 0 && !isWordFadeSpace(text.charCodeAt(offset - 1));
    const tail = text.slice(offset);
    for (let i = 0; i < tail.length; i++) {
      const word = !isWordFadeSpace(tail.charCodeAt(i));
      if (word && !inWord) this.count++;
      inWord = word;
    }
    for (const part of tail.split(/(\s+)/)) {
      if (!part) continue;
      const space = /\s/.test(part[0]);
      const previous = this.parts[this.parts.length - 1];
      if (previous && previous.space === space) previous.end += part.length;
      else {
        const segment = {
          start: offset,
          end: offset + part.length,
          space,
          fades: !isWordFadeSpace(part.charCodeAt(0)),
        };
        this.parts.push(segment);
        if (segment.fades) this.words.push(segment);
      }
      offset += part.length;
    }
    this.text = text;
    return this;
  }
}
