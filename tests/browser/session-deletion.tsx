import { createRoot } from "react-dom/client";
import { useState } from "react";
import { SessionDeletionNotice } from "../../src/features/sessions/ui/SessionDeletionNotice";
import {
  setSessionDeletionStatus,
  type SessionDeletionStage,
} from "../../src/features/sessions/model/sessionDeletionStatus";
import { noteRemoteActivity } from "../../src/features/sessions/model/remoteActivityNotice";
import { applyThemePreference } from "../../src/features/settings/model/appearance";
import { Button } from "../../src/shared/ui/Button";
import "./w7-shell.css";

const params = new URLSearchParams(location.search);
applyThemePreference(params.get("theme") === "light" ? "light" : "dark");
const base = {
  sessionId: "fixture-deletion",
  cwd: "/fixture",
  title: "A long conversation title that must wrap while conversation data is being removed",
  stage: "preparing" as SessionDeletionStage,
  startedAt: Date.now() - 12_000,
};
setSessionDeletionStatus(base);
function DeletionFixture() {
  const [bulk, setBulk] = useState({
    progress: {
      completed: 8,
      total: 10,
      title: base.title,
      sessionIds: [base.sessionId],
    } as { completed: number; total: number; title: string; sessionIds: string[] } | null,
    message: null as string | null,
    error: false,
    success: false,
  });
  const bulkMode = params.has("bulk");
  const finishBulk = (message: string, error = false) => {
    setSessionDeletionStatus({ ...base, outcome: "deleted" });
    setBulk({ progress: null, message, error, success: !error });
  };
  return (
    <main className="min-h-dvh bg-background-base text-content">
      <div style={{ width: 280, maxWidth: "100%" }}>
        <SessionDeletionNotice
          cwd="/fixture"
          bulk={
            bulkMode ? { ...bulk, onDismiss: () => setBulk({ ...bulk, message: null }) } : undefined
          }
        />
        <div className="flex flex-wrap gap-2 p-2">
          <Button onClick={() => setSessionDeletionStatus({ ...base, stage: "provider" })}>
            Close processes
          </Button>
          <Button onClick={() => setSessionDeletionStatus({ ...base, stage: "deleting" })}>
            Delete data
          </Button>
          <Button
            onClick={() =>
              bulkMode
                ? finishBulk("10 conversations deleted.")
                : setSessionDeletionStatus({ ...base, outcome: "deleted" })
            }
          >
            Complete
          </Button>
          {bulkMode ? (
            <Button
              onClick={() =>
                finishBulk(
                  "8 conversations deleted. 2 conversations could not be deleted: Storage unavailable.",
                  true,
                )
              }
            >
              Bulk failure
            </Button>
          ) : null}
          <Button
            onClick={() =>
              setSessionDeletionStatus({
                ...base,
                outcome: "deleted",
                error: "Worktree cleanup unavailable",
              })
            }
          >
            Keep worktree warning
          </Button>
          <Button
            onClick={() =>
              setSessionDeletionStatus({ ...base, outcome: "failed", error: "Storage unavailable" })
            }
          >
            Fail
          </Button>
          <Button
            onClick={() =>
              noteRemoteActivity({
                scope: { cwd: "/fixture" },
                kind: "deleted",
                device: "Work laptop",
              })
            }
          >
            Remote delete
          </Button>
          <Button
            onClick={() =>
              noteRemoteActivity({
                scope: { cwd: "/fixture" },
                kind: "deleted",
                device: "Work laptop",
                ok: false,
              })
            }
          >
            Remote failure
          </Button>
        </div>
      </div>
    </main>
  );
}
createRoot(document.getElementById("root")!).render(<DeletionFixture />);
