import { useEffect, useRef, useState } from "react";
import type { AssistantSessionManagement } from "../model/session";
import { useAssistantSnapshot } from "../../assistant/model/assistantClient";
import {
  prepareAssistantSessionDetach,
  AssistantSessionDetachError,
} from "../../assistant/model/assistantSessionDetach";
import { Button } from "../../../shared/ui/Button";
import { Modal } from "../../../shared/ui/Modal";
import { Bot } from "../../../shared/ui/icons";
import { useT } from "../../../shared/i18n";
import { InlineError } from "../../../shared/ui/InlineError";
import { SessionLifecycleControl } from "./SessionLifecycleControl";

/** Header controls of a session: close/reopen/task link, and the assistant detach control. */
export function AssistantSessionControl(props: {
  sessionId: string;
  cwd: string;
  management?: AssistantSessionManagement;
  local: boolean;
}) {
  return (
    <>
      <SessionLifecycleControl sessionId={props.sessionId} cwd={props.cwd} local={props.local} />
      {props.local && props.management?.assistant && props.management.detachedAt === undefined ? (
        <LocalControl
          key={`${props.sessionId}:${props.management.jobId ?? props.management.supervisionId}`}
          {...props}
          management={props.management}
        />
      ) : null}
    </>
  );
}
function LocalControl({
  sessionId,
  cwd,
  management,
}: {
  sessionId: string;
  cwd: string;
  management: AssistantSessionManagement;
}) {
  const t = useT(),
    { environmentId } = useAssistantSnapshot();
  const [open, setOpen] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [uncertain, setUncertain] = useState(false),
    [detached, setDetached] = useState(false);
  const [prepared, setPrepared] = useState<Awaited<
    ReturnType<typeof prepareAssistantSessionDetach>
  > | null>(null);
  const epoch = useRef(0),
    scope = useRef({ environmentId, sessionId, cwd });
  scope.current = { environmentId, sessionId, cwd };
  useEffect(
    () => () => {
      epoch.current++;
    },
    [],
  );
  useEffect(() => {
    epoch.current++;
    setOpen(false);
    setPrepared(null);
    setError("");
    setBusy(false);
    setUncertain(false);
    setDetached(false);
  }, [environmentId, sessionId, cwd]);
  async function inspect() {
    if (!environmentId || busy) return;
    const token = ++epoch.current,
      source = environmentId;
    setOpen(true);
    setBusy(true);
    setError("");
    const current = () =>
      epoch.current === token &&
      scope.current.environmentId === source &&
      scope.current.sessionId === sessionId &&
      scope.current.cwd === cwd;
    try {
      const next = await prepareAssistantSessionDetach({
        sessionId,
        cwd,
        management,
        environmentId: source,
        current,
      });
      if (!current()) return;
      setPrepared(next);
      setDetached(next.detached);
      if (next.detached) setUncertain(false);
    } catch (cause) {
      if (current()) setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (current()) setBusy(false);
    }
  }
  async function detach() {
    if (!prepared || busy || uncertain || detached) return;
    setBusy(true);
    setError("");
    const token = epoch.current;
    try {
      await prepared.detach();
      if (token === epoch.current) setDetached(true);
    } catch (cause) {
      if (token === epoch.current) {
        setUncertain(!(cause instanceof AssistantSessionDetachError) || cause.submitted);
        setPrepared(null);
        setError(cause instanceof Error ? cause.message : String(cause));
      }
    } finally {
      if (token === epoch.current) setBusy(false);
    }
  }
  return (
    <>
      {!detached && (
        <Button
          iconOnly
          label={t("Take assistant off this session")}
          disabled={!environmentId}
          onClick={() => void inspect()}
        >
          <Bot className="icon-sm" />
        </Button>
      )}
      {open && (
        <Modal
          title={t("Take assistant off this session")}
          onClose={() => {
            epoch.current++;
            setOpen(false);
            setBusy(false);
            setPrepared(null);
          }}
          size="sm"
        >
          <div className="space-y-3">
            <p>
              {t(
                "Remove assistant follow-ups from this session. Its task and running worker continue.",
              )}
            </p>
            {error && <InlineError>{error}</InlineError>}
            {detached ? (
              <p role="status">{t("Assistant supervision removed")}</p>
            ) : uncertain ? (
              <>
                <p role="status">
                  {t("Supervision removal is unconfirmed. Check its status before continuing.")}
                </p>
                <Button loading={busy} onClick={() => void inspect()}>
                  {t("Check status")}
                </Button>
              </>
            ) : !prepared && error ? (
              <Button loading={busy} onClick={() => void inspect()}>
                {t("Check status")}
              </Button>
            ) : (
              <Button loading={busy} disabled={!prepared} onClick={() => void detach()}>
                {t("Remove supervision")}
              </Button>
            )}
          </div>
        </Modal>
      )}
    </>
  );
}
