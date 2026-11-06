import { afterEach, beforeEach, describe, expect, it } from "vitest";
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
        },
        {
          ref: "codex:gpt-5",
          harness: "codex",
          model: "codex:gpt-5",
          label: "GPT 5",
          available: true,
        },
      ],
      advisor: {
        ref: "codex:gpt-6.1",
        harness: "codex",
        model: "codex:gpt-6.1",
        label: "GPT 6.1",
        available: true,
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
  it("uses the only selected subagent model without a model field", async () => {
    setup({ subagents: [codexFive] });
    const result = await delegate("req-1");
    expect(result).toMatchObject({
      status: "running",
      model: { harness: "codex", model: "codex:gpt-5" },
    });
    expect(host.commandsOf("create")[0]).toMatchObject({ harness: "codex", model: "codex:gpt-5" });
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
