import { useEffect } from "react";
import { newSession, type Block, type Session } from "../../../src/features/sessions/model/session";
import {
  setSessions,
  useSessionsSelector,
} from "../../../src/features/sessions/model/sessionsStore";
import { useDelegatedDockAgents } from "../../../src/features/sessions/model/reactiveReads";
import { ActivityDock } from "../../../src/features/sessions/ui/ActivityDock";
import { AgentTranscript } from "../../../src/features/sessions/ui/AgentTranscript";
import { MessageQueue } from "../../../src/features/sessions/ui/MessageQueue";
import { LiveSessionBlocks } from "../../../src/features/sessions/ui/LiveSessionBlocks";

const parentId = "audit-parent";
const startedAt = Date.now() - 120_000;
const noop = () => {};

function child(
  index: number,
  title: string,
  patch: Partial<Session>,
  round: number,
  blocks: Block[],
): Session {
  return {
    ...newSession("claude", "/fixture"),
    id: `audit-child-${index}`,
    title,
    model: "claude:haiku",
    modelSettings: {
      delegationParent: JSON.stringify({
        parentSessionId: parentId,
        runId: `run-${index}`,
        kind: "subagent",
        model: "claude:haiku",
        startedAt: startedAt + index * 1000,
        ...(round > 1 ? { round } : {}),
      }),
    },
    blocks,
    ...patch,
  };
}

const brief = (index: number, text = "Look into this and report back."): Block => ({
  id: `brief-${index}`,
  role: "user",
  text,
  startedAt: startedAt + index * 1000,
});
const said = (index: number, text: string): Block => ({
  id: `said-${index}`,
  role: "assistant",
  text,
});
const call = (index: number): Block => ({
  id: `delegate-${index}`,
  role: "tool",
  text: "bycoda-conversation:conversation_agents_delegate",
  tool: {
    kind: "other",
    title: "bycoda-conversation:conversation_agents_delegate",
    status: "completed",
    detail: JSON.stringify({
      runId: `run-${index}`,
      sessionId: `audit-child-${index}`,
    }),
  },
});
const notice = (id: string, runId: string, title: string, status: string, body: string): Block => ({
  id,
  role: "user",
  author: { kind: "delegation", runId, title, reason: "completion" },
  text: `Subagent completion: ${title} (${runId}), status ${status}.\n\n${body}`,
});

const parentBlocks: Block[] = [
  {
    id: "ask",
    role: "user",
    text: "Audit the three suites and debate the result.",
    startedAt,
  },
  call(1),
  call(2),
  call(3),
  {
    id: "delegate-failed",
    role: "tool",
    text: "bycoda-conversation:conversation_agents_delegate",
    tool: {
      kind: "other",
      title: "bycoda-conversation:conversation_agents_delegate",
      status: "completed",
      detail: JSON.stringify({
        error: "Model grok:grok-4.6 is unavailable for subagents.",
      }),
    },
  },
  notice("notice-1", "run-1", "Benchmark review", "succeeded", "All 12 benchmarks agree."),
  notice(
    "notice-orphan",
    "run-9",
    "Archived explorer",
    "succeeded",
    "No card remains for this run.",
  ),
  // Claude Code's built-in advisor: a server tool inside the turn, not a child session.
  {
    id: "advisor-call",
    role: "tool",
    text: "advisor",
    tool: {
      callId: "advisor-call",
      kind: "advisor",
      title: "advisor",
      status: "completed",
      detail: "Re-run the failed migration check before trusting the benchmark agreement.",
    },
  },
  {
    id: "answer",
    role: "assistant",
    text: "Two of three suites are in; one failed and one is in round 2.",
  },
];

const queued = {
  id: "queued-notice",
  text: ["Benchmark review", "Migration check", "Debate"]
    .map(
      (title, i) =>
        `Subagent completion: ${title} (run-${i + 1}), status succeeded.\n\nFinished ${title}.`,
    )
    .join("\n\n---\n\n"),
  attachments: [],
  author: {
    kind: "delegation" as const,
    runId: "run-1",
    title: "Benchmark review",
    reason: "completion" as const,
  },
};

export function seedSubagentAudit() {
  setSessions([
    {
      ...newSession("codex", "/fixture"),
      id: parentId,
      busy: false,
      blocks: parentBlocks.map((block) =>
        block.tool?.kind === "advisor" &&
        new URLSearchParams(location.search).has("advisor-pending")
          ? { ...block, tool: { ...block.tool, status: "pending" } }
          : block,
      ),
      modelSettings: { crossAdvisor: '{"harness":"claude","model":"claude:fable-5-2"}' },
    },
    child(1, "Benchmark review", {}, 1, [brief(1), said(1, "All 12 benchmarks agree.")]),
    child(2, "Migration check", {}, 1, [
      brief(2),
      {
        id: "err-2",
        role: "system",
        notice: "error",
        text: "Provider rejected the request: context length exceeded.",
      },
    ]),
    child(3, "Debate", { busy: true }, 2, [
      brief(3),
      said(3, "Round one: position A."),
      {
        ...brief(3, "Round two: answer the objections."),
        id: "round-2",
        startedAt: startedAt + 60_000,
      },
    ]),
  ]);
}

/** The real transcript, queue and dock around one delegating conversation. */
export function SubagentAuditFixture() {
  const parent = useSessionsSelector((all) => all.find((s) => s.id === parentId)!);
  const dockAgents = useDelegatedDockAgents(parentId, parent.blocks);
  useEffect(() => {
    document.documentElement.classList.toggle(
      "theme-light",
      new URLSearchParams(location.search).get("theme") === "light",
    );
  }, []);
  return (
    <main className="flex h-dvh min-w-0 flex-col bg-background-base text-content" data-session-drop>
      <div className="min-h-0 flex-1 overflow-auto">
        <LiveSessionBlocks
          sessionId={parentId}
          visible
          enabled={false}
          fallback={parent.blocks}
          delegatedCards
        >
          {(blocks) => (
            <AgentTranscript
              delegatedRunOwner={parentId}
              modelSettings={parent.modelSettings}
              blocks={blocks}
              onSaveNote={noop}
              onSendDraft={() => true}
              onEditDraft={() => true}
              onRemoveDraft={() => true}
            />
          )}
        </LiveSessionBlocks>
      </div>
      <div data-composer className="mx-auto w-full max-w-4xl px-4 pb-3">
        <MessageQueue
          sessionId={parentId}
          messages={[queued]}
          status="active"
          canAttach={false}
          busy
          onDelete={() => ({ ok: true }) as never}
        />
        <ActivityDock
          sessionId={parentId}
          harness="codex"
          blocks={parent.blocks}
          busy={false}
          pendingQuestion={false}
          atEnd
          delegatedAgents={dockAgents}
          onOpenAgent={noop}
        />
      </div>
    </main>
  );
}
