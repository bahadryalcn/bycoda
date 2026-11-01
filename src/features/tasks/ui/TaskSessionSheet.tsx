import { useEffect, useRef, useState } from "react";
import { EmptyState } from "../../../shared/ui/EmptyState";
import { Modal } from "../../../shared/ui/Modal";
import { Button } from "../../../shared/ui/Button";
import { Alert } from "../../../shared/ui/Alert";
import { Badge } from "../../../shared/ui/Badge";
import { LoadingText } from "../../../shared/ui/LoadingText";
import { t } from "../../../shared/i18n";
import { remoteRequest } from "../../connections/model/connections";
import type { HostSession } from "../../connections/model/protocol";
import type { BackgroundSessionTarget } from "../model/backgroundSession";
import { AgentMarkdown } from "../../sessions/ui/AgentMarkdown";

/** Host-owned transcript preview. Navigation only happens through the explicit action. */
export function TaskSessionSheet({
  target,
  onClose,
  onOpen,
}: {
  target: BackgroundSessionTarget;
  onClose: () => void;
  onOpen: (target: BackgroundSessionTarget) => void | Promise<void>;
}) {
  const targetKey = `${target.machineId}:${target.sessionId}`;
  const [sessionState, setSessionState] = useState<{ key: string; value: HostSession }>();
  const session = sessionState?.key === targetKey ? sessionState.value : undefined;
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const [opening, setOpening] = useState(false);
  const openingRequest = useRef(false);
  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    let known: HostSession | undefined;
    const load = async () => {
      try {
        const next = await remoteRequest<HostSession | null>(target.machineId, "sessions.get", {
          sessionId: target.sessionId,
          preview: true,
          revision: known?.revision,
        });
        if (!alive) return;
        if (next) known = next;
        if (!known?.session) throw new Error(t("This session is no longer available."));
        if (next) setSessionState({ key: `${target.machineId}:${target.sessionId}`, value: next });
        setError("");
        if (known.status === "running") timer = setTimeout(load, 3000);
      } catch (reason) {
        if (alive) setError(reason instanceof Error ? reason.message : String(reason));
      }
    };
    void load();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [target.machineId, target.sessionId, revision]);
  // Conversation (what was asked and answered) reads first; operational history
  // (reasoning, tools, status) is kept behind one disclosure.
  const visibleBlocks = session?.session.blocks.filter((block) => block.text?.trim()) ?? [];
  const conversation = visibleBlocks.filter(
    (block) => block.role === "user" || block.role === "assistant",
  );
  const operational = visibleBlocks.filter(
    (block) => block.role !== "user" && block.role !== "assistant",
  );
  return (
    <Modal
      placement="end"
      title={session?.session.title || t("Background session")}
      onClose={onClose}
    >
      <div className="task-session-preview">
        <div className="task-session-toolbar">
          <span role="status">
            <Badge tone={session?.status === "running" ? "info" : "neutral"}>
              {session
                ? t(
                    session.status === "running"
                      ? "Running"
                      : session.status === "interrupted"
                        ? "Interrupted"
                        : "Idle",
                  )
                : t("Loading…")}
            </Badge>
          </span>
          <Button
            variant="secondary"
            loading={opening}
            onClick={async () => {
              if (openingRequest.current) return;
              openingRequest.current = true;
              setOpening(true);
              try {
                await onOpen(target);
                onClose();
              } catch (reason) {
                setError(reason instanceof Error ? reason.message : String(reason));
              } finally {
                openingRequest.current = false;
                setOpening(false);
              }
            }}
          >
            {t("Open in Sessions")}
          </Button>
        </div>
        {error ? (
          <Alert tone="danger" role="alert">
            <span>{error}</span>
            <Button variant="ghost" onClick={() => setRevision((value) => value + 1)}>
              {t("Retry")}
            </Button>
          </Alert>
        ) : null}
        {!session && !error ? (
          <LoadingText />
        ) : null}
        {conversation.map((block) => (
          <section className="task-session-message" data-role={block.role} key={block.id}>
            <h3>{t(block.role === "user" ? "You" : "Assistant")}</h3>
            <AgentMarkdown text={block.text} />
          </section>
        ))}
        {operational.length > 0 ? (
          <details className="task-session-activity">
            <summary>{t("Activity ({p0})", { p0: operational.length })}</summary>
            {operational.map((block) => (
              <section className="task-session-activity-item" key={block.id}>
                <h3>{t(operationalRoleLabel(block.role))}</h3>
                <AgentMarkdown text={block.text} />
              </section>
            ))}
          </details>
        ) : null}
        {session && visibleBlocks.length === 0 ? (
          <EmptyState size="inline" description={t("No reply yet.")} />
        ) : null}
      </div>
    </Modal>
  );
}

function operationalRoleLabel(role: string): string {
  switch (role) {
    case "reasoning":
      return "Reasoning";
    case "tool":
      return "Tool";
    case "approval":
      return "Approval";
    case "plan":
      return "Plan";
    case "tasks":
      return "Tasks";
    case "handoff":
      return "Handoff";
    default:
      return "Status";
  }
}
