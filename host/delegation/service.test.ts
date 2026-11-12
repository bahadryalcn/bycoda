import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { HostModelCatalog } from "../../src/features/connections/model/protocol";
import type { Block, Session } from "../../src/features/sessions/model/session";
import {
  CROSS_ADVISOR_KEY,
  CROSS_SUBAGENTS_KEY,
  DELEGATION_LIMITS,
  DELEGATION_PARENT_KEY,
  type DelegateModelRef,
} from "../../src/shared/model/host-contracts/delegation";
import { STOPPED_BY_USER } from "../sessions/sessionRuns";
import { ConversationDelegation, type AgentsCaller } from "./service";

type Command = { type: string } & Record<string, unknown>;
type Entry = {
  projectId: string;
  status: "idle" | "running" | "interrupted";
  runId?: string;
  revision: number;
  updatedAt: number;
  session: Session;
};

/** In-memory Host: sessions, the turn lifecycle and the commands `launchSessionRun` sends. */
class FakeHost {
  readonly entries = new Map<string, Entry>();
  readonly commands: Command[] = [];
  private seq = 0;
  readonly store = {
    session: async (sessionId: string) => {
      const entry = this.entries.get(sessionId);
      if (!entry) throw new Error(`no session ${sessionId}`);
      return entry;
    },
  };
  readonly engine = {
    store: this.store,
    command: async (command: Command) => this.handle(command),
    updateSession: async () => undefined,
  };

  add(sessionId: string, options: Partial<Pick<Entry, "projectId">> & Partial<Session> = {}) {
    const { projectId = "p", ...session } = options;
    this.entries.set(sessionId, {
      projectId,
      status: "idle",
      revision: 0,
      updatedAt: 0,
      session: {
        blocks: [],
        modelSettings: {},
        runtimeMode: "default",
        ...session,
      } as unknown as Session,
    });
  }

  featureSession = async (sessionId: string) => {
    const entry = await this.store.session(sessionId);
    return { projectId: entry.projectId, session: entry.session };
  };

  private handle(command: Command): Record<string, unknown> {
    this.commands.push(command);
    if (command.type === "create") {
      const sessionId = `child-${++this.seq}`;
      this.add(sessionId, {
        projectId: command.projectId as string,
        modelSettings: command.modelSettings as Record<string, string>,
        runtimeMode: command.runtimeMode as Session["runtimeMode"],
      });
      return { sessionId };
    }
    const entry = this.entries.get(String(command.sessionId));
    if (!entry) throw new Error("missing session");
    if (command.type === "configure") {
      entry.session = {
        ...entry.session,
        harness: command.harness,
        model: command.model,
        providerAccountId: command.providerAccountId,
        modelSettings: command.modelSettings,
      } as Session;
      return {};
    }
    if (command.type === "send") {
      entry.status = "running";
      entry.runId = `turn-${++this.seq}`;
      this.append(entry, { role: "user", text: String(command.text) } as Block);
      return {};
    }
    if (command.type === "cancel") {
      entry.status = "idle";
      this.append(entry, { role: "system", text: STOPPED_BY_USER } as Block);
      return {};
    }
    throw new Error(`unexpected command ${command.type}`);
  }

  /** New array each time: the approval check caches by array identity. */
  append(entry: Entry, block: Block) {
    entry.session.blocks = [...entry.session.blocks, block];
  }

  /** The child's turn completes with an assistant reply. */
  finish(sessionId: string, text: string) {
    const entry = this.entries.get(sessionId)!;
    entry.status = "idle";
    this.append(entry, { role: "assistant", text } as Block);
  }

  /** The child's turn ends with a system note, as the Host records a failed turn. */
  fail(sessionId: string, note: string) {
    const entry = this.entries.get(sessionId)!;
    entry.status = "idle";
    this.append(entry, { role: "system", text: note } as Block);
  }

  /** The child is blocked on an approval it has not decided. */
  needInput(sessionId: string) {
    this.append(this.entries.get(sessionId)!, {
      role: "approval",
      text: "",
      approval: { decided: false },
    } as unknown as Block);
  }

  commandsOf(type: string) {
    return this.commands.filter((command) => command.type === type);
  }
}

const catalog = {
  models: {
    claude: [{ id: "claude:sonnet-5", harness: "claude", name: "Claude Sonnet 5" }],
    codex: [
      { id: "codex:gpt-6.1", harness: "codex", name: "GPT 6.1" },
      { id: "codex:gpt-5", harness: "codex", name: "GPT 5" },
    ],
  },
  errors: {},
} as unknown as HostModelCatalog;

