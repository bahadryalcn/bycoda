import { describe, expect, it } from "vitest";
import type { AssistantNote } from "../../../../shared/model/host-contracts/assistant";
import { dailyNoteDay, noteLines, notePreview, sortNotesForDisplay } from "./assistantNoteDisplay";

function note(id: string, title: string, updatedAt: number, tags: string[] = []): AssistantNote {
  return { id, title, body: "", tags, updatedAt, createdAt: updatedAt };
}

describe("assistant note display", () => {
  it("recognises only assistant-tagged daily notes", () => {
    expect(dailyNoteDay({ title: "Arif · 2026-11-07", tags: ["assistant"] })).toBe("2026-11-07");
    expect(dailyNoteDay({ title: "Arif · 2026-11-07", tags: [] })).toBeUndefined();
    expect(dailyNoteDay({ title: "Plan 2026-11-07", tags: ["assistant"] })).toBeUndefined();
  });

  it("strips event markers and splits timed entries into a timeline", () => {
    const lines = noteLines(
      "- 13:52 UTC · The job was submitted.  <!-- assistant-event:abc-1 -->\n\n- 14:01 UTC · Done. <!-- assistant-event:abc-2 -->",
    );
    expect(lines).toEqual([
      { time: "13:52", text: "The job was submitted." },
      { time: "14:01", text: "Done." },
    ]);
    expect(lines.map((line) => line.text).join("\n")).not.toContain("assistant-event");
  });

  it("keeps untimed text as plain lines", () => {
    expect(noteLines("First line\n  \nSecond")).toEqual([
      { text: "First line" },
      { text: "Second" },
    ]);
  });

  it("orders daily notes newest day first and other notes by update time", () => {
    const notes = [
      note("old-day", "Arif · 2026-11-06", 1_793_930_000_000, ["assistant"]),
      note("manual", "Manual", 1_794_045_600_000),
      note("new-day", "Arif · 2026-11-07", 1_794_010_000_000, ["assistant"]),
    ];
    expect(sortNotesForDisplay(notes).map((item) => item.id)).toEqual([
      "new-day",
      "manual",
      "old-day",
    ]);
    expect(notes[0].id).toBe("old-day");
  });

  it("builds a one-line plain preview without markdown marks or event markers", () => {
    expect(notePreview("## Plan\n\n- **Ship** the [guide](https://x.test)\n- `run` checks")).toBe(
      "Plan · Ship the guide · run checks",
    );
    expect(notePreview("- 13:52 UTC · Done. <!-- assistant-event:a-1 -->")).toBe("Done.");
    expect(notePreview("")).toBe("");
    expect(notePreview("word ".repeat(80)).endsWith("…")).toBe(true);
  });
});
