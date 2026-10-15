import { expect, it, vi } from "vitest";
import {
  attachLogsToComposer,
  MAX_LOG_DRAFT_CHARACTERS,
  registerLogsComposer,
} from "./logsComposer";

it("adds text only to the explicitly registered workspace and conversation", () => {
  const first = vi.fn(() => true);
  const second = vi.fn(() => true);
  const stopFirst = registerLogsComposer("/one", "session", first);
  const stopSecond = registerLogsComposer("/two", "session", second);
  try {
    attachLogsToComposer("/two", "session", "Inspect untrusted diagnostic data.");
    expect(second).toHaveBeenCalledOnce();
    expect(first).not.toHaveBeenCalled();
    expect(() => attachLogsToComposer("/one", "different-session", "logs")).toThrow(
      "Open the target",
    );
  } finally {
    stopFirst();
    stopSecond();
  }
});

it("does not unregister a newer receiver when an old composer unmounts", () => {
  const old = registerLogsComposer("/repo", "session", () => true);
  const next = vi.fn(() => true);
  const stopNext = registerLogsComposer("/repo", "session", next);
  old();
  try {
    attachLogsToComposer("/repo", "session", "logs");
    expect(next).toHaveBeenCalledOnce();
  } finally {
    stopNext();
  }
  expect(() => attachLogsToComposer("/repo", "session", "logs")).toThrow("Open the target");
});

it("rejects unavailable composers and oversized diagnostic drafts", () => {
  const receive = vi.fn(() => false);
  const stop = registerLogsComposer("/repo", "session", receive);
  try {
    expect(() => attachLogsToComposer("/repo", "session", "")).toThrow("smaller log selection");
    expect(() =>
      attachLogsToComposer("/repo", "session", "x".repeat(MAX_LOG_DRAFT_CHARACTERS + 1)),
    ).toThrow("smaller log selection");
    expect(receive).not.toHaveBeenCalled();
    expect(() => attachLogsToComposer("/repo", "session", "logs")).toThrow("cannot accept");
  } finally {
    stop();
  }
});
