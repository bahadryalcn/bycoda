import { useState, type ComponentProps } from "react";
import { createRoot } from "react-dom/client";
import { mockIPC, mockWindows } from "@tauri-apps/api/mocks";
import { flushHostSessionBindings } from "../../../src/features/connections/public/sessionExecutionBinding";
import { ApprovalToasts } from "../../../src/features/sessions/ui/ApprovalToasts";
import { ActivityDock } from "../../../src/features/sessions/ui/ActivityDock";
import { ComposerNoticeStack } from "../../../src/features/sessions/ui/ComposerNoticeStack";
import { requestOwnerApproval } from "../../../src/features/notifications/model/ownerApprovals";
import {
  OwnerApprovalChat,
  OwnerApprovalInbox,
} from "../../../src/features/notifications/ui/OwnerApprovalRequests";
import { NOTIFICATION_HISTORY_KEY } from "../../../src/features/notifications/model/notificationHistory";
import { rememberNotificationProjects } from "../../../src/features/notifications/model/notificationProjects";
import { applyThemePreference } from "../../../src/features/settings/model/appearance";
import { setLanguagePreference } from "../../../src/shared/i18n";
import { createApprovalOccurrenceId } from "../../../src/shared/model/approvalOccurrence";
import { Toast, ToastRegion } from "../../../src/shared/ui/ToastRegion";
import { logToastAnnouncement } from "../../../src/features/notifications/model/notificationLog";
import { Text } from "../../../src/shared/ui/Text";
import { Button } from "../../../src/shared/ui/Button";
import { Surface } from "../../../src/shared/ui/Surface";
import "../../../src/features/sessions/ui/BycodaSession.css";
import "../../../src/styles/index.css";

// Synthetic requests only; native actions cannot reach the owner's host.
mockWindows("main");
mockIPC(() => []);
setLanguagePreference("en");
const params = new URLSearchParams(location.search);
applyThemePreference(params.get("theme") === "light" ? "light" : "dark");
type Notice = ComponentProps<typeof ApprovalToasts>["notices"][number];
const titles = [
  "Dev uygulamasının yavaş açılma nedeni",
  "Tek commit ve yeni sürüm yayını (local copy)",
  "A very long conversation title with multiple words and a repository name that must remain readable on narrow screens",
];
const cwd = "G:/Projects/work/upstream";
rememberNotificationProjects([
  { id: "repository:fixture", name: "bycoda", detail: "fixture", kind: "repository", paths: [cwd] },
]);
const label =
  "Yavaşlık hangi aşamada: pnpm tauri dev komutundan pencerenin açılmasına kadar mı, pencere açıldıktan sonra yükleme ekranında mı? Yaklaşık kaç saniye sürüyor?";
