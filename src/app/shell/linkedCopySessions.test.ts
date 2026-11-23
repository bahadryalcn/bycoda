import { describe, expect, it } from "vitest";
import type { SessionSummary } from "../../features/sessions/data/sessionStore";
import type { RemoteRailSession } from "../../features/connections/model/remoteRailSessions";
import type { HostSessionSummary } from "../../features/connections/model/protocol";
import { projectLinks } from "../../features/projects/model/projectRepositories";
import { pathKey } from "../../shared/lib/paths";
import {
  copySessionKey,
  copySessions,
  isCopyRow,
  localProjectCopy,
  mergeCopyRows,
  otherProjectCopies,
} from "./linkedCopySessions";
import type { SessionListRow } from "./sessionListWindow";

const PC = "G:\Projects\clinic";
const MAC = "remote://mac-env/Users/me/clinic";
const links = projectLinks([PC, MAC], {
  [pathKey(PC)]: "github.com/owner/clinic",
  [pathKey(MAC)]: "github.com/owner/clinic",
});

const local = (id: string, at: number, extra: Partial<SessionSummary> = {}) =>
  ({ id, cwd: PC, title: id, updatedAt: at, createdAt: at, ...extra }) as SessionSummary;
const hosted = (id: string, at: number, extra: Partial<HostSessionSummary> = {}) =>
  ({ id, title: id, updatedAt: at, status: "idle", ...extra }) as HostSessionSummary;
const listed = (session: HostSessionSummary, fresh = true): RemoteRailSession => ({
  project: MAC,
  session,
  fresh,
});
const loose = (session: SessionSummary): SessionListRow => ({
  kind: "session",
  key: `session:${session.id}`,
  session,
  section: "ungrouped",
  depth: 0,
});

describe("otherProjectCopies", () => {
  it("names the other machine's copy of the open project", () => {
    expect(otherProjectCopies(links, PC, () => false)).toEqual([MAC]);
    expect(otherProjectCopies(links, MAC, () => false)).toEqual([PC]);
    expect(localProjectCopy(otherProjectCopies(links, MAC, () => false))).toBe(PC);
  });

  it("leaves out locked copies, unlinked projects and the no-project view", () => {
    expect(otherProjectCopies(links, PC, (path) => path === MAC)).toEqual([]);
    expect(otherProjectCopies(links, "G:\Projects\other", () => false)).toEqual([]);
    expect(otherProjectCopies(links, "~", () => false)).toEqual([]);
  });
});

describe("copySessions", () => {
  it("takes a remote copy's conversations from its machine's list, newest first", () => {
    const result = copySessions(
      [MAC],
      [
        listed(hosted("old", 1)),
        listed(hosted("new", 9)),
        listed(hosted("draft", 5, { draft: true })),
        { project: "remote://mac-env/Users/me/other", session: hosted("elsewhere", 7) },
      ],
      [],
    );
    expect(result.sessions.map((session) => [session.id, session.cwd])).toEqual([
      ["new", MAC],
      ["old", MAC],
    ]);
    expect(result.stale.size).toBe(0);
  });

  it("marks a copy whose machine has not answered as stale", () => {
    const result = copySessions([MAC], [listed(hosted("cached", 1), false)], []);
    expect(result.stale.has(pathKey(MAC))).toBe(true);
  });

  it("takes this computer's copy from the local store only", () => {
    const result = copySessions(
      [PC],
      [listed(hosted("remote", 9))],
      [
        local("mine", 3),
        local("crew-member", 4, { orchestrationLeadId: "lead" }),
        local("unsent", 5, { draft: true }),
        local("other", 6, { cwd: "G:\Projects\other" }),
      ],
    );
    expect(result.sessions.map((session) => session.id)).toEqual(["mine"]);
  });
});

describe("mergeCopyRows", () => {
  it("returns the list untouched when no copy has sessions", () => {
    const rows = [loose(local("a", 5))];
    expect(mergeCopyRows(rows, [])).toBe(rows);
  });

  it("places copy rows among the loose rows by recency", () => {
    const copies = copySessions([MAC], [listed(hosted("m7", 7)), listed(hosted("m3", 3))], []);
    const merged = mergeCopyRows([loose(local("a", 10)), loose(local("b", 5))], copies.sessions);
    expect(merged.map((row) => (row.kind === "session" ? row.session.id : row.kind))).toEqual([
      "a",
      "m7",
      "b",
      "m3",
    ]);
    expect(merged.filter(isCopyRow).map((row) => row.key)).toEqual([
      copySessionKey({ cwd: MAC, id: "m7" }),
      copySessionKey({ cwd: MAC, id: "m3" }),
    ]);
  });

  it("keeps pins and folders of the open copy above and the settled shelf below", () => {
    const pinned: SessionListRow = {
      kind: "session",
      key: "session:p",
      session: local("p", 1, { pinned: true }),
      section: "pinned",
      depth: 1,
      groupSection: "pinned",
    };
    const shelf = {
      kind: "group",
      key: "group:settled",
      entry: { kind: "settled", collapsed: true, sessions: [] },
    } as unknown as SessionListRow;
    const copies = copySessions([MAC], [listed(hosted("m", 99))], []).sessions;
    expect(mergeCopyRows([pinned, shelf], copies).map((row) => row.key)).toEqual([
      "session:p",
      copySessionKey({ cwd: MAC, id: "m" }),
      "group:settled",
    ]);
    expect(
      mergeCopyRows([pinned, loose(local("a", 5)), shelf], copies).map((row) => row.key),
    ).toEqual(["session:p", copySessionKey({ cwd: MAC, id: "m" }), "session:a", "group:settled"]);
  });
});
