import { useState, type ComponentProps } from "react";
import { createRoot } from "react-dom/client";
import { mockIPC, mockWindows } from "@tauri-apps/api/mocks";
import { ApprovalToasts } from "../../src/features/sessions/ui/ApprovalToasts";
import { NOTIFICATION_HISTORY_KEY } from "../../src/features/notifications/model/notificationHistory";
import { rememberNotificationProjects } from "../../src/features/notifications/model/notificationProjects";
import { applyThemePreference } from "../../src/features/settings/model/appearance";
import { setLanguagePreference } from "../../src/shared/i18n";
import "../../src/styles/index.css";

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
const cwd = "G:/Projects/my_projects/monocode";
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
    blocks: [],
  },
}));
if (!localStorage.getItem(NOTIFICATION_HISTORY_KEY)) {
  localStorage.setItem(
    NOTIFICATION_HISTORY_KEY,
    JSON.stringify(
      Array.from({ length: 30 }, (_, index) => ({
        key: `history-${index}`,
        sessionId: `old-${index}`,
        cwd,
        title: `codex · ${titles[index % titles.length]}`,
        label: index === 2 ? "long_unbroken_value_".repeat(80) : label,
        kind: index % 2 ? "approval" : "question",
        occurredAt: Date.UTC(2026, 9, 18, 1, 27) - index * 3600000,
      })),
    ),
  );
}
function Fixture() {
  const [pending, setPending] = useState(params.has("empty") ? [] : notices);
  const [result, setResult] = useState("");
  return (
    <>
      <ApprovalToasts
        notices={pending}
        popupNotices={[]}
        onFocusSession={(id) => setResult(`Opened ${id}`)}
        onApproval={(id, requestId, decision) => {
          setResult(`${id}:${requestId}:${decision}`);
          setPending((current) => current.filter((notice) => notice.sessionId !== id));
        }}
      />
      <output aria-label="Fixture result">{result}</output>
    </>
  );
}
createRoot(document.getElementById("root")!).render(<Fixture />);
