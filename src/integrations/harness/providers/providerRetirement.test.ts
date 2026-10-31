import { beforeEach, expect, it, vi } from "vitest";
import { processConstructions } from "./processConstruction.testSupport";
import { createProviderRetirementLedger } from "../core/providerRetirement";

const { rawKill } = vi.hoisted(() => ({ rawKill: vi.fn(async (_sessionId: string) => {}) }));
vi.mock("../core/child", async () => {
  const { processConstructions } = await import("./processConstruction.testSupport");
  const unexpected = () => {
    throw new Error("This stop-only protocol fixture must not start Native IO");
  };
  const fake: Record<string, unknown> = {};
  for (const name of [
    "resolveCodexBinary",
    "resolveClaudeBinary",
    "resolveCursorBinary",
    "resolveGrokBinary",
    "resolveHermesBinary",
    "resolveFxBinary",
    "resolvePiBinary",
    "resolveOmpBinary",
    "resolveAntigravityBinary",
    "resolveOpenCodeBinary",
    "spawnChild",
    "writeChild",
    "watchChild",
    "acquireHarnessBridge",
    "invokeProviderCommand",
    "startHarnessSse",
    "socialBridge",
    "runtimeLogsBridge",
    "prepareHarnessTextWorkspace",
    "readHarnessTextFile",
    "execChild",
    "freeHarnessPort",
    "harnessHttp",
    "readHarnessTaskOutput",
    "openHarnessSse",
    "watchSse",
  ])
    fake[name] = vi.fn(unexpected);
  fake.hasHeadlessChildBackend = () => true;
  fake.captureChildControlTurn = () => undefined;
  return processConstructions.mock({
    ...fake,
    killChild: rawKill,
    spawnChild: vi.fn(async () => {}),
    watchChild: vi.fn(),
    invokeProviderCommand: vi.fn(async (command: string) => {
      if (command === "generic_acp_list") return [];
      return unexpected();
    }),
    unwatchChild: vi.fn(),
    closeHarnessSse: vi.fn(async () => {}),
  });
});

vi.mock("../core/acp", async () => {
  const { processConstructions } = await import("./processConstruction.testSupport");
  return {
    AcpClient: class {
      constructor(private readonly handle: import("../core/child").ChildProcessHandle) {
        processConstructions.client(handle);
      }
      assertProcess(handle: import("../core/child").ChildProcessHandle): void {
        if (handle !== this.handle)
          throw new Error("ACP fixture client requires its original process");
      }
      withWriter(writer: import("../core/child").ChildTurnWriter) {
        return processConstructions.view(this.handle, writer, {
          request: this.request.bind(this),
          notify: this.notify.bind(this),
          respond: this.respond.bind(this),
          respondError: this.respondError.bind(this),
        });
      }
      pushLine() {}
      close() {}
      async notify() {}
      async respond() {}
      async respondError() {}
      async request(method: string) {
        if (method === "initialize") return { agentCapabilities: {} };
        if (method === "session/new") return { sessionId: "fixture-original-remote-session" };
        return {};
      }
    },
  };
});

import { killChild } from "../core/child";
import { stopCodexSession } from "./codex/codex";
import { stopClaudeSession } from "./claude/claude";
import { stopCursorSession } from "./cursor/cursor";
import { stopGrokSession } from "./grok/grok";
import { stopHermesSession } from "./hermes/hermes";
import { stopFxSession } from "./fx/fx";
import {
  stopGenericAcpSession,
  sendGenericAcpTurn,
  cancelGenericAcpTurn,
} from "./generic-acp/genericAcpAdapter";
import { stopPiSession } from "./pi/pi";
import { stopOmpSession } from "./omp/omp";
import { stopAntigravitySession } from "./antigravity/antigravity";
import { stopAntigravityStreamSession } from "./antigravity/antigravityStream";
import { stopOpenCodeSession } from "./opencode/opencode";

beforeEach(() => {
  processConstructions.reset();
  rawKill.mockReset();
  rawKill.mockResolvedValue(undefined);
});