const claudeSonnet: DelegateModelRef = { harness: "claude", model: "claude:sonnet-5" };
const codexFive: DelegateModelRef = { harness: "codex", model: "codex:gpt-5" };
const codexSix: DelegateModelRef = { harness: "codex", model: "codex:gpt-6.1" };
const parent: AgentsCaller = { sessionId: "parent", projectId: "p" };
const locate = async () => undefined;

let directory: string;
let host: FakeHost;
let deps: ConstructorParameters<typeof ConversationDelegation>[0];
let delegation: ConversationDelegation;

function setup(
  options: {
    subagents?: DelegateModelRef[];
    advisor?: DelegateModelRef;
    providers?: ("claude" | "codex")[];
    worktreeCwd?: string;
  } = {},
) {
  host = new FakeHost();
  host.add("parent", {
    runtimeMode: "default",
    ...(options.worktreeCwd ? { worktreeCwd: options.worktreeCwd } : {}),
    modelSettings: {
      effort: "high",
      ...(options.subagents ? { [CROSS_SUBAGENTS_KEY]: JSON.stringify(options.subagents) } : {}),
      ...(options.advisor ? { [CROSS_ADVISOR_KEY]: JSON.stringify(options.advisor) } : {}),
    },
  } as Partial<Session>);
  deps = {
    engine: host.engine as never,
    directory,
    featureSession: host.featureSession,
    models: async () => catalog,
    providers: options.providers ?? ["claude", "codex"],
    authStatus: async () => "signedIn",
  };
  delegation = new ConversationDelegation(deps);
  return delegation;
}

const call = (
  action: string,
  args: Record<string, unknown> = {},
  caller: AgentsCaller = parent,
): Promise<Record<string, unknown>> =>
  delegation.call(action, args, caller, locate) as Promise<Record<string, unknown>>;

const delegate = (requestId: string, extra: Record<string, unknown> = {}) =>
  call("agents.delegate", { requestId, title: "Review", prompt: "Check the parser", ...extra });

const consult = (requestId: string, question = "Is this safe?") =>
  call("agents.consult", { requestId, question });

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "delegation-service-"));
});
afterEach(() => {
  rmSync(directory, { recursive: true, force: true });
});

describe("agents.options", () => {
  it("lists the selected models by readable ref key with availability and running counts", async () => {
    setup({ subagents: [claudeSonnet, codexFive], advisor: codexSix });
    const options = await call("agents.options");
    expect(options).toEqual({
      subagents: [
        {
          ref: "claude:sonnet-5",
          harness: "claude",
          model: "claude:sonnet-5",
          label: "Claude Sonnet 5",
          available: true,
          effortLevels: [],
        },
        {
          ref: "codex:gpt-5",
          harness: "codex",
          model: "codex:gpt-5",
          label: "GPT 5",
          available: true,
          effortLevels: [],
        },
      ],
      advisor: {
        ref: "codex:gpt-6.1",
        harness: "codex",
        model: "codex:gpt-6.1",
        label: "GPT 6.1",
        available: true,
        effortLevels: [],
      },
      running: { subagents: 0, advisors: 0 },
      limits: {
        runningSubagents: DELEGATION_LIMITS.runningSubagents,
        runningAdvisors: DELEGATION_LIMITS.runningAdvisors,
      },
    });
  });

  it("reports a running subagent in the running counts", async () => {
    setup({ subagents: [claudeSonnet] });
    await delegate("req-1");
    expect(await call("agents.options")).toMatchObject({ running: { subagents: 1, advisors: 0 } });
  });

  it("reports a selected model whose provider was disabled after the setting was saved", async () => {
    setup({ advisor: codexSix, providers: ["claude"] });
    expect(await call("agents.options")).toMatchObject({
      advisor: { ref: "codex:gpt-6.1", available: false },
    });
    await expect(consult("req-1")).rejects.toThrow("The selected model is unavailable.");
    expect(host.commandsOf("create")).toHaveLength(0);
  });

  it("reports a selected model that the Host catalog no longer lists as unavailable", async () => {
    setup({ subagents: [{ harness: "codex", model: "codex:removed" }] });
    expect(await call("agents.options")).toMatchObject({
      subagents: [{ ref: "codex:removed", available: false }],
    });
    await expect(delegate("req-1")).rejects.toThrow("The selected model is unavailable.");
  });
});

