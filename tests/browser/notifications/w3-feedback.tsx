import { useEffect } from "react";
import { createRoot } from "react-dom/client";
import { mockIPC, mockWindows } from "@tauri-apps/api/mocks";
import { ApprovalToasts } from "../../../src/features/sessions/ui/ApprovalToasts";
import { NOTIFICATION_HISTORY_KEY } from "../../../src/features/notifications/model/notificationHistory";
import { rememberNotificationProjects } from "../../../src/features/notifications/model/notificationProjects";
import { applyThemePreference } from "../../../src/features/settings/model/appearance";
import { setLanguagePreference } from "../../../src/shared/i18n";
import { Alert } from "../../../src/shared/ui/Alert";
import { Button } from "../../../src/shared/ui/Button";
import { FailureState } from "../../../src/shared/ui/FailureState";
import { InlineError, InlineMessage } from "../../../src/shared/ui/InlineError";
import { toast, ToastRegion } from "../../../src/shared/ui/ToastRegion";
import { logToastAnnouncement } from "../../../src/features/notifications/model/notificationLog";
import "../../../src/styles/index.css";

// Wave 3 screenshot fixture: synthetic state only, no host, nothing sent or saved.
mockWindows("main");
mockIPC(() => []);
setLanguagePreference("en");
const params = new URLSearchParams(location.search);
applyThemePreference(params.get("theme") === "light" ? "light" : "dark");
const scene = params.get("s") ?? "toasts";
const cwd = "G:/Projects/work/upstream";
const noop = () => undefined;
rememberNotificationProjects([
  { id: "repository:fixture", name: "bycoda", detail: "fixture", kind: "repository", paths: [cwd] },
]);
const now = Date.now();
const min = 60_000;
const day = 86_400_000;
if (scene === "center") {
  const entry = (
    i: number,
    kind: string,
    title: string,
    label: string,
    ago: number,
    extra: Record<string, unknown> = {},
  ) => ({
    key: `h-${i}`,
    sessionId: `s-${i}`,
    cwd,
    title,
    label,
    kind,
    occurredAt: now - ago,
    ...extra,
  });
  localStorage.setItem(
    NOTIFICATION_HISTORY_KEY,
    JSON.stringify([
      entry(1, "question", "codex · Dev app slow start", "Where does the slowness begin?", 2 * min),
      entry(2, "failed", "claude · Release script", "Turn failed: exit code 1", 9 * min, {
        tone: "danger",
      }),
      entry(3, "finished", "codex · Refactor notifications", "Finished in 4m", 40 * min, {
        read: true,
        count: 3,
        earlier: [now - 50 * min, now - 70 * min],
      }),
      entry(
        4,
        "notice",
        "Connection interrupted",
        "Check the connection before retrying.",
        3 * 3600_000,
        { tone: "warning" },
      ),
      entry(
        5,
        "approval",
        "codex · Single commit and release",
        "Run pnpm release?",
        day + 3600_000,
        {
          read: true,
        },
      ),
      entry(
        6,
        "notice",
        "Update failed",
        "Grok Build: access denied. Retry in Providers.",
        2 * day,
        {
          tone: "danger",
          count: 2,
          earlier: [now - 2 * day - 3600_000],
        },
      ),
      entry(7, "reminder", "Standup", "Daily summary is ready", 5 * day, { read: true }),
    ]),
  );
}
if (scene === "center")
  localStorage.setItem("bycoda.notifications.seenAt.v1", String(now - 6 * day));
if (scene === "center-empty") localStorage.removeItem(NOTIFICATION_HISTORY_KEY);