// This specifically models an original whose local Live/startup map has already
// gone away. It exercises actual public stop callers and their retained cohort
// fallback. Provider startup/protocol behavior is covered by the Live suites;
// this fixture makes no Native process-fence or OS proof claim.
it.each([
  ["codex.main", stopCodexSession],
  ["claude.main", stopClaudeSession],
  ["cursor.main", stopCursorSession],
  ["grok.main", stopGrokSession],
  ["hermes.main", stopHermesSession],
  ["fx.main", stopFxSession],
  ["generic-acp.main", stopGenericAcpSession!],
  ["pi.main", stopPiSession],
  ["omp.main", stopOmpSession],
  ["antigravity.main", stopAntigravitySession],
  ["antigravity.stream", stopAntigravityStreamSession],
  ["opencode.main", stopOpenCodeSession],
] as const)(
  "%s retains an orphan original kill failure until retry succeeds, and an unrelated owner can close",
  async (family, stop) => {
    const logical = `retained-${family}`;
    const physical = `${logical}#original`;
    const a = processConstructions.create(physical);
    const ledger = createProviderRetirementLedger(family, killChild);
    ledger.admit(a, logical);
    const failure = new Error(`Original ${family} physical retirement unknown`);
    rawKill.mockImplementation(async (id) => {
      if (id === physical) throw failure;
    });
    // Failed physical retirement must block this owner until a successful retry.
    await expect(stop(logical)).rejects.toThrow("has not stopped");
    expect(
      processConstructions.operations
        .filter((entry) => entry.kind === "kill")
        .map((entry) => entry.handle),
    ).toEqual([a]);
    rawKill.mockResolvedValue(undefined);
    await expect(stop(logical)).resolves.toBeUndefined();
    expect(rawKill).toHaveBeenCalledTimes(2);
    expect(() => ledger.admit(processConstructions.create(physical), logical)).not.toThrow();
    const unrelatedOwner = `${logical}-unrelated`;
    const b = processConstructions.create(`${unrelatedOwner}#actual`);
    ledger.admit(b, unrelatedOwner);
    await expect(stop(unrelatedOwner)).resolves.toBeUndefined();
    expect(
      processConstructions.operations
        .filter((entry) => entry.kind === "kill")
        .map((entry) => entry.handle),
    ).toEqual([a, a, b]);
    expect(ledger.observation().failed).toBe(0);
  },
);

// Actual GenericACP composition with explicit protocol fakes. This proves its
// startup transaction ordering and handle retention, never Native OS proof.
it("GenericACP reserves B before held A teardown, cancels B without a spawn, then admits explicit C", async () => {
  const sessionId = "generic-reserved-before-original-teardown";
  const input = {
    sessionId,
    cwd: "/a",
    model: "acp:fixture-a",
    runtimeMode: "supervised" as const,
    text: "hello",
    attachments: [],
    onEvent: () => undefined,
  };
  const program = { id: "fixture-a", path: "/fake/acp", args: [], model: "fixture" };
  await sendGenericAcpTurn(input, program);
  const a = processConstructions.created.find((handle) => handle.sessionId === sessionId)!;
  let enter!: () => void, release!: () => void;
  const entered = new Promise<void>((resolve) => {
    enter = resolve;
  });
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  rawKill.mockImplementationOnce(async () => {
    enter();
    await held;
  });
  const bWork = sendGenericAcpTurn({ ...input, cwd: "/b" }, { ...program, id: "fixture-b" });
  const bOutcome = bWork.catch((error: unknown) => error);
  // Selection is behind the logical queue. Actual A retirement entry proves
  // that B has been reserved/published before observing or cancelling B.
  await entered;
  const b = processConstructions.created.filter((handle) => handle.sessionId === sessionId).at(-1)!;
  expect(b).not.toBe(a);
  const cancel = cancelGenericAcpTurn(sessionId);
  let cancelled = false;
  void cancel.then(() => {
    cancelled = true;
  });
  try {
    await entered;
    expect(cancelled).toBe(false);
    expect(
      processConstructions.operations.filter((op) => op.kind === "spawn").map((op) => op.handle),
    ).toEqual([a]);
  } finally {
    release();
  }
  await cancel;
  expect(String(await bOutcome)).toContain("ACP startup cancelled");
  expect(
    processConstructions.operations.filter((op) => op.kind === "spawn").map((op) => op.handle),
  ).toEqual([a]);
  await sendGenericAcpTurn({ ...input, cwd: "/c" }, { ...program, id: "fixture-c" });
  const c = processConstructions.created.filter((handle) => handle.sessionId === sessionId).at(-1)!;
  expect(c).not.toBe(a);
  expect(c).not.toBe(b);
  expect(
    processConstructions.operations.filter((op) => op.kind === "spawn").map((op) => op.handle),
  ).toEqual([a, c]);
  await stopGenericAcpSession!(sessionId);
  expect(
    processConstructions.operations.filter((op) => op.kind === "kill").map((op) => op.handle),
  ).toEqual([a, b, c]);
});