describe("agents.delegate model selection", () => {
  it("keeps a legacy Claude family alias usable alongside another provider", async () => {
    setup({
      subagents: [{ harness: "claude", model: "haiku", providerAccountId: "work" }, codexFive],
    });
    const options = await call("agents.options");
    expect((options.subagents as unknown[])[0]).toMatchObject({
      ref: "claude:haiku@work",
      available: true,
    });
    await delegate("req-alias", { model: "claude:haiku@work" });
    expect(host.commandsOf("create")[0]).toMatchObject({
      harness: "claude",
      model: "haiku",
      providerAccountId: "work",
    });
  });

  it("does not accept arbitrary unknown Claude model names", async () => {
    setup({ subagents: [{ harness: "claude", model: "invented" }] });
    await expect(delegate("req-invalid")).rejects.toThrow("The selected model is unavailable");
    expect(host.commandsOf("create")).toHaveLength(0);
  });
  it("rejects signed-out or unverifiable exact accounts before creating a child", async () => {
    setup({ subagents: [{ ...codexFive, providerAccountId: "work" }] });
    const checks: Array<[string, string | undefined]> = [];
    deps.authStatus = async (provider, account) => {
      checks.push([provider, account]);
      return "signedOut";
    };
    await expect(delegate("req-auth")).rejects.toThrow(
      "account (work) is signed out or its sign-in expired",
    );
    expect(checks).toEqual([["codex", "work"]]);
    expect(host.commandsOf("create")).toHaveLength(0);
    deps.authStatus = async () => "unknown";
    await expect(delegate("req-unknown")).rejects.toThrow("Could not verify sign-in");
    expect(host.commandsOf("create")).toHaveLength(0);
  });
  it("uses the only selected subagent model without a model field", async () => {
    setup({ subagents: [codexFive] });
    const result = await delegate("req-1");
    expect(result).toMatchObject({
      status: "running",
      model: { harness: "codex", model: "codex:gpt-5" },
    });
    expect(host.commandsOf("create")[0]).toMatchObject({ harness: "codex", model: "codex:gpt-5" });
  });

  it("rejects an explicit mismatched model even when only one is selected", async () => {
    setup({ subagents: [{ ...codexFive, providerAccountId: "work" }] });
    await expect(delegate("req-1", { model: "codex:gpt-5@other" })).rejects.toThrow(
      "Field model is not one of the selected subagent models.",
    );
    expect(host.commandsOf("create")).toHaveLength(0);
  });

  it("reports the account error when session creation fails", async () => {
    setup({ subagents: [{ ...codexFive, providerAccountId: "work" }] });
    host.engine.command = async () => {
      throw new Error("Provider account is not available on this Host");
    };
    await expect(delegate("req-1")).rejects.toThrow(
      "Provider account is not available on this Host",
    );
  });

  it("requires a model field when more than one subagent model is selected", async () => {
    setup({ subagents: [claudeSonnet, codexFive] });
    await expect(delegate("req-1")).rejects.toThrow(
      "Field model is required when more than one subagent model is selected.",
    );
    expect(host.commandsOf("create")).toHaveLength(0);
  });

  it("rejects a model that is not in the caller's selected list", async () => {
    setup({ subagents: [claudeSonnet, codexFive] });
    await expect(delegate("req-1", { model: "codex:gpt-6.1" })).rejects.toThrow(
      "Field model is not one of the selected subagent models.",
    );
    await expect(delegate("req-2", { model: "claude:sonnet-5-other" })).rejects.toThrow(
      "Field model is not one of the selected subagent models.",
    );
    expect(host.commandsOf("create")).toHaveLength(0);
  });

  it("accepts a ref key read from agents.options and starts that model", async () => {
    setup({ subagents: [claudeSonnet, codexFive] });
    const options = await call("agents.options");
    const ref = (options.subagents as { ref: string }[])[1]!.ref;
    expect(ref).toBe("codex:gpt-5");
    const result = await delegate("req-1", { model: ref });
    expect(result).toMatchObject({ model: { harness: "codex", model: "codex:gpt-5" } });
    expect(host.commandsOf("create")[0]).toMatchObject({ model: "codex:gpt-5" });
  });

  it("rejects consult when no advisor model is selected", async () => {
    setup({ subagents: [claudeSonnet] });
    await expect(consult("req-1")).rejects.toThrow("No advisor model is selected");
  });
});

