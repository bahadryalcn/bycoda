import type { TranscriptVirtualRow } from "./TranscriptVirtualRows";

/** Per-turn row identities. Inputs describe everything the retained render closure reads. */
export class TranscriptRowCache {
  private entries = new Map<string, { inputs: readonly unknown[]; row: TranscriptVirtualRow }>();

  row(
    id: string,
    inputs: readonly unknown[],
    create: () => TranscriptVirtualRow,
  ): TranscriptVirtualRow {
    const previous = this.entries.get(id);
    if (
      previous &&
      previous.inputs.length === inputs.length &&
      inputs.every((input, index) => Object.is(input, previous.inputs[index]))
    )
      return previous.row;
    const row = create();
    this.entries.set(id, { inputs, row });
    return row;
  }

  retain(rows: readonly TranscriptVirtualRow[]): void {
    const ids = new Set(rows.map((row) => row.id));
    for (const id of this.entries.keys()) if (!ids.has(id)) this.entries.delete(id);
  }
}
