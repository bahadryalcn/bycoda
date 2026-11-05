import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  RemoteConnectionFeedbackProvider,
  RemoteConnectionNotices,
} from "../../src/features/connections/ui/RemoteConnectionFeedback";
import { RemoteLoadError } from "../../src/features/connections/ui/RemoteLoadError";
import { RemoteConnectionBanner } from "../../src/features/connections/ui/RemoteConnectionBanner";
import { RemoteDataStatus } from "../../src/features/connections/ui/RemoteDataStatus";
import { CrewSessions } from "../../src/features/crews/ui/CrewSessions";
import {
  notifyRemoteRecovered,
  reportRemoteLoad,
  recordRemoteConnection,
} from "../../src/features/connections/model/remoteHealth";
import { remotePath } from "../../src/features/connections/model/remoteProjects";
import { classifyRemoteError } from "../../src/features/connections/model/remoteFailure";
import { Button } from "../../src/shared/ui/Button";
import { TextareaField } from "../../src/shared/ui/TextareaField";
import { languageReady } from "../../src/shared/i18n";
import "../../src/styles/index.css";

declare global {
  interface Window {
    fixtureConnectionDown?: boolean;
  }
}
const params = new URLSearchParams(location.search);
document.documentElement.classList.toggle("theme-light", params.get("theme") === "light");
const cwd = remotePath("fixture-env", "/Users/demo/project");
const offline = "RPC_CONNECTION_INTERRUPTED: Host connection interrupted";
type Mode = "connected" | "offline" | "auth" | "service";
const initialMode = (params.get("state") ?? "offline") as Mode;
window.fixtureConnectionDown = initialMode === "offline" || initialMode === "auth";

function Fixture() {
  const [mode, setMode] = useState<Mode>(initialMode);
  const [draft, setDraft] = useState("Bağlantı kesilse de bu taslak korunur.");
  const error =
    mode === "offline"
      ? offline
      : mode === "auth"
        ? "RPC_WS_BLOCKED: Host authentication was refused"
        : undefined;
  useEffect(() => {
    window.fixtureConnectionDown = !!error;
    if (error) {
      reportRemoteLoad(cwd, "fixture", error);
      recordRemoteConnection("fixture-env", error);
    } else {
      reportRemoteLoad(cwd, "fixture");
      notifyRemoteRecovered("fixture-env");
    }
  }, [error]);
  const dataState = error
    ? { phase: "error" as const, error, updatedAt: 1793720000000 }
    : { phase: "ready" as const, updatedAt: 1793720000000 };
  const panelError = error ? (
    <RemoteLoadError cwd={cwd} failure={classifyRemoteError(error)} stale />
  ) : null;
  const crewError = error ?? (mode === "service" ? "Crew storage is unavailable" : undefined);
  return (
    <RemoteConnectionFeedbackProvider>
      <main
        style={{ display: "flex", minHeight: "100vh", flexDirection: "column" }}
        className="bg-background-base text-content"
      >
        <header className="flex flex-wrap items-center gap-2 p-3">
          <span className="me-auto text-ui-caption text-(--ui-text-muted)">
            Bağlantı davranışı · izole fixture
          </span>
          <Button size="sm" variant="secondary" onClick={() => setMode("connected")}>
            Bağlı
          </Button>
          <Button size="sm" variant="secondary" onClick={() => setMode("offline")}>
            Kesinti
          </Button>
          <Button size="sm" variant="secondary" onClick={() => setMode("auth")}>
            Yetki hatası
          </Button>
          <Button size="sm" variant="secondary" onClick={() => setMode("service")}>
            Crew hatası
          </Button>
        </header>
        <RemoteConnectionNotices />
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "minmax(210px,0.7fr) minmax(0,2fr)",
            flex: 1,
            minHeight: 0,
            gap: 12,
            padding: 12,
          }}
        >
          <aside className="flex min-w-0 flex-col gap-5 rounded-lg bg-(--ui-surface) p-3">
            <section>
              <h2 className="mb-2 font-medium">Oturumlar</h2>
              <RemoteDataStatus cwd={cwd} state={dataState} label="oturumlar" />
              <p className="mt-3 text-ui-caption">Uzak proje çalışması</p>
              <p className="mt-2 text-ui-caption text-(--ui-text-muted)">Son yüklenen konuşma</p>
            </section>
            <CrewSessions
              cwd={cwd}
              state={
                {
                  data: undefined,
                  error: crewError ? new Error(crewError) : undefined,
                  refetch: async () => {},
                } as never
              }
            />
            <section>
              <h2 className="mb-2 font-medium">Dosyalar</h2>
              {panelError}
              <p className="text-ui-caption">src / app.tsx</p>
              <p className="mt-2 text-ui-caption">README.md</p>
            </section>
            <section>
              <h2 className="mb-2 font-medium">Git değişiklikleri</h2>
              {panelError}
              <p className="text-ui-caption">app.tsx · M</p>
            </section>
            <section>
              <h2 className="mb-2 font-medium">Git geçmişi</h2>
              {panelError}
              <p className="text-ui-caption text-(--ui-text-muted)">Son yüklenen commit</p>
            </section>
          </aside>
          <section className="flex min-w-0 flex-col rounded-lg bg-(--ui-surface) p-4">
            <header className="mb-5 flex items-center justify-between">
              <h1 className="font-medium">Uzak proje · tailm</h1>
              <RemoteDataStatus cwd={cwd} state={dataState} presentation="indicator" />
            </header>
            <RemoteConnectionBanner cwd={cwd} stale />
            <RemoteDataStatus cwd={cwd} state={dataState} presentation="notice" />
            <p className="mb-4 leading-relaxed">
              Önceden yüklenen konuşma, dosyalar ve değişiklikler bağlantı yenilenirken görünür
              kalır.
            </p>
            <p className="mb-auto text-ui-caption text-(--ui-text-muted)">
              Gerçek işlem hataları ve belirsiz sonuçlar kendi işleminin yanında kalır.
            </p>
            <TextareaField
              aria-label="Mesaj taslağı"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              className="mt-8"
            />
          </section>
        </div>
      </main>
    </RemoteConnectionFeedbackProvider>
  );
}
await languageReady;
createRoot(document.getElementById("root")!).render(<Fixture />);