describe("launch", () => {
  it("starts a subagent in the parent's project, folder and runtime mode, without advisor intent", async () => {
    setup({ subagents: [codexFive], worktreeCwd: "/worktrees/feature" });
    host.entries.get("parent")!.session.runtimeMode = "auto-accept-edits";
    await delegate("req-1");
    const create = host.commandsOf("create")[0]!;
    expect(create).toMatchObject({
      projectId: "p",
      workspaceMode: "current",
      worktreeCwd: "/worktrees/feature",
      runtimeMode: "auto-accept-edits",
    });
    expect(host.commandsOf("send")[0]).not.toHaveProperty("intent");
  });

  it("gives the child its own model defaults and the parent link, never the owner's reserved keys", async () => {
    setup({ subagents: [codexFive], advisor: codexSix });
    const result = await delegate("req-1");
    const settings = (host.commandsOf("create")[0]!.modelSettings ?? {}) as Record<string, string>;
    expect(settings).not.toHaveProperty(CROSS_SUBAGENTS_KEY);
    expect(settings).not.toHaveProperty(CROSS_ADVISOR_KEY);
    expect(settings).not.toHaveProperty("effort");
    expect(JSON.parse(settings[DELEGATION_PARENT_KEY]!)).toEqual({
      parentSessionId: "parent",
      runId: result.runId,
      kind: "subagent",
      model: "codex:gpt-5",
      startedAt: expect.any(Number),
    });
  });

  it("advisor launch uses plan intent and a read-only brief with the question and context", async () => {
    setup({ advisor: codexSix });
    await call("agents.consult", {
      requestId: "req-1",
      question: "Is the migration safe?",
      context: "It drops a column.",
    });
    const send = host.commandsOf("send")[0]!;
    expect(send.intent).toBe("plan");
    expect(String(send.text)).toContain("Read-only");
    expect(String(send.text)).toContain("Is the migration safe?");
    expect(String(send.text)).toContain("It drops a column.");
    expect(host.commandsOf("create")[0]).toMatchObject({ model: "codex:gpt-6.1" });
  });

  it("subagent brief carries the parent's task and the scope and publish rules", async () => {
    setup({ subagents: [codexFive] });
    await delegate("req-1", { title: "Parser", prompt: "Fix the tokenizer" });
    const text = String(host.commandsOf("send")[0]!.text);
    expect(text).toContain("Fix the tokenizer");
    expect(text).toContain("Do not commit, push, open a pull request");
  });
});

describe("requests and limits", () => {
  it("returns the same run for the same requestId without starting a second child", async () => {
    setup({ subagents: [codexFive] });
    const first = await delegate("req-1");
    const second = await delegate("req-1");
    expect(second.runId).toBe(first.runId);
    expect(second.sessionId).toBe(first.sessionId);
    expect(host.commandsOf("create")).toHaveLength(1);
  });

  it("rejects a different payload that reuses a requestId", async () => {
    setup({ subagents: [codexFive] });
    await delegate("req-1");
    await expect(delegate("req-1", { prompt: "Something else" })).rejects.toThrow(
      "requestId was already used with a different payload.",
    );
  });

  it("enforces the running subagent limit", async () => {
    setup({ subagents: [codexFive] });
    for (let index = 0; index < DELEGATION_LIMITS.runningSubagents; index++) {
      await delegate(`req-${index}`);
    }
    await expect(delegate("req-over")).rejects.toThrow("Running subagent limit reached.");
    expect(host.commandsOf("create")).toHaveLength(DELEGATION_LIMITS.runningSubagents);
  });

  it("allows one running advisor at a time", async () => {
    setup({ advisor: codexSix });
    await consult("req-1");
    await expect(consult("req-2")).rejects.toThrow("An advisor is already running.");
    expect(host.commandsOf("create")).toHaveLength(1);
  });
});

