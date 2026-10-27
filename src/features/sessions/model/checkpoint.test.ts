// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";

const transport = vi.hoisted(() =>
  vi.fn(async (_command: string, _args?: Record<string, unknown>) => {}),
);
vi.mock("../../../platform/tauri/fs", () => ({ invokeWorkspace: transport }));
vi.mock("../../connections/model/connections", () => ({ remoteSessionFor: () => "host-session" }));

import {
  beginSessionTurn,
  captureSessionFileChanges,
  finishSessionTurn,
  flushSessionCheckpoint,
} from "./checkpoint";

afterEach(() => transport.mockReset());

it("persists ordered provider file evidence before finishing its turn", async () => {
  let release!: () => void;
  transport.mockImplementation(async (command) => {
    if (
      command === "session_checkpoint_file_changes" &&
      transport.mock.calls.filter(([name]) => name === command).length === 1
    )
      await new Promise<void>((resolve) => {
        release = resolve;
      });
  });
  await beginSessionTurn("ordered-proof", "/repo", "turn", "user-block");
  const deleted = captureSessionFileChanges("ordered-proof", "/repo", "delete-counter", [
    { path: "counter.txt", kind: "delete", contents: "0\n" },
  ]);
  const added = captureSessionFileChanges("ordered-proof", "/repo", "add-counter", [
    { path: "counter.txt", kind: "add", contents: "1\n" },
  ]);
  const finished = finishSessionTurn("ordered-proof", "/repo", "turn");
  await vi.waitFor(() => expect(release).toBeTypeOf("function"));
  expect(transport.mock.calls.map(([command]) => command)).toEqual([
    "session_checkpoint_begin_turn",
    "session_checkpoint_file_changes",
  ]);
  release();
  await Promise.all([deleted, added, finished, flushSessionCheckpoint("ordered-proof")]);
  expect(transport.mock.calls).toEqual([
    [
      "session_checkpoint_begin_turn",
      {
        sessionId: "ordered-proof",
        cwd: "/repo",
        turnId: "turn",
        userBlockId: "user-block",
        experimentalExactGitRewind: false,
      },
    ],
    [
      "session_checkpoint_file_changes",
      {
        sessionId: "ordered-proof",
        cwd: "/repo",
        callId: "delete-counter",
        changes: [{ path: "counter.txt", kind: "delete", contents: "0\n" }],
      },
    ],
    [
      "session_checkpoint_file_changes",
      {
        sessionId: "ordered-proof",
        cwd: "/repo",
        callId: "add-counter",
        changes: [{ path: "counter.txt", kind: "add", contents: "1\n" }],
      },
    ],
    [
      "session_checkpoint_finish_turn",
      { sessionId: "ordered-proof", cwd: "/repo", turnId: "turn", interrupted: false },
    ],
  ]);
});

it("propagates proof persistence failure and preserves remote IDs and empty file contents on retry", async () => {
  const changes = [{ path: "empty.txt", kind: "add" as const, contents: "" }];
  transport.mockRejectedValueOnce(new Error("history unavailable"));
  await expect(
    captureSessionFileChanges("renderer-session", "remote://machine/repo", "empty-add", changes),
  ).rejects.toThrow("history unavailable");
  await captureSessionFileChanges(
    "renderer-session",
    "remote://machine/repo",
    "empty-add",
    changes,
  );
  expect(transport.mock.lastCall).toEqual([
    "session_checkpoint_file_changes",
    {
      sessionId: "host-session",
      cwd: "remote://machine/repo",
      callId: "empty-add",
      changes,
    },
  ]);
  await captureSessionFileChanges("renderer-session", "remote://machine/repo", "incomplete", []);
  expect(transport).toHaveBeenCalledTimes(2);
});
