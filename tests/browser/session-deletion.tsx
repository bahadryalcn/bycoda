import { createRoot } from "react-dom/client";
import { SessionDeletionNotice } from "../../src/features/sessions/ui/SessionDeletionNotice";
import {
  setSessionDeletionStatus,
  type SessionDeletionStage,
} from "../../src/features/sessions/model/sessionDeletionStatus";
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
createRoot(document.getElementById("root")!).render(
  <main className="min-h-dvh bg-background-base text-content">
    <div style={{ width: 280, maxWidth: "100%" }}>
      <SessionDeletionNotice cwd="/fixture" />
      <div className="flex flex-wrap gap-2 p-2">
        <Button onClick={() => setSessionDeletionStatus({ ...base, stage: "provider" })}>
          Close processes
        </Button>
        <Button onClick={() => setSessionDeletionStatus({ ...base, stage: "deleting" })}>
          Delete data
        </Button>
        <Button onClick={() => setSessionDeletionStatus({ ...base, outcome: "deleted" })}>
          Complete
        </Button>
        <Button
          onClick={() =>
            setSessionDeletionStatus({ ...base, outcome: "failed", error: "Storage unavailable" })
          }
        >
          Fail
        </Button>
      </div>
    </div>
  </main>,
);