describe("agents.wait", () => {
  it("returns running when the timeout passes before the child finishes", async () => {
    setup({ subagents: [codexFive] });
    const started = await delegate("req-1");
    const waited = await call("agents.wait", { runId: started.runId, timeoutSeconds: 1 });
    expect(waited).toMatchObject({ runId: started.runId, status: "running" });
    expect(waited).not.toHaveProperty("result");
  });

  it("surfaces needsInput when the child waits for an approval", async () => {
    setup({ subagents: [codexFive] });
    const started = await delegate("req-1");
    host.needInput(String(started.sessionId));
    const waited = await call("agents.wait", { runId: started.runId, timeoutSeconds: 1 });
    expect(waited).toMatchObject({ status: "needsInput" });
  });

  it("returns the last turn's reply on success and truncates it to the result limit", async () => {
    setup({ subagents: [codexFive] });
    const started = await delegate("req-1");
    host.finish(String(started.sessionId), "a".repeat(DELEGATION_LIMITS.resultGraphemes + 500));
    const waited = await call("agents.wait", { runId: started.runId });
    expect(waited).toMatchObject({ status: "succeeded", truncated: true });
    expect(String(waited.result)).toHaveLength(DELEGATION_LIMITS.resultGraphemes);
    expect(String(waited.result).endsWith("…")).toBe(true);
  });

  it("returns a short reply unchanged and without the truncated flag", async () => {
    setup({ subagents: [codexFive] });
    const started = await delegate("req-1");
    host.finish(String(started.sessionId), "Parser fixed.");
    const waited = await call("agents.wait", { runId: started.runId });
    expect(waited).toEqual({
      runId: started.runId,
      sessionId: started.sessionId,
      model: { harness: "codex", model: "codex:gpt-5" },
      status: "succeeded",
      result: "Parser fixed.",
      truncated: false,
    });
  });

  it("reports a failed child with its error note", async () => {
    setup({ subagents: [codexFive] });
    const started = await delegate("req-1");
    host.fail(String(started.sessionId), "Quota exceeded.");
    expect(await call("agents.wait", { runId: started.runId })).toMatchObject({
      status: "failed",
      error: "Quota exceeded.",
    });
  });

  it("returns the owner's follow-up reply with ownerFollowUp after the first turn finished", async () => {
    setup({ subagents: [codexFive] });
    const started = await delegate("req-1");
    const childId = String(started.sessionId);
    host.finish(childId, "First answer.");
    expect(await call("agents.wait", { runId: started.runId })).toMatchObject({
      status: "succeeded",
      result: "First answer.",
    });
    expect(await call("agents.wait", { runId: started.runId })).not.toHaveProperty("ownerFollowUp");

    // The owner messages the finished child: a new turn starts.
    await host.engine.command({ type: "send", sessionId: childId, text: "Also check the lexer." });
    const running = await call("agents.wait", { runId: started.runId, timeoutSeconds: 1 });
    expect(running).toMatchObject({ status: "running", ownerFollowUp: true });

    host.finish(childId, "Lexer checked too.");
    expect(await call("agents.wait", { runId: started.runId })).toMatchObject({
      runId: started.runId,
      status: "succeeded",
      result: "Lexer checked too.",
      ownerFollowUp: true,
    });
  });

  it("does not expose a run that another conversation started", async () => {
    setup({ subagents: [codexFive] });
    host.add("other", { projectId: "p" });
    const started = await delegate("req-1");
    await expect(
      call("agents.wait", { runId: started.runId }, { sessionId: "other", projectId: "p" }),
    ).rejects.toThrow("Run not found in this conversation.");
  });

  it("waits on and reads a run after a Host restart, from the store", async () => {
    setup({ subagents: [codexFive] });
    const started = await delegate("req-1");
    host.finish(String(started.sessionId), "Done before restart.");

    // A new service instance over the same state folder and the same Host sessions.
    delegation = new ConversationDelegation(deps);
    expect(await call("agents.wait", { runId: started.runId })).toMatchObject({
      status: "succeeded",
      result: "Done before restart.",
    });
    expect(await call("agents.options")).toMatchObject({ running: { subagents: 0 } });
  });
});

