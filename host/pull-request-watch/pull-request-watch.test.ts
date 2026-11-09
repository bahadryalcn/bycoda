import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  MAX_PULL_REQUEST_WATCHES_PER_SESSION,
  PullRequestWatches,
  type PullRequestWatchEngine,
  type PullRequestWatchStore,
} from "./pull-request-watch";

type Pr = Record<string, unknown>;

const checkRun = (name: string, conclusion: string, status = "COMPLETED") => ({
  __typename: "CheckRun",
  name,
  status,
  conclusion,
});

function pr(url: string, overrides: Pr = {}): Pr {
  return {
    url,
    state: "OPEN",
    reviewDecision: "",
    statusCheckRollup: [checkRun("build", "", "IN_PROGRESS")],
    mergeable: "MERGEABLE",
    headRefOid: "abc1234def",
    reviews: [],
    comments: [],
    ...overrides,
  };
}

const urlOf = (target: string) =>
  target.startsWith("https://") ? target : `https://github.com/acme/app/pull/${target}`;

describe("PullRequestWatches", () => {
  let dir: string;
  let file: string;
  /** The PR state that the fake gh returns, keyed by PR URL. */
  let prs: Map<string, Pr>;
  let hosted: Map<string, { status: string; projectId: string }>;
  let gh: ReturnType<typeof vi.fn>;
  let engine: { command: ReturnType<typeof vi.fn>; withMessageAuthor: ReturnType<typeof vi.fn> };
  let store: PullRequestWatchStore;
  let branchPr: string | null;

  const service = (path = file) =>
    new PullRequestWatches({
      file: path,
      store,
      engine: engine as unknown as PullRequestWatchEngine,
      gh: gh as unknown as (cwd: string, args: string[]) => Promise<string>,
      branchPullRequest: async () => (branchPr ? { url: branchPr } : null),
    });
  const sent = () => engine.command.mock.calls.map((call) => call[0] as Record<string, unknown>);
  const scope = (sessionId = "s1") => ({ sessionId, projectId: "project" });

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "pr-watch-"));
    file = join(dir, "pull-request-watches.json");
    prs = new Map();
    branchPr = null;
    hosted = new Map([
      ["s1", { status: "idle", projectId: "project" }],
      ["s2", { status: "idle", projectId: "project" }],
    ]);
    gh = vi.fn(async (_cwd: string, args: string[]) => {
      const target = urlOf(args[2]);
      const current = prs.get(target);
      if (!current) throw new Error(`no such pull request ${target}`);
      return JSON.stringify(current);
    });
    engine = {
      command: vi.fn(async (command: { commandId: string }) => ({ commandId: command.commandId })),
      withMessageAuthor: vi.fn(
        async (_author: unknown, work: () => Promise<unknown>) => await work(),
      ),
    };
    store = {
      session: vi.fn(async (id: string) => ({
        projectId: hosted.get(id)!.projectId,
        session: { cwd: "/repo" },
      })),
      sessionStateMetadata: vi.fn(async (id: string) =>
        hosted.has(id)
          ? { revision: 1, status: hosted.get(id)!.status, desktop: false }
          : undefined,
      ),
      project: vi.fn(async () => ({ cwd: "/repo" })),
    } as unknown as PullRequestWatchStore;
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("watches a PR by URL and reports the initial state without waking", async () => {
    const url = "https://github.com/acme/app/pull/12";
    prs.set(url, pr(url));
    const watches = service();
    const watched = await watches.watch(scope(), { url });
    expect(watched).toEqual({ watchId: expect.any(String), number: 12, url, state: "OPEN" });
    await watches.poll();
    expect(sent()).toEqual([]);
    expect(gh).toHaveBeenCalledWith("/repo", ["pr", "view", url, "--json", expect.any(String)]);
  });

  it("wakes the session once when pending checks finish, and not again without change", async () => {
    const url = "https://github.com/acme/app/pull/12";
    prs.set(url, pr(url));
    const watches = service();
    const { watchId } = await watches.watch(scope(), { url });

    prs.set(url, pr(url, { statusCheckRollup: [checkRun("build", "SUCCESS")] }));
    await watches.poll();
    expect(sent()).toEqual([
      {
        type: "send",
        commandId: expect.stringMatching(new RegExp(`^pr-watch:${watchId}:[0-9a-f]{32}$`)),
        sessionId: "s1",
        text: expect.stringContaining(
          "PR #12 (https://github.com/acme/app/pull/12): checks passing.",
        ),
      },
    ]);
    expect(engine.withMessageAuthor).toHaveBeenCalledWith(
      { kind: "automation", id: watchId, name: "PR watch", reason: "pr-watch" },
      expect.any(Function),
    );

    await watches.poll();
    expect(engine.command).toHaveBeenCalledTimes(1);
  });

  it("holds the wake while the session runs and delivers it on a later poll", async () => {
    const url = "https://github.com/acme/app/pull/12";
    prs.set(url, pr(url));
    const watches = service();
    await watches.watch(scope(), { url });

    hosted.set("s1", { status: "running", projectId: "project" });
    prs.set(url, pr(url, { reviewDecision: "CHANGES_REQUESTED" }));
    await watches.poll();
    expect(engine.command).not.toHaveBeenCalled();
    expect((await watches.list("s1"))[0].lastError).toBeUndefined();

    hosted.set("s1", { status: "idle", projectId: "project" });
    await watches.poll();
    expect(sent()).toHaveLength(1);
    expect(sent()[0].text).toContain("Review: CHANGES_REQUESTED.");
  });

  it("retries a failed wake with the same command ID so it is never sent twice", async () => {
    const url = "https://github.com/acme/app/pull/12";
    prs.set(url, pr(url));
    const watches = service();
    await watches.watch(scope(), { url });

    prs.set(url, pr(url, { reviews: [{ state: "COMMENTED" }] }));
    engine.command.mockRejectedValueOnce(new Error("host busy"));
    await watches.poll();
    expect((await watches.list("s1"))[0].lastError).toBe("host busy");

    await watches.poll();
    expect(engine.command).toHaveBeenCalledTimes(2);
    const [first, second] = sent();
    expect(second.commandId).toBe(first.commandId);
    expect(second.text).toBe(first.text);
    expect((await watches.list("s1"))[0].lastError).toBeUndefined();
  });

  it("wakes once when the PR merges, then removes the watch", async () => {
    const url = "https://github.com/acme/app/pull/12";
    prs.set(url, pr(url));
    const watches = service();
    await watches.watch(scope(), { url });

    prs.set(url, pr(url, { state: "MERGED" }));
    await watches.poll();
    expect(sent()).toHaveLength(1);
    expect(sent()[0].text).toContain("The PR was merged.");
    expect(sent()[0].text).toContain("no longer open");
    expect(await watches.list("s1")).toEqual([]);
  });

  it("records a gh failure as lastError without waking or throwing", async () => {
    const url = "https://github.com/acme/app/pull/12";
    prs.set(url, pr(url));
    const watches = service();
    await watches.watch(scope(), { url });

    gh.mockRejectedValueOnce(new Error("gh auth login required"));
    await expect(watches.poll()).resolves.toBeUndefined();
    expect(engine.command).not.toHaveBeenCalled();
    const [listed] = await watches.list("s1");
    expect(listed.lastError).toBe("gh auth login required");
    expect(listed.url).toBe(url);
  });

  it("keeps the watches of each session private", async () => {
    const url = "https://github.com/acme/app/pull/12";
    prs.set(url, pr(url));
    const watches = service();
    const { watchId } = await watches.watch(scope("s1"), { url });

    expect(await watches.list("s2")).toEqual([]);
    expect(await watches.unwatch("s2", watchId)).toBe(false);
    expect(await watches.list("s1")).toHaveLength(1);
    expect(await watches.unwatch("s1", watchId)).toBe(true);
    expect(await watches.list("s1")).toEqual([]);
  });

  it("is idempotent per session and PR, and limits each session to ten watches", async () => {
    const watches = service();
    const urls = Array.from({ length: MAX_PULL_REQUEST_WATCHES_PER_SESSION + 1 }, (_, index) =>
      urlOf(String(index + 1)),
    );
    for (const url of urls) prs.set(url, pr(url));

    const first = await watches.watch(scope(), { url: urls[0] });
    expect(await watches.watch(scope(), { url: urls[0] })).toEqual(first);
    for (const url of urls.slice(1, MAX_PULL_REQUEST_WATCHES_PER_SESSION))
      await watches.watch(scope(), { url });
    await expect(watches.watch(scope(), { url: urls[10] })).rejects.toThrow("already watches 10");
    // Another session still has its own allowance.
    await expect(watches.watch(scope("s2"), { url: urls[10] })).resolves.toMatchObject({
      number: 11,
    });
  });

  it("watches the branch PR when neither number nor URL is given", async () => {
    const url = "https://github.com/acme/app/pull/33";
    prs.set(url, pr(url));
    branchPr = url;
    const watched = await service().watch(scope(), {});
    expect(watched).toMatchObject({ number: 33, url });
  });

  it("refuses a session that this Host does not host", async () => {
    const url = "https://github.com/acme/app/pull/12";
    prs.set(url, pr(url));
    hosted.delete("s1");
    await expect(service().watch(scope(), { url })).rejects.toThrow("not hosted by this Host");
  });

  it("refuses an already merged PR and a URL that disagrees with the number", async () => {
    const url = "https://github.com/acme/app/pull/12";
    prs.set(url, pr(url, { state: "MERGED" }));
    const watches = service();
    await expect(watches.watch(scope(), { url })).rejects.toThrow("already merged");
    await expect(watches.watch(scope(), { url, number: 13 })).rejects.toThrow("does not match");
  });

  it("removes a watch whose session no longer exists", async () => {
    const url = "https://github.com/acme/app/pull/12";
    prs.set(url, pr(url));
    const watches = service();
    await watches.watch(scope(), { url });
    hosted.delete("s1");
    await watches.poll();
    expect(await watches.list("s1")).toEqual([]);
    expect(gh).toHaveBeenCalledTimes(1);
  });

  it("persists watches across a restart", async () => {
    const url = "https://github.com/acme/app/pull/12";
    prs.set(url, pr(url));
    const { watchId } = await service().watch(scope(), { url });

    const restarted = service();
    expect(await restarted.list("s1")).toMatchObject([{ watchId, number: 12, url }]);
  });

  it("refuses to write over a corrupt state file", async () => {
    await writeFile(file, "{not json");
    const url = "https://github.com/acme/app/pull/12";
    prs.set(url, pr(url));
    await expect(service().watch(scope(), { url })).rejects.toThrow("corrupt");
  });

  it("joins a poll that is already running instead of starting another", async () => {
    const url = "https://github.com/acme/app/pull/12";
    prs.set(url, pr(url));
    const watches = service();
    await watches.watch(scope(), { url });
    gh.mockClear();

    const first = watches.poll();
    expect(watches.poll()).toBe(first);
    await first;
    expect(gh).toHaveBeenCalledTimes(1);
    await watches.close();
  });

  it("lists each watch as a wake source and announces when a watch starts or ends", async () => {
    const a = "https://github.com/acme/app/pull/12";
    const b = "https://github.com/acme/app/pull/13";
    prs.set(a, pr(a));
    prs.set(b, pr(b));
    const watches = service();
    const changed = vi.fn();
    watches.onChange = changed;
    expect(watches.wakeSources("project").size).toBe(0);

    const { watchId } = await watches.watch(scope(), { url: a });
    await watches.watch(scope("s2"), { url: b });
    expect(changed).toHaveBeenCalledTimes(2);
    expect(watches.wakeSources("project").get("s1")).toEqual([
      { kind: "pull-request", label: "acme/app#12", since: expect.any(Number) },
    ]);
    expect(watches.wakeSources("other").size).toBe(0);

    // A poll that only refreshes the snapshot is not a wake-source change.
    prs.set(a, pr(a, { headRefOid: "fff0000" }));
    await watches.poll();
    expect(changed).toHaveBeenCalledTimes(2);

    await watches.unwatch("s1", watchId);
    expect(changed).toHaveBeenCalledTimes(3);
    expect(watches.wakeSources("project").has("s1")).toBe(false);
  });

  it("drops the wake source when the PR merges or the session is deleted", async () => {
    const a = "https://github.com/acme/app/pull/12";
    const b = "https://github.com/acme/app/pull/13";
    prs.set(a, pr(a));
    prs.set(b, pr(b));
    const watches = service();
    await watches.watch(scope(), { url: a });
    await watches.watch(scope("s2"), { url: b });

    prs.set(a, pr(a, { state: "MERGED" }));
    hosted.delete("s2");
    await watches.poll();
    expect(sent()).toHaveLength(1);
    expect(watches.wakeSources("project").size).toBe(0);
  });
});
