import { useState } from "react";
import { createRoot } from "react-dom/client";
import { SubagentSheet, useSubagentSheet } from "../../src/features/sessions/ui/SubagentSheet";
import { useSubagentRelay } from "../../src/features/sessions/ui/useSubagentRelay";
import { Button } from "../../src/shared/ui/Button";
import type { Block } from "../../src/features/sessions/model/session";
import "../../src/styles/index.css";

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
function Fixture() {
  const params = new URLSearchParams(location.search);
  const reviewer = params.has("layout") ? layoutAgent : agent;
  const sheet = useSubagentSheet(
    [reviewer, { ...agent, id: "agent-2", agentRun: { name: "Explorer", steps: [] } }],
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
    <main className="relative h-dvh bg-background-base text-content" data-session-drop>
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
      <output data-testid="submission-count">{submitted.length}</output>
      <pre data-testid="last-submission">{submitted.at(-1)}</pre>
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
createRoot(document.getElementById("root")!).render(<Fixture />);
