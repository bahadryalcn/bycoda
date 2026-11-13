import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { HostStore } from "../../store";
import { AssistantBackgroundEffect } from "./assistant-background-effect";

it("requires live callback authority and never replays an uncertain effect", async () => {
  const dir = mkdtempSync(join(tmpdir(), "assistant-background-effect-"));
  const store = new HostStore(join(dir, "host.db"));
  try {
    const owner = new AssistantBackgroundEffect(store);
    const source = {
      environmentId: store.environmentId,
      threadId: "room",
      operationId: "occurrence",
      action: "social.send" as const,
      input: { accountId: "account", conversationId: "conversation", bodyDigest: "b".repeat(64) },
    };
    const run = vi.fn(async () => {
      throw new Error("connection lost");
    });
    const prepared = await owner.prepare(source, run, Date.now() + 30_000);
    if (prepared.state !== "prepared") throw new Error("Expected prepared effect");
    const input = {
      environmentId: source.environmentId,
      threadId: source.threadId,
      operationId: source.operationId,
      operationHash: prepared.operationHash,
      challenge: prepared.challenge,
    };
    const actor = { deviceHash: "a".repeat(64), authorized: async () => true };
    await expect(
      owner.execute(input, { ...actor, authorized: async () => false }),
    ).rejects.toThrow();
    await expect(owner.execute({ ...input, challenge: "wrong" }, actor)).rejects.toThrow();
    await expect(owner.execute(input, actor)).rejects.toThrow("connection lost");
    expect(await owner.status(source)).toEqual({ state: "unknown" });
    await expect(owner.execute(input, actor)).rejects.toThrow();
    await expect(owner.prepare(source, run, Date.now() + 30_000)).rejects.toThrow("unknown");
    expect(run).toHaveBeenCalledTimes(1);
  } finally {
    await store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

it("rejects a callback after monotonic admission expires even if wall time moves backwards", async () => {
  const dir = mkdtempSync(join(tmpdir(), "assistant-background-deadline-"));
  const store = new HostStore(join(dir, "host.db"));
  const monotonic = vi.spyOn(performance, "now");
  const wall = vi.spyOn(Date, "now");
  try {
    monotonic.mockReturnValue(1_000);
    wall.mockReturnValue(1_000_000);
    const owner = new AssistantBackgroundEffect(store);
    const source = {
      environmentId: store.environmentId,
      threadId: "room",
      operationId: "deadline",
      action: "social.send" as const,
      input: { accountId: "account" },
    };
    const run = vi.fn(async () => null);
    const prepared = await owner.prepare(source, run, 1_045_000);
    if (prepared.state !== "prepared") throw new Error("Expected prepared effect");
    monotonic.mockReturnValue(46_001);
    wall.mockReturnValue(900_000);
    await expect(
      owner.execute(
        {
          environmentId: source.environmentId,
          threadId: source.threadId,
          operationId: source.operationId,
          operationHash: prepared.operationHash,
          challenge: prepared.challenge,
        },
        { deviceHash: "a".repeat(64), authorized: async () => true },
      ),
    ).rejects.toThrow();
    expect(run).not.toHaveBeenCalled();
  } finally {
    monotonic.mockRestore();
    wall.mockRestore();
    await store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

it("rotates only an expired unclaimed operation and recovers its completed result after restart", async () => {
  const dir = mkdtempSync(join(tmpdir(), "assistant-background-recovery-"));
  const file = join(dir, "host.db");
  let store = new HostStore(file);
  const clock = vi.spyOn(Date, "now");
  try {
    clock.mockReturnValue(1_000_000);
    let owner = new AssistantBackgroundEffect(store);
    const source = {
      environmentId: store.environmentId,
      threadId: "room",
      operationId: "recover",
      action: "social.send" as const,
      input: { accountId: "account", conversationId: "canonical" },
    };
    const run = vi.fn(async () => ({ receipt: "provider-receipt" }));
    const first = await owner.prepare(source, run, 1_030_000);
    if (first.state !== "prepared") throw new Error("Expected prepared effect");
    expect(await owner.status(source)).toEqual({ state: "prepared", expiresAt: 1_030_000 });
    await expect(
      owner.prepare({ ...source, input: { accountId: "different" } }, run, 1_030_000),
    ).rejects.toThrow("different source");
    clock.mockReturnValue(1_030_001);
    const second = await owner.prepare(source, run, 1_060_000);
    if (second.state !== "prepared") throw new Error("Expected prepared effect");
    const call = {
      environmentId: source.environmentId,
      threadId: source.threadId,
      operationId: source.operationId,
      operationHash: first.operationHash,
      challenge: first.challenge,
    };
    const actor = { deviceHash: "a".repeat(64), authorized: async () => true };
    await expect(owner.execute(call, actor)).rejects.toThrow();
    expect(await owner.execute({ ...call, challenge: second.challenge }, actor)).toEqual({
      receipt: "provider-receipt",
    });
    await store.close();
    store = new HostStore(file);
    owner = new AssistantBackgroundEffect(store);
    expect(await owner.status(source)).toEqual({
      state: "completed",
      result: { receipt: "provider-receipt" },
    });
    expect(await owner.prepare(source, run, 1_060_000)).toEqual({
      state: "completed",
      result: { receipt: "provider-receipt" },
    });
    expect(run).toHaveBeenCalledTimes(1);
  } finally {
    clock.mockRestore();
    await store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
