import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HostStore } from "./store";
import { HostAssistant, type AssistantPorts } from "./assistant/service";
import { AssistantRepository } from "./assistant/repository";
import {
  createAssistantChiefContext,
  AssistantChiefContextUnknownError,
  CHIEF_CONTEXT_MAX_BYTES,
} from "./assistant-chief-context";
import type { AssistantTextRunner } from "./assistant-text";
import { assistantTextLimits } from "./assistant-text-budget";

type Wake = Parameters<NonNullable<AssistantPorts["chiefWake"]>>[0];
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});
const largeDecision = () =>
  JSON.stringify({
    actions: Array.from({ length: 10 }, (_, index) => ({
      op: "jobs.replan",
      id: `job-${index}`,
      expectedVersion: 1,
      feedback: "r".repeat(3000),
    })),
  });
async function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "bycoda-chief-context-"));
  const store = new HostStore(join(directory, "host.db"));
  const core = new HostAssistant(store);
  await core.ready;
  cleanups.push(async () => {
    await core.close();
    await store.close();
    rmSync(directory, { recursive: true, force: true });
  });
  const profile = (await core.request({ op: "snapshot" }, "owner")).snapshot!.profile;
  let at = 1000;
  const text = vi
    .fn<AssistantTextRunner>()
    .mockResolvedValue({ text: '{"actions":[]}', tokens: 123 });
  const context = createAssistantChiefContext(store, text, { now: () => at });
  const input = (operationId: string, extra: Partial<Wake> = {}): Wake => ({
    profile,
    stateCard: "Canonical jobs: job-0 version1, no pending approvals.",
    events: [],
    tokenCap: 1000000,
    operationId,
    signal: new AbortController().signal,
    contextPolicy: { soft: 10000, hard: 20000 },
    ...extra,
  });
  return {
    store,
    text,
    context,
    input,
    setNow(value: number) {
      at = value;
    },
    now: () => at,
  };
}

