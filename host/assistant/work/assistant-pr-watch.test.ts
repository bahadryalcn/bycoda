import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HostStore } from "../../store";
import { AssistantRepository } from "../repository";
import { callRoomPrWatch } from "../room/assistant-room-pr-watch";
import { ghPrReader } from "../../pull-request-watch/assistant-pr-reader";
import {
  AssistantPrWatch,
  MAX_PR_WATCHES,
  PR_WATCH_CALLS_PER_TICK,
  PR_WATCH_INTERVAL_MS,
  PR_WATCH_TTL_MS,
  type PrObservation,
  type PrReader,
} from "./assistant-pr-watch";
import type { TrackedWorkNotification } from "./assistant-tracked-work";

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const close of cleanups.splice(0).reverse()) await close();
});
const open: PrObservation = { state: "OPEN", merged: false, checks: "pending", title: "Fix it" };

async function setup() {
  const dir = mkdtempSync(join(tmpdir(), "bycoda-prwatch-"));
  const store = new HostStore(join(dir, "host.db"));
  await store.ready;
  const repository = new AssistantRepository(store);
  await repository.initialize();
  cleanups.push(async () => {
    await store.close();
    rmSync(dir, { recursive: true, force: true });
  });
  const clock = { now: 1_000_000 };
  const sent: TrackedWorkNotification[] = [];
  const calls: string[] = [];
  const next: { value: PrObservation | Error } = { value: open };
  const reader: PrReader = {
    repoOf: async () => "acme/app",
    view: async (_project, repo, number) => {
      calls.push(`${repo}#${number}`);
      if (next.value instanceof Error) throw next.value;
      return next.value;
    },
  };
  const watch = new AssistantPrWatch({
    repository,
    ports: {},
    now: () => clock.now,
    notify: async (value) => void sent.push(value),
    activity: async () => undefined,
  });
  watch.reader = reader;
  const add = (number = 12) => watch.watch({ projectId: "p", threadId: "t", number });
  const advance = (ms = PR_WATCH_INTERVAL_MS) => (clock.now += ms);
  return { watch, clock, sent, calls, next, add, advance };
}

describe("assistant PR watch", () => {
  it("resolves the repo from the project and returns the existing watch for a repeat", async () => {
    const f = await setup();
    const first = await f.add();
    expect(first.watch).toMatchObject({ repo: "acme/app", number: 12, title: "Fix it" });
    expect((await f.add()).existing).toBe(true);
    expect(await f.watch.list()).toHaveLength(1);
  });

  it("notifies each transition once and nothing when nothing changed", async () => {
    const f = await setup();
    await f.add();
    f.advance();
    await f.watch.tick();
    expect(f.sent).toEqual([]);
    f.next.value = { ...open, checks: "failing" };
    f.advance();
    await f.watch.tick();
    f.advance();
    await f.watch.tick();
    expect(f.sent.map((n) => [n.kind, n.title, n.body])).toEqual([
      ["job.failed", "PR #12 acme/app", "Checks failed. Fix it"],
    ]);
    f.next.value = { ...open, checks: "passing" };
    f.advance();
    await f.watch.tick();
    f.next.value = { ...open, checks: "passing", reviewDecision: "CHANGES_REQUESTED" };
    f.advance();
    await f.watch.tick();
    expect(f.sent.map((n) => [n.kind, n.body.split(" ")[0]])).toEqual([
      ["job.failed", "Checks"],
      ["job.done", "Checks"],
      ["job.waiting", "Changes"],
    ]);
  });

  it("does not announce checks passing that were never pending or failing", async () => {
    const f = await setup();
    f.next.value = { ...open, checks: "none" };
    await f.add();
    f.next.value = { ...open, checks: "passing" };
    f.advance();
    await f.watch.tick();
    expect(f.sent).toEqual([]);
  });

  it("stops after a merged or closed notice", async () => {
    const f = await setup();
    await f.add();
    f.next.value = { state: "MERGED", merged: true, checks: "passing" };
    f.advance();
    await f.watch.tick();
    expect(f.sent).toHaveLength(1);
    expect(f.sent[0]).toMatchObject({ kind: "job.done", body: expect.stringContaining("Merged") });
    expect(await f.watch.list()).toEqual([]);
    f.next.value = open;
    await f.add();
    f.next.value = { state: "CLOSED", merged: false, checks: "pending" };
    f.advance();
    await f.watch.tick();
    expect(f.sent[1].body).toContain("Closed without merging");
    expect(await f.watch.list()).toEqual([]);
  });

  it("refuses to watch a finished pull request", async () => {
    const f = await setup();
    f.next.value = { state: "MERGED", merged: true, checks: "passing" };
    await expect(f.add()).rejects.toThrow("already merged");
  });

  it("checks each watch at most every 3 minutes", async () => {
    const f = await setup();
    await f.add();
    f.advance(PR_WATCH_INTERVAL_MS - 1);
    await f.watch.tick();
    expect(f.calls).toHaveLength(1);
    f.advance(1);
    await f.watch.tick();
    await f.watch.tick();
    expect(f.calls).toHaveLength(2);
  });

  it("makes at most five GitHub calls per tick and rotates the rest", async () => {
    const f = await setup();
    for (let n = 1; n <= 8; n++) await f.add(n);
    f.calls.length = 0;
    f.advance();
    await f.watch.tick();
    expect(f.calls).toHaveLength(PR_WATCH_CALLS_PER_TICK);
    await f.watch.tick();
    expect(f.calls).toHaveLength(8);
    expect(new Set(f.calls).size).toBe(8);
  });

  it("marks a watch unavailable after three failures with one notice", async () => {
    const f = await setup();
    await f.add();
    f.next.value = new Error("network down");
    for (let i = 0; i < 5; i++) {
      f.advance();
      await f.watch.tick();
    }
    expect(f.sent).toHaveLength(1);
    expect(f.sent[0].body).toBe("Cannot watch PR #12: network down.");
    expect(f.calls).toHaveLength(4);
    expect((await f.watch.list())[0].unavailable).toBe("network down");
  });

  it("gives up at once when GitHub auth is missing", async () => {
    const f = await setup();
    await f.add();
    f.next.value = new Error("gh auth login required");
    f.advance();
    await f.watch.tick();
    expect(f.sent).toHaveLength(1);
    f.advance();
    await f.watch.tick();
    expect(f.sent).toHaveLength(1);
  });

  it("a successful poll resets the failure count", async () => {
    const f = await setup();
    await f.add();
    for (const value of [new Error("boom"), new Error("boom"), open, new Error("boom")]) {
      f.next.value = value;
      f.advance();
      await f.watch.tick();
    }
    expect(f.sent).toEqual([]);
    expect((await f.watch.list())[0].unavailable).toBeUndefined();
  });

  it("stops watching after 14 days", async () => {
    const f = await setup();
    await f.add();
    f.advance(PR_WATCH_TTL_MS + 1);
    await f.watch.tick();
    expect(await f.watch.list()).toEqual([]);
    expect(f.sent).toHaveLength(1);
    expect(f.sent[0].body).toContain("14 days");
  });

  it("keeps at most 30 watches", async () => {
    const f = await setup();
    for (let n = 1; n <= MAX_PR_WATCHES; n++) await f.add(n);
    await expect(f.add(99)).rejects.toThrow("At most 30");
  });

  it("only unwatches inside its project", async () => {
    const f = await setup();
    const { watch } = await f.add();
    expect(await f.watch.unwatch(watch.id, "other")).toBe(false);
    expect(await f.watch.unwatch(watch.id, "p")).toBe(true);
  });
});