const notices: Notice[] = titles.map((title, index) => ({
  sessionId: `fixture-${index}`,
  requestId: 1,
  kind: index === 1 ? "approval" : "question",
  label,
  session: {
    id: `fixture-${index}`,
    cwd,
    title,
    harness: "codex",
    model: "",
    modelSettings: {},
    runtimeMode: "supervised",
    // Decisions bind to the open approval occurrence in the session, as in the real app.
    blocks:
      index === 1
        ? [
            {
              id: `approval-${index}`,
              role: "approval",
              text: label,
              approval: { requestId: 1, occurrenceId: createApprovalOccurrenceId() },
            },
          ]
        : [],
  },
}));
if (!params.has("toasts") && !localStorage.getItem(NOTIFICATION_HISTORY_KEY)) {
  localStorage.setItem(
    NOTIFICATION_HISTORY_KEY,
    JSON.stringify(
      Array.from({ length: 30 }, (_, index) => ({
        key: `history-${index}`,
        sessionId: `old-${index}`,
        cwd,
        title: index === 1 ? "codex · old-gone" : `codex · ${titles[index % titles.length]}`,
        label: index === 2 ? "long_unbroken_value_".repeat(80) : label,
        kind: (
          [
            "question",
            "approval",
            "failed",
            "finished",
            "reminder",
            "assistant",
            "background",
            "account",
          ] as const
        )[index % 8],
        occurredAt: Date.UTC(2026, 9, 18, 1, 27) - index * 3600000,
      })),
    ),
  );
}
// A live owner approval: the pending card lists its title and time left, never its message.
if (!params.has("empty") && !params.has("toasts") && !params.has("owner")) {
  requestOwnerApproval({
    id: "fixture-owner",
    sessionId: "fixture-0",
    input: {
      title: "Run the release script",
      message: "Command: pnpm release",
      confirmLabel: "Run",
      cancelLabel: "Cancel",
      deadline: Date.now() + 200_000,
    },
  }).catch(() => undefined);
}
function OwnerApprovalScenario() {
  const [inChat, setInChat] = useState(true);
  const [batchResult, setBatchResult] = useState("");
  const [result, setResult] = useState("");
  const request = () => {
    setResult("Pending");
    const body = [
      "The onboarding form now checks free-text fields before saving.",
      ...Array.from(
        { length: 24 },
        (_, index) => `${index + 1}. Verify the field in the merchant portal.`,
      ),
      "End of comment",
    ].join("\n\n");
    requestOwnerApproval({
      id: "fixture-jira",
      sessionId: "fixture-chat",
      input: {
        title: "bycoda — Inbox operation approval",
        message: `Exact request for PFDEV-1123\n\n${body}`,
        confirmLabel: "Approve this operation",
        cancelLabel: "Cancel",
        deadline: Date.now() + 60_000,
        details: {
          kind: "inbox",
          action: "comment",
          project: cwd,
          provider: "jira",
          target: "PFDEV-1123",
          body,
        },
      },
    }).then(
      (approved) => setResult(approved ? "Approved" : "Cancelled"),
      () => setResult("Expired"),
    );
  };
  const requestSeveral = () => {
    setBatchResult("Pending");
    const commands = ["git status", "pnpm install", "rm -rf dist", "git push origin main"];
    void Promise.allSettled(
      commands.map((command, index) =>
        requestOwnerApproval({
          id: `fixture-batch-${Date.now()}-${index}`,
          sessionId: "fixture-chat",
          input: {
            title: "bycoda — Command approval",
            message: `Run in ${cwd}
Command: ${command}`,
            confirmLabel: "Approve",
            cancelLabel: "Cancel",
            deadline: Date.now() + 60_000,
          },
        }),
      ),
    ).then((answers) =>
      setBatchResult(
        answers
          .map((answer) => (answer.status === "fulfilled" && answer.value ? "A" : "D"))
          .join(""),
      ),
    );
  };
  return (
    <main data-session-body className="chat-pane-background flex h-dvh min-h-0 flex-col gap-2 p-4">
      <div className="flex gap-2">
        <Button onClick={() => setInChat((value) => !value)}>
          {inChat ? "Open settings" : "Open chat"}
        </Button>
        <Button onClick={request}>Request approval</Button>
        <Button onClick={requestSeveral}>Request several approvals</Button>
        <output>{result}</output>
        <output aria-label="Batch result">{batchResult}</output>
      </div>
      <div className="@container flex min-h-0 flex-1 flex-col">
        <OwnerApprovalChat sessionId="fixture-chat" visible={inChat}>
          <div className="min-h-0 flex-1">{inChat ? "Conversation" : "Settings"}</div>
        </OwnerApprovalChat>
      </div>
      {inChat ? (
        <div data-session-composer className="mx-auto w-full max-w-4xl shrink-0 px-3">
          <ComposerNoticeStack>
            <ActivityDock
              sessionId="fixture-chat"
              harness="claude"
              blocks={[]}
              pendingOwnerApproval={result === "Pending" || batchResult === "Pending"}
              pendingQuestion={false}
              busy={false}
              atEnd
              onOpenAgent={() => {}}
            />
          </ComposerNoticeStack>
          <Surface variant="card" padding="md">
            <Text as="p">Message</Text>
          </Surface>
        </div>
      ) : null}
      <OwnerApprovalInbox onOpenSession={() => setInChat(true)} />
    </main>
  );
}
function Fixture() {
  const [pending, setPending] = useState(
    params.has("empty") || params.has("toasts") ? [] : notices,
  );
  const [result, setResult] = useState("");
  return (
    <>
      {params.has("toasts") ? <ToastScenario /> : null}
      <ApprovalToasts
        notices={pending}
        popupNotices={params.has("popup") ? pending : []}
        onFocusSession={(id) => setResult(`Opened ${id}`)}
        // As in the app: a recorded conversation may no longer exist.
        onOpenHistorySession={(id) => {
          setResult(`History ${id}`);
          return id !== "old-1";
        }}
        onApproval={(id, requestId, decision) => {
          setResult(`${id}:${requestId}:${decision}`);
          setPending((current) => current.filter((notice) => notice.sessionId !== id));
        }}
      />
      <output aria-label="Fixture result">{result}</output>
    </>
  );
}
function ToastScenario() {
  const [visible, setVisible] = useState(["update", "success", "warning", "error"]);
  const dismiss = (id: string) => setVisible((current) => current.filter((item) => item !== id));
  return (
    <>
      {visible.includes("update") ? (
        <Toast
          title="Harness updates available"
          tone="info"
          durationMs={null}
          historyMessage="Claude Code: 2.1.325 → 2.1.326; Grok Build: 1.0.77 → 1.0.88"
          onDismiss={() => dismiss("update")}
        >
          <Text as="p">Claude Code · Updated to 2.1.326</Text>
          <Text as="p">Grok Build · Updating 1.0.77 → 1.0.88</Text>
        </Toast>
      ) : null}
      {visible.includes("success") ? (
        <Toast
          title="Update complete"
          message="Claude Code updated to 2.1.326"
          tone="success"
          durationMs={null}
          onDismiss={() => dismiss("success")}
        />
      ) : null}
      {visible.includes("warning") ? (
        <Toast
          title="Connection interrupted"
          message="Check the connection before retrying."
          tone="warning"
          durationMs={null}
          onDismiss={() => dismiss("warning")}
        />
      ) : null}
      {visible.includes("error") ? (
        <Toast
          title="Update failed"
          message="Grok Build: access denied. Retry in Providers."
          tone="danger"
          durationMs={null}
          onDismiss={() => dismiss("error")}
        />
      ) : null}
      <ToastRegion onRecord={logToastAnnouncement} insets={{ "top-center": 48, "top-end": 48 }} />
    </>
  );
}
// The app resolves durable session owners at boot before any approval can bind;
// the fixture mounts the toasts directly, so it hydrates the same store first.
await flushHostSessionBindings();
createRoot(document.getElementById("root")!).render(
  params.has("owner") ? <OwnerApprovalScenario /> : <Fixture />,
);