describe("durable Chief reasoning context", () => {
  it("renews before exceeding a provider-reported model window and keeps unresolved pins",async()=>{
    const f=await fixture(),profile={...f.input("profile").profile,execution:{harness:"codex" as const,model:"codex:capacity-test",modelSettings:{},runtimeMode:"supervised" as const,maxRunMinutes:30}};
    f.text.mockImplementation(async(_profile,_prompt,_signal,context)=>{await context!.onThreadId(context!.threadId??"capacity-thread");return{text:'{"actions":[]}',contextWindow:12000};});
    await f.context.wake(f.input("capacity-first",{profile}));
    const repository=new AssistantRepository(f.store);
    await f.store.transaction(async()=>{
      const record=await repository.get<any>("runtime","chiefContext:v1");
      record.value.provider.estimatedTokens=10000;
      record.value.unresolved=[{operationId:"retained-pending",index:0,jobId:"job",requestId:"original-action",status:"unknown"}];
      await repository.put("runtime",record,record.version);
    });
    const before=await f.context.status();
    await f.context.wake(f.input("capacity-second",{profile}));
    expect((await f.context.status()).generation).toBe(before.generation+1);
    expect(f.text.mock.calls[1][3]?.threadId).toBeUndefined();
    expect(f.text.mock.calls[1][1]).toContain("original-action");
  });
  it("uses the retained local briefing time for a daily provider renewal",async()=>{
    const f=await fixture(),repository=new AssistantRepository(f.store);
    await f.store.transaction(()=>repository.put("runtime",{id:"briefingSchedule",version:0,createdAt:1,updatedAt:1,value:{enabled:true,time:"11:30"}}));
    f.setNow(new Date(2026,10,2,23).getTime());await f.context.wake(f.input("cycle-evening"));
    const generation=(await f.context.status()).generation;
    f.setNow(new Date(2026,10,3,11,29).getTime());await f.context.wake(f.input("cycle-before"));
    expect((await f.context.status()).generation).toBe(generation);
    f.setNow(new Date(2026,10,3,11,30).getTime());await f.context.wake(f.input("cycle-due"));
    expect((await f.context.status()).generation).toBe(generation+1);
    expect((await f.context.status()).day).toBe("2026-11-03");
  });
  it("renews a retained old provider epoch before attempting another soft compact", async () => {
    const f = await fixture(),
      profile = {
        ...f.input("profile").profile,
        execution: { harness: "codex" as const, model: "codex:test", modelSettings: {} },
      };
    f.text.mockImplementation(async (_profile, _prompt, _signal, context) => {
      await context!.onThreadId(context!.threadId ?? "new-thread");
      return { text: '{"actions":[]}' };
    });
    await f.context.wake(f.input("old-provider", { profile }));
    const repository = new AssistantRepository(f.store);
    await repository.initialize();
    await f.store.transaction(async () => {
      const record = await repository.get<{
        id: string;
        version: number;
        createdAt: number;
        updatedAt: number;
        value: { generation: number; provider: { estimatedTokens: number } };
      }>("runtime", "chiefContext:v1");
      record!.value.generation++;
      record!.value.provider.estimatedTokens = 11000;
      await repository.put("runtime", record!, record!.version);
    });
    await f.context.wake(
      f.input("after-renewal", { profile, contextPolicy: { soft: 10000, hard: 100000 } }),
    );
    expect(f.text.mock.calls[1][3]).toMatchObject({ compactBefore: false });
    expect(f.text.mock.calls[1][3]?.threadId).toBeUndefined();
  });
  it("keeps the same isolated provider thread at soft compaction and saves its receipt before reasoning", async () => {
    const f = await fixture(),
      repository = new AssistantRepository(f.store);
    await repository.initialize();
    const profile = {
      ...f.input("profile").profile,
      execution: { harness: "codex" as const, model: "codex:test", modelSettings: {} },
    };
    const policy = { soft: 10000, hard: 100000 };
    let completed = 0;
    f.text.mockImplementation(async (_profile, prompt, _signal, context) => {
      await context!.onThreadId(context!.threadId ?? "chief-original");
      if (context!.compactBefore) {
        expect(context!.threadId).toBe("chief-original");
        expect(prompt).toContain('"priorDecisions":[]');
        expect(prompt).toContain('"operationId":"first"');
        expect(prompt).toContain('"operationId":"second"');
        expect(prompt).toContain("CURRENT CANONICAL STATE");
        await context!.onCompacted!({ threadId: "chief-original" });
        const receipt = await repository.get<{
          id: string;
          version: number;
          createdAt: number;
          updatedAt: number;
          value: { status: string; compaction?: { threadId: string } };
        }>("runtime", "chiefContextOperation:third");
        expect(receipt?.value).toMatchObject({
          status: "started",
          compaction: { threadId: "chief-original" },
        });
        completed++;
      }
      return { text: largeDecision(), tokens: 500 };
    });
    for (const id of ["first", "second", "third"])
      await f.context.wake(f.input(id, { profile, contextPolicy: policy }));
    expect(completed).toBe(1);
    expect(f.text.mock.calls[2][3]?.compactBefore).toBe(true);
    for(const call of f.text.mock.calls)expect(call[4]).toEqual(assistantTextLimits(call[1],1000000,call[3]?.compactBefore?2:1));
    expect(await f.context.status()).toMatchObject({
      generation: 1,
      compactions: 1,
      unresolvedOperations: 30,
      providerThread: {
        id: "chief-original",
        retainedSizeSource: "compacted-handoff-estimate",
        lastCompaction: { operationId: "third" },
      },
    });
    const restarted = createAssistantChiefContext(f.store, f.text, { now: f.now });
    await restarted.wake(f.input("third", { profile, contextPolicy: policy }));
    expect(f.text).toHaveBeenCalledTimes(3);
  });
  it("parks an unconfirmed provider compaction durably without accepting or replaying a decision", async () => {
    const f = await fixture(),
      profile = {
        ...f.input("profile").profile,
        execution: { harness: "claude" as const, model: "claude:test", modelSettings: {} },
      },
      policy = { soft: 10000, hard: 100000 };
    f.text.mockImplementation(async (_profile, _prompt, _signal, context) => {
      await context!.onThreadId(context!.threadId ?? "chief-original");
      return { text: largeDecision() };
    });
    await f.context.wake(f.input("first", { profile, contextPolicy: policy }));
    await f.context.wake(f.input("second", { profile, contextPolicy: policy }));
    const input = f.input("third", { profile, contextPolicy: policy });
    await expect(f.context.wake(input)).rejects.toBeInstanceOf(AssistantChiefContextUnknownError);
    const restarted = createAssistantChiefContext(f.store, f.text, { now: f.now });
    await expect(restarted.wake(input)).rejects.toBeInstanceOf(AssistantChiefContextUnknownError);
    expect(f.text).toHaveBeenCalledTimes(3);
    expect((await restarted.status()).providerThread?.id).toBe("chief-original");
  });
  it("retains a real compact receipt when subsequent reasoning fails and never replays either phase", async () => {
    const f = await fixture(),
      profile = {
        ...f.input("profile").profile,
        execution: { harness: "codex" as const, model: "codex:test", modelSettings: {} },
      },
      policy = { soft: 10000, hard: 100000 };
    f.text.mockImplementation(async (_profile, _prompt, _signal, context) => {
      await context!.onThreadId(context!.threadId ?? "chief-original");
      if (context!.compactBefore) {
        await context!.onCompacted!({ threadId: "chief-original" });
        throw new Error("reasoning transport lost");
      }
      return { text: largeDecision() };
    });
    await f.context.wake(f.input("first", { profile, contextPolicy: policy }));
    await f.context.wake(f.input("second", { profile, contextPolicy: policy }));
    const input = f.input("third", { profile, contextPolicy: policy });
    await expect(f.context.wake(input)).rejects.toBeInstanceOf(AssistantChiefContextUnknownError);
    const repository = new AssistantRepository(f.store);
    await repository.initialize();
    expect(
      (
        await repository.get<{
          id: string;
          version: number;
          createdAt: number;
          updatedAt: number;
          value: { status: string; compaction?: { threadId: string } };
        }>("runtime", "chiefContextOperation:third")
      )?.value,
    ).toMatchObject({ status: "unknown", compaction: { threadId: "chief-original" } });
    const restarted = createAssistantChiefContext(f.store, f.text, { now: f.now });
    await expect(restarted.wake(input)).rejects.toBeInstanceOf(AssistantChiefContextUnknownError);
    expect(f.text).toHaveBeenCalledTimes(3);
    expect((await restarted.status()).unresolvedOperations).toBe(21);
  });
  it("resumes its exact provider thread across Host context restarts and rotates on a new day or execution identity", async () => {
    const f = await fixture();
    const profile = {
      ...f.input("profile").profile,
      execution: {
        harness: "codex" as const,
        model: "codex:test",
        modelSettings: { effort: "low" },
      },
    };
    let created = 0;
    f.text.mockImplementation(async (_profile, _prompt, _signal, context) => {
      expect(context).toBeDefined();
      await context!.onThreadId(context!.threadId ?? `chief-${++created}`);
      return { text: '{"actions":[]}' };
    });
    await f.context.wake(f.input("saved", { profile }));
    expect((await f.context.status()).providerThread?.id).toBe("chief-1");
    const restarted = createAssistantChiefContext(f.store, f.text, { now: f.now });
    await restarted.wake(f.input("resumed", { profile }));
    expect(f.text.mock.calls[1][3]?.threadId).toBe("chief-1");
    f.setNow(new Date(1970,0,2,9).getTime());
    await restarted.wake(f.input("new-day", { profile }));
    expect(f.text.mock.calls[2][3]?.threadId).toBeUndefined();
    await restarted.wake(
      f.input("new-model", {
        profile: { ...profile, execution: { ...profile.execution, model: "codex:other" } },
      }),
    );
    expect(f.text.mock.calls[3][3]?.threadId).toBeUndefined();
    expect(created).toBe(3);
  });
  it("keeps an allocated provider identity with an uncertain operation without replaying it", async () => {
    const f = await fixture();
    const profile = {
      ...f.input("profile").profile,
      execution: { harness: "claude" as const, model: "claude:test", modelSettings: {} },
    };
    f.text.mockImplementationOnce(async (_profile, _prompt, _signal, context) => {
      await context!.onThreadId("original-chief");
      throw new Error("transport lost");
    });
    await expect(f.context.wake(f.input("unknown-provider", { profile }))).rejects.toBeInstanceOf(
      AssistantChiefContextUnknownError,
    );
    const restarted = createAssistantChiefContext(f.store, f.text, { now: f.now });
    await expect(restarted.wake(f.input("unknown-provider", { profile }))).rejects.toBeInstanceOf(
      AssistantChiefContextUnknownError,
    );
    expect((await restarted.status()).providerThread?.id).toBe("original-chief");
    expect(f.text).toHaveBeenCalledOnce();
  });
  it("does not claim a persistent provider thread for an adapter without resumable text support", async () => {
    const f = await fixture();
    const profile = {
      ...f.input("profile").profile,
      execution: { harness: "cursor" as const, model: "cursor:test", modelSettings: {} },
    };
    await f.context.wake(f.input("isolated-compatibility", { profile }));
    expect(f.text.mock.calls[0][3]).toBeUndefined();
    expect((await f.context.status()).providerThread).toBeNull();
  });
  it("returns actual metrics and deduplicates a completed operation across adapter restart", async () => {
    const f = await fixture();
    const input = f.input("exact-operation", { tokenCap: 8000 });
    f.text.mockResolvedValue({ text: '{"actions":[]}', tokens: 12345 });
    expect(await f.context.wake(input)).toEqual({ actions: [], tokens: 12345 });
    const nextRunner = vi.fn<AssistantTextRunner>();
    const restarted = createAssistantChiefContext(f.store, nextRunner, { now: f.now });
    expect(await restarted.wake({ ...input, signal: new AbortController().signal })).toEqual({
      actions: [],
      tokens: 12345,
    });
    expect(f.text).toHaveBeenCalledOnce();
    expect(nextRunner).not.toHaveBeenCalled();
    expect((await restarted.status()).estimatedRetainedTokens).toBeGreaterThan(0);
  });
  it("rejects changed input for the same operation before another provider call", async () => {
    const f = await fixture();
    await f.context.wake(f.input("same-id"));
    await expect(
      f.context.wake(f.input("same-id", { stateCard: "Changed canonical state" })),
    ).rejects.toThrow("changed input");
    expect(f.text).toHaveBeenCalledOnce();
  });
  it("deduplicates concurrent identical wake submissions", async () => {
    const f = await fixture();
    const input = f.input("concurrent");
    const [first, second] = await Promise.all([f.context.wake(input), f.context.wake(input)]);
    expect(second).toEqual(first);
    expect(f.text).toHaveBeenCalledOnce();
  });
  it("compacts retained decisions at the soft threshold without an extra model call", async () => {
    const f = await fixture();
    f.text.mockResolvedValue({ text: largeDecision(), tokens: 500 });
    await f.context.wake(f.input("first"));
    await f.context.wake(f.input("second"));
    expect((await f.context.status()).compactions).toBe(0);
    await f.context.wake(f.input("third"));
    const status = await f.context.status();
    expect(status.compactions).toBe(1);
    expect(status.generation).toBe(1);
    expect(status.unresolvedOperations).toBe(30);
    const prompt = f.text.mock.calls[2][1];
    expect(prompt).toContain('"priorDecisions":[]');
    expect(prompt).toContain('"operationId":"first"');
    expect(prompt).toContain('"operationId":"second"');
    expect(f.text).toHaveBeenCalledTimes(3);
  });
  it("renews at the hard threshold from current canonical state and preserves unresolved IDs", async () => {
    const f = await fixture();
    f.text.mockResolvedValue({ text: largeDecision() });
    await f.context.wake(f.input("hard-first"));
    await f.context.wake(f.input("hard-second"));
    await f.context.wake(
      f.input("hard-third", { stateCard: `CURRENT changed job version2 ${"c".repeat(24000)}` }),
    );
    const status = await f.context.status();
    expect(status.renewals).toBe(1);
    expect(status.generation).toBe(2);
    expect(f.text.mock.calls[2][1]).toContain("CURRENT changed job version2");
    expect(f.text.mock.calls[2][1]).toContain('"priorDecisions":[]');
    expect(status.unresolvedOperations).toBe(30);
  });
  it("renews the logical generation daily without claiming a provider session", async () => {
    const f = await fixture();
    await f.context.wake(f.input("yesterday"));
    f.setNow(new Date(1970,0,2,9).getTime());
    await f.context.wake(f.input("today", { stateCard: "Canonical morning state" }));
    expect(await f.context.status()).toMatchObject({
      generation: 2,
      renewals: 1,
      day: "1970-01-02",
    });
    expect(f.text.mock.calls[1][1]).toContain("Canonical morning state");
    expect(f.text.mock.calls[1][1]).not.toContain("/compact");
  });
  it("compacts early for total-token reservation headroom, retaining every open intervention ID", async () => {
    const f = await fixture();
    f.text.mockResolvedValue({ text: largeDecision() });
    const policy = { soft: 150000, hard: 250000 };
    await f.context.wake(f.input("budget-first", { contextPolicy: policy }));
    await f.context.wake(f.input("budget-second", { contextPolicy: policy }));
    f.text.mockResolvedValue({ text: '{"actions":[]}' });
    await f.context.wake(f.input("budget-third", { contextPolicy: policy, tokenCap: 10000 }));
    expect((await f.context.status()).compactions).toBe(1);
    const prompt = f.text.mock.calls[2][1];
    expect(Buffer.byteLength(prompt, "utf8")).toBeLessThanOrEqual(26000);
    expect(prompt).toContain('"operationId":"budget-first","index":9');
    expect(prompt).toContain('"operationId":"budget-second","index":9');
  });
  it("refuses a canonical input that cannot fit rather than truncating unresolved IDs or overspending silently", async () => {
    const f = await fixture();
    await expect(
      f.context.wake(f.input("too-large", { stateCard: "x".repeat(10000), tokenCap: 1000 })),
    ).rejects.toThrow("context reservation");
    expect(f.text).not.toHaveBeenCalled();
  });
  it("enforces an independent absolute byte ceiling despite larger configured limits", async () => {
    const f = await fixture();
    await expect(
      f.context.wake(
        f.input("absolute-limit", {
          stateCard: "x".repeat(CHIEF_CONTEXT_MAX_BYTES + 1),
          contextPolicy: { soft: 1000000, hard: 2000000 },
        }),
      ),
    ).rejects.toThrow("context reservation");
    expect(f.text).not.toHaveBeenCalled();
  });
  it("marks interrupted reasoning unknown durably and never blindly replays it", async () => {
    const f = await fixture();
    f.text.mockRejectedValueOnce(new Error("Transport ended before usage acknowledgement"));
    const input = f.input("interrupted");
    await expect(f.context.wake(input)).rejects.toMatchObject({
      code: "ASSISTANT_CHIEF_CONTEXT_UNKNOWN",
      operationId: "interrupted",
    });
    const nextRunner = vi.fn<AssistantTextRunner>();
    const restarted = createAssistantChiefContext(f.store, nextRunner, { now: f.now });
    await expect(restarted.wake(input)).rejects.toBeInstanceOf(AssistantChiefContextUnknownError);
    expect(nextRunner).not.toHaveBeenCalled();
    expect((await restarted.status()).unresolvedOperations).toBe(1);
    f.setNow(86401000);
    await f.context.wake(f.input("new-review"));
    expect(f.text.mock.calls[1][1]).toContain(
      '"operationId":"interrupted","index":-1,"status":"unknown"',
    );
  });
  it("treats a durable started receipt after a crash as unknown even when canonical state changed", async () => {
    const f = await fixture();
    const repository = new AssistantRepository(f.store);
    await f.store.transaction(() =>
      repository.put("runtime", {
        id: "chiefContextOperation:crashed",
        version: 0,
        createdAt: 1000,
        updatedAt: 1000,
        value: { fingerprint: "previous-state", status: "started" },
      }),
    );
    const restarted = createAssistantChiefContext(f.store, f.text, { now: f.now });
    await expect(
      restarted.wake(f.input("crashed", { stateCard: "New live job versions after restart" })),
    ).rejects.toMatchObject({ code: "ASSISTANT_CHIEF_CONTEXT_UNKNOWN", operationId: "crashed" });
    expect(f.text).not.toHaveBeenCalled();
  });
  it("removes only explicitly settled action pins from later reasoning context", async () => {
    const f = await fixture();
    f.text.mockResolvedValueOnce({ text: largeDecision() });
    await f.context.wake(f.input("actions"));
    const repository = new AssistantRepository(f.store);
    await f.store.transaction(() =>
      repository.put("runtime", {
        id: "chiefAction:actions:0",
        version: 0,
        createdAt: 1000,
        updatedAt: 1000,
        value: "settled",
      }),
    );
    await f.context.wake(f.input("after-settlement"));
    expect((await f.context.status()).unresolvedOperations).toBe(9);
    const prompt = f.text.mock.calls[1][1];
    expect(prompt).not.toContain('"operationId":"actions","index":0');
    expect(prompt).toContain('"operationId":"actions","index":9');
  });
});
