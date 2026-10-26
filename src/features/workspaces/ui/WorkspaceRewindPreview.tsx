import { useEffect, useState, useSyncExternalStore } from "react";
import { useT } from "../../../shared/i18n";
import { Alert } from "../../../shared/ui/Alert";
import { Button } from "../../../shared/ui/Button";
import { Modal } from "../../../shared/ui/Modal";
import type { SessionRewindPlan } from "../model/contracts";

type Preview = {
  displaySessionId: string;
  plan: SessionRewindPlan;
  apply: () => Promise<void>;
  settle: (applied: boolean) => void;
};
type Undo = { sessionId: string; run: () => Promise<void> };
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
export function offerWorkspaceRewindUndo(sessionId: string, run: () => Promise<void>) {
  undo.set(sessionId, { sessionId, run });
  changed();
}
export function clearWorkspaceRewindUndo(sessionId: string) {
  undo.delete(sessionId);
  changed();
}

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
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const apply = async () => {
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      await onApply();
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setPending(false);
    }
  };
  return (
    <Modal
      title={t(plan.direction === "undo" ? "Undo rewind" : "Rewind conversation and files")}
      onClose={() => {
        if (!pending) onClose();
      }}
      size="md"
      footer={
        <>
          <Button variant="ghost" disabled={pending} onClick={onClose}>
            {t("Cancel")}
          </Button>
          <Button
            variant="primary"
            tone="warning"
            loading={pending}
            disabled={pending || plan.blockers.length > 0 || plan.expiresAt <= now}
            onClick={() => void apply()}
          >
            {t(plan.direction === "undo" ? "Undo rewind" : "Rewind conversation and files")}
          </Button>
        </>
      }
    >
      <div className="flex min-w-0 flex-col gap-3 px-4 py-3 text-ui-secondary text-(--ui-text-secondary)">
        <p>
          {t("Turns: {p0} · Commits: {p1} · Files: {p2}", {
            p0: plan.removedUserBlockIds.length,
            p1: plan.affectedCommits.length,
            p2: plan.affectedPaths.length,
          })}
        </p>
        <p className="break-words font-mono text-ui-caption">
          {plan.branchRef.replace(/^refs\/heads\//, "")} · {plan.currentHead.slice(0, 12)} →{" "}
          {plan.targetHead.slice(0, 12)}
        </p>
        {plan.merged ? (
          <Alert tone="info">{t("Main is not rewound. The merged result stays in main.")}</Alert>
        ) : null}
        {plan.published ? (
          <p>{t("Published branches stay unchanged. This rewind only changes this workspace.")}</p>
        ) : null}
        <details>
          <summary>{t("Affected commits and files")}</summary>
          <ul className="mbs-2 max-h-48 overflow-auto break-words font-mono text-ui-caption">
            {plan.affectedCommits.map((commit) => (
              <li key={commit}>{commit}</li>
            ))}
            {plan.affectedPaths.map((path) => (
              <li key={path}>{path}</li>
            ))}
          </ul>
        </details>
        {plan.blockers.map((blocker) => (
          <Alert key={blocker} tone="warning">
            {blocker}
          </Alert>
        ))}
        {error ? (
          <Alert tone="danger" role="alert">
            {error}
          </Alert>
        ) : null}
      </div>
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
  const currentUndo = undo.get(sessionId);
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
        <div className="flex flex-wrap items-center gap-2 text-ui-caption">
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
                setError(cause instanceof Error ? cause.message : String(cause));
              } finally {
                setPending(false);
              }
            }}
          >
            {t("Undo rewind")}
          </Button>
          {error ? (
            <span role="alert" className="text-(--ui-tone-danger-fg)">
              {error}
            </span>
          ) : null}
        </div>
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
