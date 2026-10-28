import { afterEach, expect, it, vi } from "vitest";
import { createMountedComposerRegistry } from "../../sessions/data/composerClosure";
import { PersistenceDrainRegistry } from "../../sessions/data/persistenceDrain";
import { createQuickComposerClosureRuntime, type QuickComposerDraft } from "./quickComposerClosure";

const initial = (): QuickComposerDraft => ({
  prompt: " \n\t",
  attachments: [],
  cwd: "/fixture",
  choice: { harness: "codex", model: "fixture" },
  modelSettings: { reasoning: "high" },
  pickedRuntimeMode: "supervised",
  workspaceChoice: { cwd: "/fixture", mode: "current" },
});
function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
function fixture() {
  const publish = vi.fn(async () => {});
  const mounted = createMountedComposerRegistry({
    registry: new PersistenceDrainRegistry(),
    publish,
  });
  const runtime = createQuickComposerClosureRuntime(mounted);
  const state = runtime.window(initial());
  const owner = runtime.bind(state);
  const gate = vi.fn();
  const detach = owner.mount({ gate });
  return { runtime, state, owner, gate, detach, publish, mounted, key: {} };
}
afterEach(() => vi.useRealTimers());

it("captures exact sessionless prompt/options and never writes a manufactured session", async () => {
  const f = fixture();
  f.owner.effective({
    model: { harness: "codex", id: "actual-model" },
    runtimeMode: "full-access",
    settings: { effort: "high" },
    workspace: { cwd: "/fixture", mode: "current" },
    workspacePending: false,
  });
  const closure = f.runtime.begin({ owner: f.key });
  const capture = await closure.captureAndFlush();
  expect(capture).toMatchObject({
    version: 1,
    qualified: false,
    draft: initial(),
    effective: { runtimeMode: "full-access", settings: { effort: "high" } },
  });
  expect(capture.rendererWindowId).not.toBe(capture.intentId);
  expect(Object.isFrozen(capture.draft.modelSettings)).toBe(true);
  expect(f.publish).not.toHaveBeenCalled();
  expect(capture.missingCoverage).toContain("native-sessionless-full-snapshot-retention");
  closure.reopen(f.key);
});

it("a target session closure conservatively gates the shared quick window before new effects", async () => {
  const f = fixture();
  const unrelated = f.mounted.registerMountedComposer({
    sessionId: "b",
    snapshot: () => ({ text: "", attachments: [], mcpTags: [] }),
  });
  const closure = f.mounted.beginComposerClosure(["a"], { owner: f.key });
  const effect = vi.fn(async () => {});
  await expect(f.owner.prepare(effect)).rejects.toMatchObject({ code: "closed" });
  expect(effect).not.toHaveBeenCalled();
  expect(unrelated.canMutate()).toBe(true);
  closure.reopen(f.key);
});

it("keeps accepted stage success and retries only a failed sibling stage", async () => {
  const f = fixture();
  const chooser = vi.fn(async () => "/fixture/original.txt");
  const inspect = vi
    .fn()
    .mockRejectedValueOnce(new Error("inspect failed"))
    .mockResolvedValue("ready");
  await expect(
    f.owner.prepare(async (accepted) => {
      const path = await accepted.stage("selection", chooser);
      await accepted.stage("inspect", inspect);
      accepted.apply(() => f.owner.update((draft) => ({ ...draft, prompt: path })));
    }),
  ).rejects.toThrow("inspect failed");
  const closure = f.runtime.begin({ owner: f.key });
  await expect(closure.captureAndFlush()).rejects.toThrow("inspect failed");
  await closure.retryFailed(f.key);
  expect((await closure.captureAndFlush()).draft.prompt).toBe("/fixture/original.txt");
  expect(chooser).toHaveBeenCalledOnce();
  expect(inspect).toHaveBeenCalledTimes(2);
  closure.reopen(f.key);
});

it("an admitted result survives actual view retirement and is visible to its replacement", async () => {
  const f = fixture();
  const held = deferred();
  const work = f.owner.prepare(async (accepted) => {
    await held.promise;
    accepted.apply(() => f.owner.update((draft) => ({ ...draft, prompt: "late original intent" })));
  });
  const identity = f.owner.intentId;
  f.detach();
  expect(f.owner.canMutate()).toBe(false);
  const next = f.runtime.bind(f.state);
  const detach = next.mount({});
  held.resolve();
  await work;
  expect(next.draft().prompt).toBe("late original intent");
  expect(next.intentId).toBe(identity);
  const closure = f.runtime.begin({ owner: f.key });
  expect((await closure.captureAndFlush()).draft.prompt).toBe("late original intent");
  closure.reopen(f.key);
  detach();
});

it("a timed-out observer keeps actual work owned, and exact reopen cannot cancel that effect", async () => {
  const f = fixture();
  const held = deferred();
  const work = f.owner.prepare(async () => {
    await held.promise;
  });
  const closure = f.runtime.begin({ owner: f.key, timeoutMs: 5 });
  await expect(closure.captureAndFlush()).rejects.toMatchObject({ code: "deadline" });
  expect(f.runtime.observation().active).toBe(1);
  expect(() => closure.reopen({})).toThrow("wrong-owner");
  closure.reopen(f.key);
  held.resolve();
  await work;
  expect(f.runtime.observation().active).toBe(0);
});

