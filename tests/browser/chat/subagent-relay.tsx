import { useEffect, useState } from "react";
import { flushHostSessionBindings } from "../../../src/features/connections/public/sessionExecutionBinding";
import { createRoot } from "react-dom/client";
import { SubagentSheet, useSubagentSheet } from "../../../src/features/sessions/ui/SubagentSheet";
import { useSubagentRelay } from "../../../src/features/sessions/ui/useSubagentRelay";
import { ActivityDock } from "../../../src/features/sessions/ui/ActivityDock";
import { SubagentStack } from "../../../src/features/sessions/ui/SubagentCards";
import { SubagentStateLine } from "../../../src/features/sessions/ui/SubagentAnatomy";
import { Button } from "../../../src/shared/ui/Button";
import type { Block } from "../../../src/features/sessions/model/session";
import "../../../src/styles/index.css";

const agent: Block = {
  id: "agent-1",
  role: "tool",
  text: "Review changes",
  tool: { callId: "spawn-1", kind: "agent", status: "in_progress" },
  agentRun: { name: "Reviewer", prompt: "Review the requested changes", steps: [] },
};
const layoutAgent: Block = {
  ...agent,
  agentRun: {
    name: "Ssh Security subagent with a very long descriptive name",
    prompt: "Review " + "G:/Projects/very-long-directory/".repeat(12),
    steps: [
      {
        id: "message",
        kind: "message",
        text:
          "Evidence\n\n" + "Visible remote suggestions require verified integration. ".repeat(18),
      },
      {
        id: "nested",
        kind: "tool",
        toolKind: "agent",
        text: "Root subagent",
        status: "in_progress",
      },
      {
        id: "nested-2",
        kind: "tool",
        toolKind: "agent",
        text: "Ssh Engine subagent",
        status: "completed",
      },
      ...Array.from({ length: 12 }, (_, index) => ({
        id: `read-${index}`,
        kind: "tool" as const,
        toolKind: "read",
        text: "src/features/" + "long-directory/".repeat(12) + "terminal.ts",
        status: "completed",
      })),
    ],
  },
};
const statusStartedAt = Date.now() - 804_000;
const statusSteps: NonNullable<Block["agentRun"]>["steps"] = [
  {
    id: "read-complete",
    kind: "tool",
    toolKind: "read",
    text: "Read src/features/sessions/ui/ActivityDock.tsx",
    status: "completed",
  },
  {
    id: "check-failed",
    kind: "tool",
    toolKind: "execute",
    text: "pnpm test -- status-colors",
    status: "failed",
    detail: "Fixture check failed: expected status label to be visible.",
  },
  {
    id: "retry-complete",
    kind: "tool",
    toolKind: "execute",
    text: "pnpm test -- status-colors --retry",
    status: "completed",
    output: "Focused check passed after retry.",
  },
];
const statusAgents: Block[] = [
  ["running", "Implement Tools Shell subagent", "in_progress"],
  ["done", "Implement Browser Host subagent", "completed"],
  ["failed", "Implement Browser UI subagent", "failed"],
  ["interrupted", "Review remote transport subagent", "interrupted"],
  ["stopped", "Review device tools subagent", "stopped"],
].map<Block>(([id, name, status]) => ({
  id: `status-${id}`,
  role: "tool",
  text: name,
  tool: {
    callId: `status-call-${id}`,
    kind: "agent",
    status,
    ...(status === "failed" ? { detail: "Subagent could not complete its review." } : {}),
  },
  agentRun: {
    name,
    model: "gpt-6.1-sol",
    agentType: "worker",
    prompt: "Review the assigned tools surface and report concrete failures.",
    steps: statusSteps,
    startedAt: statusStartedAt,
    ...(status !== "in_progress" ? { endedAt: statusStartedAt + 600_000 } : {}),
  },
}));
const statusBlocks: Block[] = [
  {
    id: "status-user",
    role: "user",
    text: "Review tools and show each subagent's current state.",
    startedAt: statusStartedAt,
  },
  ...statusAgents,
];
function Fixture() {
  const params = new URLSearchParams(location.search);
  const statusColors = params.has("status-colors");
  const theme = params.get("theme");
  useEffect(() => {
    if (theme) document.documentElement.classList.toggle("theme-light", theme === "light");
  }, [theme]);
  const reviewer = params.has("layout") ? layoutAgent : agent;
  const command: Block = {
    id: "command-fixture",
    role: "tool",
    text: "echo focused-command",
    tool: {
      callId: "command-fixture",
      kind: "execute",
      status: "completed",
      output: "command output fixture",
    },
  };
  const sheet = useSubagentSheet(
    statusColors
      ? statusBlocks
      : [reviewer, command, { ...agent, id: "agent-2", agentRun: { name: "Explorer", steps: [] } }],
    true,
  );
  const [submitted, setSubmitted] = useState<string[]>([]);
  const blockedReason = params.has("blocked")
    ? "Messaging is unavailable in this conversation."
    : undefined;
  const relay = useSubagentRelay({
    sessionId: "fixture",
    block: sheet.block,
    blocked: !!blockedReason,
    onSubmit: (text) => {
      if (params.has("reject")) return false;
      setSubmitted((current) => [...current, text]);
      return true;
    },
  });
  return (
    <main
      className="relative flex h-dvh min-w-0 flex-col bg-background-base text-content"
      data-session-drop
    >
      {params.has("inline-status") ? (
        <div className="p-4">
          <SubagentStack blocks={statusAgents} live />
          <SubagentStack blocks={[agent]} live />
        </div>
      ) : statusColors ? (
        <div className="flex min-h-0 min-w-0 flex-1 flex-col justify-end gap-4 p-4">
          <div className="mx-auto flex w-full max-w-4xl flex-col gap-3">
            {statusAgents.slice(0, 2).map((block) => (
              <div key={block.id} data-status-specimen={block.id} className="min-w-0">
                <div className="text-ui-caption text-(--ui-text-secondary)">
                  {block.agentRun?.name}
                </div>
                <SubagentStateLine
                  block={block}
                  busy
                  steps={block.agentRun?.steps ?? []}
                  model={block.agentRun?.model}
                />
              </div>
            ))}
          </div>
          <div data-composer className="mx-auto w-full max-w-4xl">
            <ActivityDock
              sessionId="subagent-status-colors"
              harness="codex"
              blocks={statusBlocks}
              busy
              pendingQuestion={false}
              visible
              atEnd
              onOpenAgent={(entry) => sheet.open(entry.blockId)}
            />
          </div>
        </div>
      ) : (
        <div>
          <Button
            onClick={() => {
              sheet.open(agent.id);
            }}
          >
            Open reviewer
          </Button>
          <Button
            onClick={() => {
              sheet.open("agent-2");
            }}
          >
            Open explorer
          </Button>
          <Button onClick={() => sheet.open("command-fixture")}>Open command</Button>
          <output data-testid="submission-count">{submitted.length}</output>
          <pre data-testid="last-submission">{submitted.at(-1)}</pre>
        </div>
      )}
      {sheet.block ? (
        <SubagentSheet
          block={sheet.block}
          busy
          visible
          onClose={sheet.close}
          onShowInTranscript={sheet.close}
          relay={{ ...relay, blockedReason, onOpenConversation: sheet.close }}
        />
      ) : null}
    </main>
  );
}
// The app resolves durable session owners at boot before any pane renders;
// the fixture mounts it directly, so it hydrates the same store first.
await flushHostSessionBindings();
createRoot(document.getElementById("root")!).render(<Fixture />);