function Toasts() {
  // fixture-only seeding of the shared toast queue once the region is mounted
  useEffect(() => {
    if (scene === "toasts-end") {
      toast.show({
        tone: "info",
        title: "Harness updates available",
        message: "Claude Code 2.1.325 to 2.1.326",
        durationMs: null,
      });
      toast.show({
        tone: "success",
        title: "Update complete",
        message: "Claude Code updated to 2.1.326",
        durationMs: null,
      });
      toast.show({
        tone: "warning",
        placement: "top-end",
        title: "Connection interrupted",
        message: "Check the connection before retrying.",
        durationMs: null,
      });
    }
    if (scene === "toasts-center") {
      toast.show({
        tone: "warning",
        title: "Connection interrupted",
        message: "Check the connection before retrying.",
        durationMs: null,
      });
      toast.show({
        tone: "danger",
        title: "Update failed",
        message: "Grok Build: access denied. Retry in Providers.",
        action: { label: "Retry", onClick: noop },
      });
    }
    if (scene === "toasts") {
      toast.show({
        tone: "info",
        title: "Harness updates available",
        message: "Claude Code 2.1.325 to 2.1.326",
        durationMs: null,
      });
      toast.show({
        tone: "success",
        title: "Update complete",
        message: "Claude Code updated to 2.1.326",
        durationMs: null,
      });
      toast.show({
        tone: "warning",
        title: "Connection interrupted",
        message: "Check the connection before retrying.",
        durationMs: null,
      });
      toast.show({
        tone: "danger",
        title: "Update failed",
        message: "Grok Build: access denied. Retry in Providers.",
        action: { label: "Retry", onClick: noop },
      });
    }
    if (scene === "toasts-repeat") {
      for (let i = 0; i < 3; i++)
        toast.show({
          tone: "info",
          title: "Saved to clipboard",
          message: "Session link copied",
          durationMs: null,
        });
    }
    if (scene === "toasts-repeat-error") {
      for (let i = 0; i < 3; i++)
        toast.show({
          tone: "danger",
          title: "Could not save",
          message: "Disk is full",
          action: { label: "Retry", onClick: noop },
        });
    }
  }, []);
  return (
    <ToastRegion onRecord={logToastAnnouncement} insets={{ "top-center": 48, "top-end": 48 }} />
  );
}

function Scene() {
  if (scene.startsWith("toasts")) return <Toasts />;
  if (scene === "banner")
    return (
      <div className="mx-auto grid max-w-[900px] gap-3 p-6">
        <Alert tone="info" title="Indexing started">
          Search results stay available while the index rebuilds.
        </Alert>
        <Alert tone="success" title="Settings saved">
          Changes apply to new sessions.
        </Alert>
        <Alert
          tone="warning"
          title="Provider needs attention"
          action={{ label: "Open provider", onClick: noop }}
        >
          Your Claude Code login expires soon.
        </Alert>
        <Alert
          tone="danger"
          title="Could not reach the host"
          action={{ label: "Retry", onClick: noop }}
          onDismiss={noop}
        >
          The connection was refused.
        </Alert>
        <Alert tone="warning">Title-less warning reads as a single line.</Alert>
      </div>
    );
  if (scene === "inline")
    return (
      <div className="mx-auto grid max-w-[720px] gap-4 p-6">
        <div className="grid gap-2 rounded-lg border border-stroke p-3">
          <textarea
            aria-label="Message"
            defaultValue="Explain why the dev build is slow to open and what to measure first"
            className="min-h-16 w-full resize-none bg-transparent text-ui-body outline-none"
          />
          <InlineError retry={{ onRetry: noop }}>
            Message could not be sent. Your text is kept.
          </InlineError>
          <div className="flex justify-end">
            <Button>Send</Button>
          </div>
        </div>
        <div className="grid gap-2 rounded-lg border border-stroke p-3">
          <label className="text-ui-caption">Server URL</label>
          <input
            defaultValue="htp://bad"
            className="rounded-md border border-stroke bg-transparent px-2 py-1"
          />
          <InlineMessage tone="danger" action={{ label: "Use default", onClick: noop }}>
            Enter a valid http or https address.
          </InlineMessage>
          <InlineMessage tone="warning">Provider rate limit is close.</InlineMessage>
          <InlineMessage tone="info">Changes apply to new sessions.</InlineMessage>
          <InlineMessage tone="success">Saved.</InlineMessage>
        </div>
      </div>
    );
  if (scene === "failure")
    return (
      <div className="grid h-screen grid-cols-1 md:grid-cols-2">
        <FailureState
          title="Could not load the workspace"
          description="The workspace is still saved on disk. Try again, or copy the details for support."
          error={new Error("Error: could not resolve module graph for /src/features/example.tsx")}
          onRetry={noop}
        />
        <FailureState
          title="Connection lost"
          description="The host stopped responding."
          error={new Error("ECONNRESET")}
          retryLabel="Reconnect"
          onRetry={noop}
          secondaryAction={{ label: "Back to workspace", onClick: noop }}
        />
      </div>
    );
  return (
    <ApprovalToasts
      notices={[]}
      popupNotices={[]}
      onFocusSession={noop}
      onOpenHistorySession={() => true}
      onApproval={noop}
    />
  );
}
createRoot(document.getElementById("root")!).render(<Scene />);