describe("agents.cancel and parent cancel", () => {
  it("keeps a child running when parent cancellation fails", async () => {
    setup({ subagents: [codexFive] });
    const started = await delegate("req-1");
    const command = host.engine.command;
    vi.spyOn(host.engine, "command").mockImplementation(async (value) => {
      if (value.type === "cancel") throw new Error("cancel rejected");
      return command(value);
    });
    await delegation.cancelChildren("parent");
    expect(await call("agents.wait", { runId: started.runId, timeoutSeconds: 1 })).toMatchObject({
      status: "running",
    });
  });

  it("does not report cancellation before the child confirms its terminal state", async () => {
    setup({ subagents: [codexFive] });
    const started = await delegate("req-1");
    const command = host.engine.command;
    vi.spyOn(host.engine, "command").mockImplementation(async (value) =>
      value.type === "cancel" ? {} : command(value),
    );
    expect(await call("agents.cancel", { runId: started.runId })).toMatchObject({
      status: "running",
    });
  });

  it("cancels the latest owner follow-up even after the original finished", async () => {
    setup({ subagents: [codexFive] });
    const started = await delegate("req-1");
    const childId = String(started.sessionId);
    host.finish(childId, "Done.");
    await call("agents.wait", { runId: started.runId });
    await host.engine.command({ type: "send", sessionId: childId, text: "Follow up" });
    const latest = host.entries.get(childId)!.runId;
    expect(await call("agents.options")).toMatchObject({ running: { subagents: 1 } });
    expect(await call("agents.cancel", { runId: started.runId })).toMatchObject({
      status: "cancelled",
    });
    expect(host.commandsOf("cancel")[0]).toMatchObject({ sessionId: childId, runId: latest });
  });
  it("cancels a running child and records it as cancelled", async () => {
    setup({ subagents: [codexFive] });
    const started = await delegate("req-1");
    expect(await call("agents.cancel", { runId: started.runId })).toMatchObject({
      status: "cancelled",
    });
    expect(host.commandsOf("cancel")[0]).toMatchObject({ sessionId: started.sessionId });
    expect(await call("agents.wait", { runId: started.runId })).toMatchObject({
      status: "cancelled",
    });
  });

  it("cancels every running child of a parent and leaves finished children alone", async () => {
    setup({ subagents: [codexFive] });
    const finished = await delegate("req-1");
    host.finish(String(finished.sessionId), "Done.");
    await call("agents.wait", { runId: finished.runId });
    const running = await delegate("req-2");

    await delegation.cancelChildren("parent");

    const cancels = host.commandsOf("cancel");
    expect(cancels.map((command) => command.sessionId)).toEqual([running.sessionId]);
    expect(await call("agents.wait", { runId: running.runId })).toMatchObject({
      status: "cancelled",
    });
    expect(await call("agents.wait", { runId: finished.runId })).toMatchObject({
      status: "succeeded",
    });
  });
});

describe("recursion and caller checks", () => {
  it("rejects agents runs started by a subagent", async () => {
    setup({ subagents: [codexFive], advisor: codexSix });
    const started = await delegate("req-1");
    const child: AgentsCaller = { sessionId: String(started.sessionId), projectId: "p" };
    await expect(call("agents.options", {}, child)).rejects.toThrow(
      "A subagent cannot start agents runs.",
    );
    await expect(
      call("agents.delegate", { requestId: "req-2", title: "t", prompt: "p" }, child),
    ).rejects.toThrow("A subagent cannot start agents runs.");
    await expect(
      call("agents.consult", { requestId: "req-3", question: "q" }, child),
    ).rejects.toThrow("A subagent cannot start agents runs.");
    expect(host.commandsOf("create")).toHaveLength(1);
  });

  it("rejects a session that carries a delegation parent link even when the store does not know it", async () => {
    setup({ subagents: [codexFive] });
    host.add("orphan", {
      modelSettings: {
        [DELEGATION_PARENT_KEY]: JSON.stringify({
          parentSessionId: "parent",
          runId: "run-x",
          kind: "subagent",
          model: "codex:gpt-5",
          startedAt: 1,
        }),
      },
    } as Partial<Session>);
    await expect(
      call(
        "agents.delegate",
        { requestId: "req-1", title: "t", prompt: "p" },
        {
          sessionId: "orphan",
          projectId: "p",
        },
      ),
    ).rejects.toThrow("A subagent cannot start agents runs.");
  });

  it("rejects a caller from another project", async () => {
    setup({ subagents: [codexFive] });
    await expect(
      call("agents.options", {}, { sessionId: "parent", projectId: "other" }),
    ).rejects.toThrow("Conversation belongs to another project.");
  });

  it("rejects an unknown agents action", async () => {
    setup();
    await expect(call("agents.explode")).rejects.toThrow("Unsupported agents tool.");
  });
});

