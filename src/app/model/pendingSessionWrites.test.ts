import { beforeEach, expect, it, vi } from "vitest";
import { applyHarnessEvent, stopStreaming } from "../../integrations/harness/core/apply";
import { upsertSession } from "../../features/sessions/data/sessionStore";
import { newSession, type Session } from "../../features/sessions/model/session";
import {
  getShellSessions,
  resetSessionsStore,
  sessionsRef,
  setSessions,
} from "../../features/sessions/model/sessionsStore";
import { takePendingSessionWrites } from "./pendingSessionWrites";

const disk = vi.hoisted(() => ({ session: undefined as Session | undefined }));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async (_command: string, args: { session: Session }) => {
    disk.session = args.session;
    return { id: args.session.id, cwd: args.session.cwd };
  }),
}));

beforeEach(() => {
  resetSessionsStore([]);
  disk.session = undefined;
});

function chat(): Session {
  return {
    ...newSession("codex", "/repo"),
    busy: true,
    blocks: [{ id: "user", role: "user", text: "Fix it", startedAt: 100 }],
  };
}

it("does not overwrite a saved reply with the snapshot that scheduled a delayed save", async () => {
  const initial = applyHarnessEvent(chat(), {
    type: "message.delta",
    text: "Fixed",
  });
  resetSessionsStore([initial]);
  const pending = new Map([[initial.id, initial]]);
  setSessions((sessions) =>
    sessions.map((session) =>
      applyHarnessEvent(session, {
        type: "message.delta",
        text: " and verified.",
      }),
    ),
  );
  // Text-only frames do not update the shell's captured session.
  expect(getShellSessions()[0]).toBe(initial);
  await upsertSession(sessionsRef.current[0]);
  for (const session of takePendingSessionWrites(pending, sessionsRef.current)) {
    await upsertSession(session);
  }
  expect(disk.session?.blocks.at(-1)?.text).toBe("Fixed and verified.");
  expect(pending.size).toBe(0);
});

it("saves the completed reply and its final duration from live state", async () => {
  const initial = chat();
  const pending = new Map([[initial.id, initial]]);
  const finished = stopStreaming(
    applyHarnessEvent(initial, {
      type: "message.delta",
      text: "Done.",
    }),
    1_100,
  );
  resetSessionsStore([finished]);
  const writes = takePendingSessionWrites(pending, sessionsRef.current);
  expect(writes).toEqual([finished]);
  await upsertSession(writes[0]);
  expect(disk.session?.blocks.at(-1)?.text).toBe("Done.");
  expect(disk.session?.blocks[0].durationMs).toBe(1_000);
});

it("does not rewrite a detached or deleted session from a stale pending snapshot", () => {
  const initial = chat();
  const pending = new Map([[initial.id, initial]]);
  expect(takePendingSessionWrites(pending, [])).toEqual([]);
  expect(pending.size).toBe(0);
});
