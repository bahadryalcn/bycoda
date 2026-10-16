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
function Fixture() {
  const sheet = useSubagentSheet(
    [agent, { ...agent, id: "agent-2", agentRun: { name: "Explorer", steps: [] } }],
    true,
  );
  const [submitted, setSubmitted] = useState<string[]>([]);
  const params = new URLSearchParams(location.search);
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