describe("continuations and multi-wait", () => {
  const reply = (runId: unknown, requestId = "answer", message = "Use option B") =>
    call("agents.reply", { runId, requestId, message });

  it.each(["succeeded", "failed", "cancelled"])(
    "continues a %s child with context and idempotent receipts",
    async (status) => {
      setup({ subagents: [codexFive] });
      const first = await delegate("first");
      const sessionId = String(first.sessionId);
      if (status === "succeeded") host.finish(sessionId, "Which option?");
      else host.fail(sessionId, status === "cancelled" ? STOPPED_BY_USER : "Failed");
      const continued = await reply(first.runId);
      expect(continued).toMatchObject({ runId: first.runId, sessionId, status: "running" });
      expect(continued).not.toHaveProperty("ownerFollowUp");
      expect(host.commandsOf("create")).toHaveLength(1);
      expect(host.commandsOf("send")[1]).toMatchObject({
        sessionId,
        text: expect.stringContaining("Use option B"),
      });
      expect(host.commandsOf("send")[1]!.text).toContain("untrusted data");
      await reply(first.runId);
      expect(host.commandsOf("send")).toHaveLength(2);
      await expect(reply(first.runId, "answer", "Different")).rejects.toThrow("different payload");
      host.finish(sessionId, "Done B");
      expect(await call("agents.wait", { runId: first.runId })).toMatchObject({ result: "Done B" });
      // Receipts survive Host service recreation and newer reply turns.
      delegation = new ConversationDelegation(deps);
      await reply(first.runId, "answer-2");
      expect(await reply(first.runId)).toMatchObject({ status: "running" });
      expect(host.commandsOf("send")).toHaveLength(3);
    },
  );

  it("rejects running, approval-blocked, foreign and recursive replies", async () => {
    setup({ subagents: [codexFive] });
    const first = await delegate("first");
    await expect(reply(first.runId)).rejects.toThrow("Wait or cancel");
    host.needInput(String(first.sessionId));
    await expect(reply(first.runId)).rejects.toThrow("approval");
    host.add("other");
    await expect(
      call(
        "agents.reply",
        { runId: first.runId, requestId: "x", message: "x" },
        { sessionId: "other", projectId: "p" },
      ),
    ).rejects.toThrow("Run not found");
    await expect(
      call(
        "agents.reply",
        { runId: first.runId, requestId: "x", message: "x" },
        { sessionId: String(first.sessionId), projectId: "p" },
      ),
    ).rejects.toThrow("cannot start");
  });

  it("keeps advisors read-only and restores recorded model/account", async () => {
    setup({ advisor: { ...codexSix, providerAccountId: "work" } });
    const first = await consult("first");
    host.finish(String(first.sessionId), "Question?");
    await reply(first.runId);
    expect(host.commandsOf("send")[1]).toMatchObject({ intent: "plan" });
    expect(host.commandsOf("configure")[0]).toMatchObject({
      model: codexSix.model,
      providerAccountId: "work",
      harness: "codex",
    });
    expect(await call("agents.options")).toMatchObject({ running: { advisors: 1 } });
  });

  it.each(["signedOut", "unknown"] as const)("rechecks %s sign-in", async (auth) => {
    setup({ subagents: [codexFive] });
    const first = await delegate("first");
    host.finish(String(first.sessionId), "Question?");
    deps.authStatus = async () => auth;
    await expect(reply(first.runId)).rejects.toThrow("sign-in");
    expect(host.commandsOf("send")).toHaveLength(1);
  });

  it.each(["subagent", "advisor"])("counts replies against the %s running limit", async (kind) => {
    setup({ subagents: [codexFive], advisor: codexSix });
    const start = kind === "advisor" ? consult : delegate;
    const first = await start("first");
    host.finish(String(first.sessionId), "Question?");
    const limit = kind === "advisor" ? 1 : 16;
    expect(DELEGATION_LIMITS.runningSubagents).toBe(16);
    for (let i = 0; i < limit; i++) await start(`next-${i}`);
    await expect(reply(first.runId)).rejects.toThrow("limit reached");
  });

  it("rejects request IDs shared with launches and invalid inputs", async () => {
    setup({ subagents: [codexFive] });
    const first = await delegate("first");
    host.finish(String(first.sessionId), "Question?");
    await expect(reply(first.runId, "first")).rejects.toThrow("different payload");
    for (const message of ["", "x".repeat(DELEGATION_LIMITS.promptChars + 1)])
      await expect(reply(first.runId, "answer", message)).rejects.toThrow("message");
    await expect(reply(first.runId, "bad id")).rejects.toThrow("requestId");
  });

  it("multi-wait returns finished and needsInput rows in input order", async () => {
    setup({ subagents: [codexFive] });
    const first = await delegate("first");
    const second = await delegate("second");
    host.finish(String(first.sessionId), "Done");
    host.needInput(String(second.sessionId));
    expect(await call("agents.wait", { runIds: [second.runId, first.runId] })).toMatchObject({
      runs: [
        { runId: second.runId, status: "needsInput" },
        { runId: first.runId, status: "succeeded", result: "Done" },
      ],
    });
    host.finish(String(second.sessionId), "Also done");
    expect(await call("agents.wait", { runIds: [first.runId, second.runId] })).toMatchObject({
      runs: [{ status: "succeeded" }, { status: "succeeded" }],
    });
  });

  it("waits for all running rows and times out with mixed states", async () => {
    setup({ subagents: [codexFive] });
    const first = await delegate("first");
    const second = await delegate("second");
    host.finish(String(first.sessionId), "Done");
    expect(
      await call("agents.wait", { runIds: [first.runId, second.runId], timeoutSeconds: 1 }),
    ).toMatchObject({ runs: [{ status: "succeeded" }, { status: "running" }] });
  });

  it.each([
    {},
    { runId: "x", runIds: ["x"] },
    { runIds: [] },
    { runIds: ["x", "x"] },
    { runIds: Array.from({ length: 17 }, (_, i) => String(i)) },
  ])("rejects invalid wait IDs %j", async (args) => {
    setup({});
    await expect(call("agents.wait", args)).rejects.toThrow();
  });

  it.each(["claude", "codex", "grok", "cursor"])(
    "enforces %s provider wait cap and default",
    async (harness) => {
      setup({ subagents: [codexFive] });
      host.entries.get("parent")!.session.harness = harness as Session["harness"];
      const first = await delegate("first");
      host.finish(String(first.sessionId), "Done");
      const maximum = harness === "cursor" ? 50 : 240;
      expect(
        await call("agents.wait", { runId: first.runId, timeoutSeconds: maximum }),
      ).toMatchObject({ status: "succeeded" });
      expect(await call("agents.wait", { runId: first.runId })).toMatchObject({
        status: "succeeded",
      });
      // Above the provider deadline is shortened, not rejected.
      expect(
        await call("agents.wait", { runId: first.runId, timeoutSeconds: maximum + 1 }),
      ).toMatchObject({ status: "succeeded" });
      await expect(call("agents.wait", { runId: first.runId, timeoutSeconds: 0 })).rejects.toThrow(
        "positive integer",
      );
    },
  );
});

