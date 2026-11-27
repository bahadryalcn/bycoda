import { describe, expect, it } from "vitest";
import type { SessionSummary } from "../../features/sessions/data/sessionStore";
import type { SessionListEntry } from "../../features/sessions/model/sessionFolders";
import { flattenSessionList, startsSessionSection } from "./sessionListWindow";

const session = (id: string) => ({ id, cwd: "C:\\p", title: id }) as SessionSummary;
const entries = [
  { kind: "pinned", collapsed: false, folders: [], sessions: [session("p1"), session("p2")] },
  { kind: "session", session: session("a") },
  { kind: "session", session: session("b") },
  { kind: "settled", collapsed: false, sessions: [session("s")] },
] as unknown as SessionListEntry[];

describe("flattenSessionList", () => {
  it("starts built-in group rows flush and breaks after Pinned and before Settled", () => {
    const rows = flattenSessionList(entries, false);
    expect(rows.map((row) => (row.kind === "session" ? row.depth : row.kind))).toEqual([
      "group",
      0,
      0,
      0,
      0,
      "group",
      0,
    ]);
    expect(rows.map((_, index) => startsSessionSection(rows, index))).toEqual([
      false,
      false,
      false,
      true,
      false,
      true,
      false,
    ]);
  });

  it("breaks right after a collapsed Pinned header", () => {
    const collapsed = [{ ...entries[0], collapsed: true }, entries[1]] as SessionListEntry[];
    const rows = flattenSessionList(collapsed, false);
    expect(rows.map((_, index) => startsSessionSection(rows, index))).toEqual([false, true]);
  });
});