it("effective default changes invalidate a completed capture even when prompt/files are identical", async () => {
  const f = fixture();
  const closure = f.runtime.begin({ owner: f.key });
  await closure.captureAndFlush();
  f.owner.effective({
    model: { harness: "codex", id: "updated" },
    settings: {},
    runtimeMode: "full-access",
    workspace: { cwd: "/fixture" },
    workspacePending: false,
  });
  expect(() => closure.assertCurrent()).toThrow("changed");
  await expect(closure.captureAndFlush()).rejects.toThrow("changed");
  expect(f.owner.draft().prompt).toBe(initial().prompt);
  closure.reopen(f.key);
});

it("a real later options mutation cannot reuse an old immutable receipt", async () => {
  const f = fixture();
  const closure = f.runtime.begin({ owner: f.key });
  const captured = await closure.captureAndFlush();
  // An external legacy alias is not producer admission; the exact full-state
  // assertion still catches it rather than trusting the draft-only base schema.
  f.owner.draft().modelSettings.reasoning = "external late change";
  expect(() => closure.assertCurrent()).toThrow("changed");
  expect(captured.draft.modelSettings.reasoning).toBe("high");
  closure.reopen(f.key);
});

it("view roster changes invalidate capture while retaining the actual raw draft", async () => {
  const f = fixture();
  const closure = f.runtime.begin({ owner: f.key });
  await closure.captureAndFlush();
  f.detach();
  expect(() => closure.assertCurrent()).toThrow("changed");
  closure.reopen(f.key);
  expect(f.owner.draft().prompt).toBe(initial().prompt);
});

it("many normal view remounts reuse one retained window producer without evicting its draft", async () => {
  const f = fixture();
  f.detach();
  for (let index = 0; index < 300; index++) {
    const owner = f.runtime.bind(f.state);
    const detach = owner.mount({});
    owner.update((draft) => ({ ...draft, prompt: `retained ${index}` }));
    detach();
  }
  expect(f.mounted.observation().bindings).toBe(1);
  const closure = f.runtime.begin({ owner: f.key });
  expect((await closure.captureAndFlush()).draft.prompt).toBe("retained 299");
  closure.reopen(f.key);
});

it("staged capacity rejects before a new effect and retains the failed intent", async () => {
  const f = fixture();
  const effect = vi.fn(async () => "unexpected");
  await expect(
    f.owner.prepare(async (accepted) => {
      for (let index = 0; index < 64; index++)
        await accepted.stage(`known:${index}`, async () => index);
      await accepted.stage("overflow", effect);
    }),
  ).rejects.toMatchObject({ code: "capacity" });
  expect(effect).not.toHaveBeenCalled();
  const closure = f.runtime.begin({ owner: f.key });
  await expect(closure.captureAndFlush()).rejects.toMatchObject({ code: "capacity" });
  closure.reopen(f.key);
});

it("a rejected stage does not release a still-running accepted sibling", async () => {
  const f = fixture();
  const held = deferred();
  let finished = false;
  const operation = f.owner.prepare(async (accepted) => {
    await Promise.all([
      accepted.stage("failed", async () => {
        throw new Error("early rejection");
      }),
      accepted.stage("held", async () => {
        await held.promise;
      }),
    ]);
  });
  const rejected = expect(operation).rejects.toThrow("early rejection");
  void operation.then(
    () => {
      finished = true;
    },
    () => {
      finished = true;
    },
  );
  await Promise.resolve();
  await Promise.resolve();
  expect(f.runtime.observation().active).toBe(1);
  expect(f.owner.pending).toBe(true);
  expect(finished).toBe(false);
  held.resolve();
  await rejected;
  expect(f.runtime.observation().active).toBe(0);
});

it("a retry from a prior acknowledged intent rejects before further stage effects", async () => {
  const f = fixture();
  const inspect = vi.fn(async () => {
    throw new Error("Selected file unavailable");
  });
  await expect(
    f.owner.prepare(async (accepted) => {
      await accepted.stage("inspect", inspect);
    }),
  ).rejects.toThrow("Selected file unavailable");
  f.owner.nextIntent();
  const closure = f.runtime.begin({ owner: f.key });
  await expect(closure.captureAndFlush()).rejects.toThrow("Selected file unavailable");
  await expect(closure.retryFailed(f.key)).rejects.toMatchObject({ code: "changed" });
  expect(inspect).toHaveBeenCalledOnce();
  closure.reopen(f.key);
});

it("an unknown immutable external capture outcome is retained instead of reading a changed source on retry", async () => {
  const f = fixture();
  const capture = vi
    .fn()
    .mockRejectedValueOnce(new Error("Capture outcome unknown"))
    .mockResolvedValue("different clipboard");
  await expect(
    f.owner.prepare(async (accepted) => {
      await accepted.once("external", capture);
    }),
  ).rejects.toThrow("Capture outcome unknown");
  const closure = f.runtime.begin({ owner: f.key });
  await expect(closure.captureAndFlush()).rejects.toThrow("Capture outcome unknown");
  await expect(closure.retryFailed(f.key)).rejects.toThrow("Capture outcome unknown");
  expect(capture).toHaveBeenCalledOnce();
  closure.reopen(f.key);
});