it("lists effort options and separates subagent defaults from advisor inheritance", async () => {
  setup({ subagents: [codexFive], advisor: codexFive });
  deps.models = async () => ({
    ...catalog,
    models: {
      ...catalog.models,
      codex: [
        {
          ...catalog.models.codex![1]!,
          settings: [
            {
              id: "reasoningEffort",
              label: "Reasoning",
              kind: "select",
              value: "low",
              options: ["low", "medium", "high"].map((value) => ({ value, label: value })),
            },
          ],
        },
      ],
    },
  });
  expect(await call("agents.options")).toMatchObject({
    subagents: [{ effortLevels: ["low", "medium", "high"], defaultEffort: "low" }],
  });
  await delegate("default");
  await delegate("explicit", { effort: "medium" });
  await delegate("closest", { effort: "ultra" });
  await consult("advisor");
  expect(
    host
      .commandsOf("create")
      .map((command) => (command.modelSettings as Record<string, string>).reasoningEffort),
  ).toEqual(["low", "medium", "high", "high"]);
  await expect(delegate("invalid", { effort: "expensive" })).rejects.toThrow("Unknown effort");
  await expect(delegate("explicit", { effort: "low" })).rejects.toThrow("different payload");
});

it("does not flag a parent reply as ownerFollowUp during concurrent waits", async () => {
  setup({ subagents: [codexFive] });
  const first = await delegate("first");
  host.finish(String(first.sessionId), "Question?");
  const command = host.engine.command;
  let release!: () => void;
  let sending!: () => void;
  const entered = new Promise<void>((resolve) => {
    sending = resolve;
  });
  const blocked = new Promise<void>((resolve) => {
    release = resolve;
  });
  host.engine.command = async (input) => {
    const result = await command(input);
    if (input.type === "send") {
      sending();
      await blocked;
    }
    return result;
  };
  const reply = call("agents.reply", { runId: first.runId, requestId: "answer", message: "B" });
  await entered;
  const wait = call("agents.wait", { runId: first.runId, timeoutSeconds: 1 });
  release();
  expect(await reply).not.toHaveProperty("ownerFollowUp");
  host.finish(String(first.sessionId), "Done B");
  expect(await wait).toMatchObject({ result: "Done B" });
  expect(await call("agents.wait", { runId: first.runId })).not.toHaveProperty("ownerFollowUp");
});
