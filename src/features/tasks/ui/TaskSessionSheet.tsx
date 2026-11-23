import { Text } from "../../../shared/ui/Text";
import { surfaceAttributes } from "../../../shared/ui/Surface";
import { SectionLabel } from "../../../shared/ui/SectionLabel";
import { useEffect, useRef, useState } from "react";
import { Disclosure } from "../../../shared/ui/Disclosure";
import { EmptyState } from "../../../shared/ui/EmptyState";
import { Modal } from "../../../shared/ui/Modal";
import { Button } from "../../../shared/ui/Button";
import { Alert } from "../../../shared/ui/Alert";
import { Badge } from "../../../shared/ui/Badge";
import { StatusDot } from "../../../shared/ui/StatusDot";
import { LoadingText } from "../../../shared/ui/LoadingText";
import { t } from "../../../shared/i18n";
import { remoteRequest } from "../../connections/public/connections";
import type { HostSession } from "../../connections";
import type { BackgroundSessionTarget } from "../model/backgroundSession";
import { AgentMarkdown } from "../../sessions/public/AgentMarkdown";
import { presentRemoteError } from "../../connections/public/remoteFailure";
import {
  createRefreshScheduler,
  HIDDEN_REFRESH_MS,
} from "../../automations/public/refreshScheduler";

const PREVIEW_POLL_MS = 3000;
const PREVIEW_MAX_BACKOFF_MS = 60_000;
// Consecutive failures before the poll stops on its own; only the owner's Retry restarts it.
const PREVIEW_MAX_ATTEMPTS = 5;

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
  const [sessionState, setSessionState] = useState<{
    key: string;
    value: HostSession;
  }>();
  const session = sessionState?.key === targetKey ? sessionState.value : undefined;
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  // The poll gave up after repeated failures; Retry is offered only then.
  const [stalled, setStalled] = useState(false);
  const [opening, setOpening] = useState(false);
  const openingRequest = useRef(false);
  // Polls this session's preview from the Host while the sheet is open; Retry
  // (revision) restarts it, and the cleanup stops it so nothing publishes late.
  useEffect(() => {
    let known: HostSession | undefined;
    let failures = 0;
    const load = async (isCurrent: () => boolean) => {
      try {
        const next = await remoteRequest<HostSession | null>(target.machineId, "sessions.get", {
          sessionId: target.sessionId,
          preview: true,
          revision: known?.revision,
        });
        if (!isCurrent()) return;
        if (next) known = next;
        if (!known) {
          setError(t("This session is no longer available."));
          scheduler.stop();
          return;
        }
        if (!known.session) throw new Error(t("This session is no longer available."));
        if (next) setSessionState({ key: `${target.machineId}:${target.sessionId}`, value: next });
        setError("");
        setStalled(false);
        failures = 0;
        // Only a running session changes; polling ends once it settles.
        if (known.status !== "running") scheduler.stop();
      } catch (reason) {
        if (!isCurrent()) return;
        // A passing outage is covered by the global notice.
        const message = presentRemoteError(reason);
        if (message) setError(message);
        if (known && known.status !== "running") {
          scheduler.stop();
          return;
        }
        failures += 1;
        if (failures >= PREVIEW_MAX_ATTEMPTS) {
          setError(message || t("This session could not be loaded."));
          setStalled(true);
          scheduler.stop();
          return;
        }
        // Rejecting makes the scheduler back off before the next attempt.
        throw reason;
      }
    };
    const scheduler = createRefreshScheduler({
      run: load,
      intervalMs: PREVIEW_POLL_MS,
      hiddenIntervalMs: HIDDEN_REFRESH_MS,
      maxBackoffMs: PREVIEW_MAX_BACKOFF_MS,
    });
    const onVisibility = () => scheduler.visibilityChanged();
    document.addEventListener("visibilitychange", onVisibility);
    scheduler.start();
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      scheduler.stop();
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
        <Text
          as="div"
          tone="secondary"
          size="secondary"
          leading="inherit"
          className="task-session-toolbar"
        >
          {/* While loading, the body's LoadingText is the one indicator. */}
          <span role="status">
            {session ? (
              <Badge
                tone={session.status === "running" ? "accent" : "neutral"}
                icon={
                  session.status === "running" ? (
                    <StatusDot tone="accent" label={t("Running")} />
                  ) : undefined
                }
              >
                {t(
                  session.status === "running"
                    ? "Running"
                    : session.status === "interrupted"
                      ? "Interrupted"
                      : "Idle",
                )}
              </Badge>
            ) : null}
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
                setError(presentRemoteError(reason, { explicit: true }));
              } finally {
                openingRequest.current = false;
                setOpening(false);
              }
            }}
          >
            {t("Open in Sessions")}
          </Button>
        </Text>
        {error ? (
          <Alert tone="danger">
            <span>{error}</span>
            {stalled ? (
              <Button
                variant="ghost"
                onClick={() => {
                  setStalled(false);
                  setRevision((value) => value + 1);
                }}
              >
                {t("Retry")}
              </Button>
            ) : null}
          </Alert>
        ) : null}
        {!session && !error ? <LoadingText /> : null}
        {conversation.map((block, index) => (
          <section
            {...surfaceAttributes(
              block.role === "user" ? { variant: "card", frame: "card", radius: "card" } : {},
              "task-session-message",
            )}
            data-role={block.role}
            key={block.id}
          >
            {/* Only the first message of a run of one role is labelled; the user card carries the rest. */}
            {conversation[index - 1]?.role !== block.role && block.role !== "user" ? (
              <SectionLabel as="h3" className="task-session-heading">
                {t("Agent")}
              </SectionLabel>
            ) : null}
            <AgentMarkdown text={block.text} />
          </section>
        ))}
        {operational.length > 0 ? (
          <Disclosure
            className="task-session-activity"
            size="sm"
            textSize="secondary"
            tone="secondary"
            leading="inherit"
            summary={t("Activity ({p0})", { p0: operational.length })}
          >
            <Text as="div" size="secondary" tone="secondary" leading="inherit">
              {operational.map((block) => (
                <section className="task-session-activity-item" key={block.id}>
                  <SectionLabel as="h3" className="task-session-heading">
                    {operationalRoleLabel(block.role)}
                  </SectionLabel>
                  <AgentMarkdown text={block.text} />
                </section>
              ))}
            </Text>
          </Disclosure>
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
      return t("Reasoning");
    case "tool":
      return t("Tool");
    case "approval":
      return t("Approval");
    case "plan":
      return t("Plan");
    case "tasks":
      return t("Tasks");
    case "handoff":
      return t("Handoff");
    default:
      return t("Status");
  }
}