describe("room PR watch tools", () => {
  const call = (action: string, input: Record<string, unknown>) => ({
    action,
    input,
    threadId: "t",
    projectId: "p",
  });
  it("watches, lists and unwatches within the project", async () => {
    const f = await setup();
    const yes = async () => true;
    const added = (await callRoomPrWatch(
      f.watch,
      call("pullRequests.assistantWatch", { number: 12 }),
      yes,
    )) as { watch: { id: string } };
    expect(
      await callRoomPrWatch(f.watch, call("pullRequests.assistantWatches", {}), yes),
    ).toMatchObject({ watches: [{ id: added.watch.id, repo: "acme/app", checks: "pending" }] });
    expect(
      await callRoomPrWatch(
        f.watch,
        call("pullRequests.assistantUnwatch", { id: added.watch.id }),
        yes,
      ),
    ).toEqual({ removed: true });
    await expect(
      callRoomPrWatch(f.watch, call("pullRequests.assistantWatch", { number: 0 }), yes),
    ).rejects.toThrow();
    await expect(
      callRoomPrWatch(
        f.watch,
        call("pullRequests.assistantWatch", { number: 1 }),
        async () => false,
      ),
    ).rejects.toThrow("revoked");
  });
});

describe("GitHub PR reader", () => {
  it("issues only read commands and maps the PR state", async () => {
    const seen: string[][] = [];
    const reader = ghPrReader(
      async (_cwd, args) => {
        seen.push(args);
        return args[0] === "repo"
          ? JSON.stringify({ nameWithOwner: "acme/app" })
          : JSON.stringify({
              state: "OPEN",
              title: "T",
              reviewDecision: "APPROVED",
              statusCheckRollup: [{ status: "COMPLETED", conclusion: "SUCCESS", name: "ci" }],
            });
      },
      async () => "/repo",
    );
    expect(Object.keys(reader).sort()).toEqual(["repoOf", "view"]);
    expect(await reader.repoOf("p")).toBe("acme/app");
    expect(await reader.view("p", "acme/app", 3)).toEqual({
      state: "OPEN",
      merged: false,
      checks: "passing",
      reviewDecision: "APPROVED",
      title: "T",
    });
    expect(seen.map((args) => args.slice(0, 2).join(" "))).toEqual(["repo view", "pr view"]);
  });

  it("fails a call that outlives its deadline", async () => {
    const reader = ghPrReader(
      () => new Promise<string>(() => undefined),
      async () => "/repo",
      10,
    );
    await expect(reader.view("p", "acme/app", 1)).rejects.toThrow("in time");
  });
});
