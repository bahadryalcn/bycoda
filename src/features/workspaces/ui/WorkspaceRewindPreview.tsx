import { Text } from "../../../shared/ui/Text";
import { useEffect, useState, useSyncExternalStore } from "react";
import { useT } from "../../../shared/i18n";
import { Alert } from "../../../shared/ui/Alert";
import { ErrorDetails } from "../../../shared/ui/ErrorDetails";
import { Button } from "../../../shared/ui/Button";
import { Modal, ModalActions } from "../../../shared/ui/Modal";
import { InlineError } from "../../../shared/ui/InlineError";
import { describeRemoteError } from "../../connections/public/remoteFailure";
import type { SessionRewindPlan } from "../model/contracts";
import { Disclosure } from "../../../shared/ui/Disclosure";
import { shortSha } from "../../../shared/lib/shortSha";

type Preview = {
  displaySessionId: string;
  plan: SessionRewindPlan;
  apply: () => Promise<void>;
  settle: (applied: boolean) => void;
};
type Undo = { sessionId: string; run: () => Promise<void> };
export type WorkspaceRewindUndoIdentity = {
  workspaceId: string;
  operationId: string;
};
type UndoHandler = (sessionId: string, identity: WorkspaceRewindUndoIdentity) => Promise<void>;
const undoHandlers = new Map<string, UndoHandler>();
const undoStorageKey = (sessionId: string) => `bycoda.workspaceRewindUndo:${sessionId}`;
function savedUndo(sessionId: string): WorkspaceRewindUndoIdentity | null {
  try {
    const value = JSON.parse(localStorage.getItem(undoStorageKey(sessionId)) ?? "null");
    return value &&
      typeof value.workspaceId === "string" &&
      typeof value.operationId === "string" &&
      value.workspaceId.length > 0 &&
      value.workspaceId.length < 256 &&
      value.operationId.length > 0 &&
      value.operationId.length < 256
      ? value
      : null;
  } catch {
    return null;
  }
}
/** Persisted receipt IDs locate an Undo; a fresh owner/revision-bound plan still authorizes it. */
export function registerWorkspaceRewindUndoHandler(sessionId: string, handler: UndoHandler) {
  undoHandlers.set(sessionId, handler);
  changed();
  return () => {
    if (undoHandlers.get(sessionId) === handler) {
      undoHandlers.delete(sessionId);
      changed();
    }
  };
}
let preview: Preview | null = null;
const undo = new Map<string, Undo>();
let version = 0;
const listeners = new Set<() => void>();
function changed() {
  version++;
  for (const listener of listeners) listener();
}
function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function requestWorkspaceRewindPreview(
  plan: SessionRewindPlan,
  apply: () => Promise<void>,
  displaySessionId = plan.sessionId,
): Promise<boolean> {
  if (preview) return Promise.resolve(false);
  return new Promise((settle) => {
    preview = { plan, apply, settle, displaySessionId };
    changed();
  });
}
export function offerWorkspaceRewindUndo(
  sessionId: string,
  run: () => Promise<void>,
  identity?: WorkspaceRewindUndoIdentity,
) {
  if (identity)
    try {
      localStorage.setItem(undoStorageKey(sessionId), JSON.stringify(identity));
    } catch {
      /* The in-memory Undo remains usable when storage is unavailable. */
    }
  undo.set(sessionId, { sessionId, run });
  changed();
}
export function clearWorkspaceRewindUndo(sessionId: string) {
  try {
    localStorage.removeItem(undoStorageKey(sessionId));
  } catch {
    /* Fresh plans remain authoritative. */
  }
  undo.delete(sessionId);
  changed();
}

const MAX_TIMER_MS = 2_147_483_647;

export function WorkspaceRewindPreview({
  plan,
  onApply,
  onClose,
}: {
  plan: SessionRewindPlan;
  onApply: () => Promise<void>;
  onClose: () => void;
}) {
  const t = useT();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expired, setExpired] = useState(() => Date.now() >= plan.expiresAt);
  useEffect(() => {
    // One bounded timer flips `expired` at plan.expiresAt; no per-second re-render of the preview.
    // Re-arms past setTimeout's ~24.8-day ceiling so a long expiry never fires early.
    let timer: ReturnType<typeof setTimeout> | undefined;
    const arm = () => {
      const remaining = plan.expiresAt - Date.now();
      if (remaining <= 0) {
        setExpired(true);
        return;
      }
      timer = setTimeout(arm, Math.min(remaining, MAX_TIMER_MS));
    };
    arm();
    return () => clearTimeout(timer);
  }, [plan.expiresAt]);
  const apply = async () => {
    if (pending) return;
    // Expiry is re-checked at action time: a throttled timer must not let an expired plan apply.
    if (Date.now() >= plan.expiresAt) {
      setExpired(true);
      return;
    }
    setPending(true);
    setError(null);
    try {
      await onApply();
      onClose();
    } catch (cause) {
      const { details, message } = describeRemoteError(cause);
      setError(details || message);
    } finally {
      setPending(false);
    }
  };
  return (
    <Modal
      title={plan.direction === "undo" ? t("Undo rewind") : t("Rewind conversation and files")}
      onClose={() => {
        if (!pending) onClose();
      }}
      size="md"
      footer={
        <ModalActions>
          <Button variant="ghost" disabled={pending} onClick={onClose}>
            {t("Cancel")}
          </Button>
          <Button
            variant="primary"
            tone="warning"
            loading={pending}
            disabled={pending || plan.blockers.length > 0 || expired}
            disabledReason={
              plan.blockers.length > 0
                ? t("Resolve the listed blockers first.")
                : expired
                  ? t("This preview expired. Close it and open it again.")
                  : undefined
            }
            onClick={() => void apply()}
          >
            {plan.direction === "undo" ? t("Undo") : t("Rewind")}
          </Button>
        </ModalActions>
      }
    >
      <Text as="div" size="secondary" tone="secondary" className="flex min-w-0 flex-col gap-3">
        <p>
          {t("Turns: {p0} · Commits: {p1} · Files: {p2}", {
            p0: plan.removedUserBlockIds.length,
            p1: plan.affectedCommits.length,
            p2: plan.affectedPaths.length,
          })}
        </p>
        <Text as="p" size="caption" tone="inherit" className="break-words font-mono">
          {plan.branchRef.replace(/^refs\/heads\//, "")} · {shortSha(plan.currentHead)} →{" "}
          {shortSha(plan.targetHead)}
        </Text>
        {plan.merged ? (
          <Alert tone="info">{t("Main is not rewound. The merged result stays in main.")}</Alert>
        ) : null}
        {plan.published ? (
          <p>{t("Published branches stay unchanged. This rewind only changes this workspace.")}</p>
        ) : null}
        <Disclosure summary={t("Affected commits and files")} size="sm">
          <Text
            as="ul"
            size="caption"
            tone="inherit"
            leading="inherit"
            className="mbs-2 max-h-48 overflow-auto break-words font-mono"
          >
            {plan.affectedCommits.map((commit) => (
              <li key={commit}>{commit}</li>
            ))}
            {plan.affectedPaths.map((path) => (
              <li key={path}>{path}</li>
            ))}
          </Text>
        </Disclosure>
        {plan.blockers.map((blocker) => (
          <Alert key={blocker} tone="warning">
            {blocker}
          </Alert>
        ))}
        {expired ? (
          <Alert tone="warning">
            {t("This rewind preview has expired. Cancel and open a new preview.")}
          </Alert>
        ) : null}
        {error ? (
          <Alert
            tone="danger"
            title={t("Couldn’t rewind")}
            extra={<ErrorDetails title={t("Couldn’t rewind")} detail={error} />}
          />
        ) : null}
      </Text>
    </Modal>
  );
}

/** Mounted in the existing composer tree; Modal retains the shared overlay owner. */
export function WorkspaceRewindPreviewHost({ sessionId }: { sessionId: string }) {
  useSyncExternalStore(
    subscribe,
    () => version,
    () => 0,
  );
  const t = useT();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const current = preview?.displaySessionId === sessionId ? preview : null;
  const saved = savedUndo(sessionId);
  const handler = undoHandlers.get(sessionId) ?? undoHandlers.get("*");
  const currentUndo =
    saved && handler ? { sessionId, run: () => handler(sessionId, saved) } : undo.get(sessionId);
  // Settle a preview if its composer leaves before the owner approves it.
  useEffect(
    () => () => {
      if (preview?.displaySessionId === sessionId) {
        const current = preview;
        preview = null;
        current.settle(false);
        changed();
      }
    },
    [sessionId],
  );
  return (
    <>
      {currentUndo ? (
        <Text as="div" size="caption" tone="inherit" className="flex flex-wrap items-center gap-2">
          <Button
            variant="ghost"
            loading={pending}
            disabled={pending}
            onClick={async () => {
              if (pending || !currentUndo) return;
              setPending(true);
              setError(null);
              try {
                await currentUndo.run();
              } catch (cause) {
                const { details, message } = describeRemoteError(cause);
                setError(details || message);
              } finally {
                setPending(false);
              }
            }}
          >
            {t("Undo rewind")}
          </Button>
          {error ? <InlineError details={error}>{t("Couldn’t undo rewind")}</InlineError> : null}
        </Text>
      ) : null}
      {current ? (
        <WorkspaceRewindPreview
          key={current.plan.token}
          plan={current.plan}
          onApply={async () => {
            await current.apply();
            current.settle(true);
          }}
          onClose={() => {
            if (preview === current) {
              preview = null;
              current.settle(false);
              changed();
            }
          }}
        />
      ) : null}
    </>
  );
}
