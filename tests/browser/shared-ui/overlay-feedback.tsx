import { Component, useRef, useState, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { BootFailure } from "../../../src/app/shell/BootFailure";
import { DocumentMessage } from "../../../src/features/files/ui/DocumentMessage";
import { FileActionError } from "../../../src/features/files/ui/FileActionError";
import { TaskReviewNotes } from "../../../src/features/tasks/ui/TaskReviewNotes";
import { Alert } from "../../../src/shared/ui/Alert";
import { Badge } from "../../../src/shared/ui/Badge";
import { Button } from "../../../src/shared/ui/Button";
import { EmptyState } from "../../../src/shared/ui/EmptyState";
import { FailureState } from "../../../src/shared/ui/FailureState";
import { Check, Inbox } from "../../../src/shared/ui/icons";
import { UsageMeter } from "../../../src/shared/ui/UsageMeter";
import { Progress } from "../../../src/shared/ui/Progress";
import { RecoveryBoundary } from "../../../src/shared/ui/RecoveryBoundary";
import { Skeleton } from "../../../src/shared/ui/Skeleton";
import { toast, ToastRegion, type ToastOptions } from "../../../src/shared/ui/ToastRegion";
import { TransientNotice } from "../../../src/shared/ui/TransientNotice";
import { WorkingIndicator } from "../../../src/shared/ui/WorkingIndicator";
import "../../../src/styles/index.css";
import "./overlay-feedback.css";

// Memory-only feedback fixture. The clipboard is a recording stub; nothing is sent,
// saved or written. Fixture evidence is not native or installed acceptance.
type Stub = { writes: string[]; mode: "ok" | "fail" };
declare global {
  interface Window {
    __clipboard: Stub;
    __counters: Record<string, number>;
  }
}
window.__clipboard = { writes: [], mode: "ok" };
window.__counters = {};
const count = (name: string) => (window.__counters[name] = (window.__counters[name] ?? 0) + 1);
Object.defineProperty(navigator, "clipboard", {
  configurable: true,
  value: {
    async writeText(text: string) {
      await new Promise((resolve) => setTimeout(resolve, 150));
      if (window.__clipboard.mode === "fail") throw new Error("denied");
      window.__clipboard.writes.push(text);
    },
  },
});

const FULL_DIAGNOSTIC = `HEAD-MARKER ${"Error: could not resolve module graph for /src/features/example.tsx\n".repeat(
  260,
)}TAIL-MARKER`;
const LONG_LABEL = "Aktualisierung erforderlich für alle verbundenen Arbeitsbereiche";
const LONG_COPY =
  "Çok uzun yerelleştirilmiş bir açıklama: bağlantı kurulamadı, sunucu yanıt vermedi ve yeniden deneme sınırı aşıldı. Ayarları denetleyip tekrar deneyin.";
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section
      aria-label={title}
      data-section={id}
      className="mx-auto grid w-full max-w-[1100px] gap-3 p-4"
    >
      <h2 className="text-ui-caption font-medium text-(--ui-text-secondary)">{title}</h2>
      {children}
    </section>
  );
}
const Row = ({ label, children }: { label: string; children: ReactNode }) => (
  <div className="fx-row">
    <span className="text-ui-micro text-(--ui-text-muted)">{label}</span>
    <div className="flex min-w-0 flex-wrap items-center gap-2">{children}</div>
  </div>
);
const Frame = ({
  name,
  height,
  children,
  className = "",
}: {
  name: string;
  height?: number;
  children: ReactNode;
  className?: string;
}) => (
  <div
    data-frame={name}
    className={`relative flex min-w-0 flex-col overflow-hidden rounded-lg border border-stroke bg-(--ui-surface) ${className}`}
    style={height ? { minHeight: height } : undefined}
  >
    {children}
  </div>
);

function StatusSection() {
  const [shown, setShown] = useState(true);
  const [announce, setAnnounce] = useState<null | "success" | "danger">(null);
  return (
    <Section id="status" title="Status grammar">
      <div className="grid gap-2 rounded-lg border border-stroke p-3">
        <Row label="Count">
          <Badge variant="count">3</Badge>
          <Badge variant="count" tone="accent">
            12
          </Badge>
          <Badge variant="count" tone="danger" max={9}>
            {128}
          </Badge>
          <Badge variant="count" size="sm">
            {0}
          </Badge>
        </Row>
        <Row label="Status label">
          <Badge tone="success" icon={<Check />}>
            Passed
          </Badge>
          <Badge tone="warning">Needs review</Badge>
          <Badge tone="danger">Failed</Badge>
          <Badge tone="info" appearance="subtle">
            Syncing
          </Badge>
          <Badge>Draft</Badge>
          <Badge tone="accent">Selected</Badge>
        </Row>
        <Row label="Dot">
          <Badge variant="dot" tone="success">
            Online
          </Badge>
          <Badge variant="dot" tone="warning">
            Degraded
          </Badge>
          <Badge variant="dot" tone="danger" label="Offline" />
        </Row>
        <Row label="Long label">
          <Badge tone="warning" className="max-w-64">
            {LONG_LABEL}
          </Badge>
        </Row>
        <Row label="In a row">
          <div className="flex w-full min-w-0 items-center gap-2 rounded-md border border-stroke px-2 py-1.5 text-ui-secondary">
            <Inbox width={14} height={14} aria-hidden />
            <span className="min-w-0 flex-1 truncate">Inbox</span>
            <Badge variant="dot" tone="danger">
              Failed
            </Badge>
            <Badge variant="count" tone="accent">
              12
            </Badge>
          </div>
        </Row>
      </div>

      <div className="fx-two" data-testid="alerts">
        <Alert tone="info" title="Indexing started">
          Search results stay available while the index rebuilds.
        </Alert>
        <Alert tone="success" title="Settings saved">
          Changes apply to new sessions.
        </Alert>
        <Alert
          tone="warning"
          title="Provider needs attention"
          action={<Button size="sm">Open provider</Button>}
        >
          {LONG_COPY}
        </Alert>
        {shown ? (
          <Alert
            tone="danger"
            title="Could not reach the host"
            action={
              <Button size="sm" onClick={() => count("alert-retry")}>
                Retry
              </Button>
            }
            onDismiss={() => setShown(false)}
          >
            The connection was refused.
          </Alert>
        ) : (
          <Button onClick={() => setShown(true)}>Show host error again</Button>
        )}
        <Alert tone="warning">Title-less alert reads as a single line of copy.</Alert>
        <div className="grid gap-1.5 rounded-md border border-stroke p-3">
          <Alert inline tone="info">
            Inline info
          </Alert>
          <Alert inline tone="success">
            Inline success
          </Alert>
          <Alert inline tone="warning">
            Inline warning
          </Alert>
          <Alert inline tone="danger">
            Inline danger with a longer sentence that wraps inside a narrow row
          </Alert>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-4 rounded-lg border border-stroke p-3">
        <div role="status" data-testid="working-announced" className="flex items-center gap-2">
          <WorkingIndicator />
          <span className="text-ui-secondary">Running checks…</span>
        </div>
        <span
          data-testid="working-decorative"
          className="flex items-center gap-2 text-ui-secondary"
        >
          <WorkingIndicator /> Decorative beside a label
        </span>
        <Button onClick={() => setAnnounce("success")}>Announce success</Button>
        <Button onClick={() => setAnnounce("danger")}>Announce failure</Button>
        {announce ? (
          <Alert inline tone={announce} data-testid="live-result">
            {announce === "success" ? "Copied to clipboard" : "Copy failed. Try again."}
          </Alert>
        ) : null}
      </div>
    </Section>
  );
}

/** Toasts for the corner stack, added one per press so the newest sits in front. */
const STACK_SAMPLES: ToastOptions[] = [
  { tone: "success", title: "Changes saved", message: "Synced to all devices." },
  {
    tone: "info",
    message: "Archived 3 sessions",
    action: { label: "Undo", onClick: () => count("stack-undo") },
  },
  {
    tone: "warning",
    title: "Sync is slow",
    message: "Changes may take a minute to appear on your other devices.",
  },
  {
    tone: "danger",
    title: "Update failed",
    message: "The release feed returned 503. Nothing was changed.",
    action: { label: "Retry", onClick: () => count("stack-retry") },
  },
];
let stackSample = 0;
const addToast = () =>
  toast.show({
    ...STACK_SAMPLES[stackSample++ % STACK_SAMPLES.length],
    durationMs: null,
    onDismiss: () => count("stack-dismiss"),
  });

function NoticesSection() {
  const [pending, setPending] = useState(false);
  const [showFileError, setShowFileError] = useState(false);
  const busy = useRef(false);
  const retry = async () => {
    if (busy.current) return;
    busy.current = true;
    count("notice-retry");
    setPending(true);
    await sleep(700);
    setPending(false);
    busy.current = false;
  };
  const dismiss = (name: string) => () => count(`dismiss-${name}`);
  return (
    <Section id="notices" title="Transient notices">
      <div className="fx-two">
        <Frame name="notice-undo" height={150}>
          <TransientNotice
            anchor="container"
            message="Archived 3 sessions"
            action={{ label: "Undo", onClick: () => count("notice-undo") }}
            durationMs={null}
            onDismiss={dismiss("undo")}
          />
        </Frame>
        <Frame name="notice-danger" height={230}>
          <TransientNotice
            anchor="container"
            tone="danger"
            title="Update failed"
            message="The release feed returned 503. Nothing was changed."
            action={{ label: "Retry", onClick: () => void retry(), pending }}
            durationMs={
              new URLSearchParams(location.search).has("persistent-notice") ? null : undefined
            }
            onDismiss={dismiss("danger")}
          />
        </Frame>
        <Frame name="notice-progress" height={170}>
          <TransientNotice
            anchor="container"
            tone="success"
            title="Exporting transcript"
            message="Preparing files"
            progress={{ value: 0.62, label: "Export progress" }}
            durationMs={null}
            onDismiss={dismiss("progress")}
          />
        </Frame>
        <Frame name="notice-long" height={210}>
          <TransientNotice
            anchor="container"
            tone="warning"
            title={LONG_LABEL}
            message={LONG_COPY}
            durationMs={null}
            onDismiss={dismiss("long")}
          />
        </Frame>
      </div>
      <div className="flex items-center gap-2">
        <Button onClick={() => setShowFileError(true)}>Show file action error</Button>
        <Button onClick={addToast}>Add toast</Button>
        <Button
          onClick={() =>
            toast.show({
              title: "bycoda beklenmedik şekilde kapandı",
              message:
                "Düzeltmemize yardımcı olmak için tanılama günlükleri gönderilsin mi? Günlükler bu bilgisayarda temizlenir ve konuşmalarınızı asla içermez.",
              durationMs: null,
              actionsPlacement: "footer",
              actions: ["Gönder", "Her zaman gönder", "Gönderme"].map((label) => (
                <Button key={label} variant="secondary" onClick={() => count(label)}>
                  {label}
                </Button>
              )),
            })
          }
        >
          Show consent toast
        </Button>
      </div>
      <ToastRegion />
      {showFileError ? (
        <FileActionError
          message="Could not rename the file."
          onDismiss={() => setShowFileError(false)}
        />
      ) : null}
    </Section>
  );
}

function EmptySection() {
  return (
    <Section id="empty" title="Empty states">
      <div className="fx-two">
        <Frame name="empty-page">
          <EmptyState
            title="No projects yet"
            description="Open a folder to start your first session."
            action={<Button variant="primary">Open folder</Button>}
          />
        </Frame>
        <Frame name="empty-panel">
          <EmptyState
            context="panel"
            title="No sessions match"
            description="Clear the filters to see every session."
            action={<Button size="sm">Clear filters</Button>}
          />
        </Frame>
        <Frame name="empty-list">
          <EmptyState context="list" icon={null} description="No review notes yet." />
        </Frame>
        <Frame name="empty-panel-long">
          <EmptyState
            context="panel"
            label="Unavailable"
            title={LONG_LABEL}
            description={LONG_COPY}
          />
        </Frame>
        <Frame name="empty-consumer-task" className="p-3">
          <TaskReviewNotes
            notes={[]}
            busy={false}
            onRead={() => undefined}
            onResolve={() => undefined}
            onOpenReview={() => undefined}
          />
        </Frame>
        <Frame name="empty-consumer-document">
          <DocumentMessage title="This file type is not supported">
            Open it in an external application.
          </DocumentMessage>
        </Frame>
      </div>
    </Section>
  );
}

class Thrower extends Component<{ fail: boolean; children: ReactNode }> {
  render() {
    if (this.props.fail) throw new Error("Rendering exploded in the fixture view");
    return this.props.children;
  }
}

function BoundaryDemo() {
  const [fail, setFail] = useState(false);
  const [key, setKey] = useState(0);
  return (
    <div className="grid content-start gap-2">
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => setFail(true)}>Break the view</Button>
        <Button
          onClick={() => {
            setFail(false);
            setKey((value) => value + 1);
          }}
        >
          Change reset key
        </Button>
      </div>
      <Frame name="boundary" height={300}>
        <RecoveryBoundary resetKeys={[key]} onBack={() => count("boundary-back")}>
          <Thrower fail={fail}>
            <p data-testid="boundary-ok" className="p-4 text-ui-secondary">
              The view is healthy.
            </p>
          </Thrower>
        </RecoveryBoundary>
      </Frame>
    </div>
  );
}

function FailureSection() {
  return (
    <Section id="failure" title="Failure and recovery">
      <div className="fx-two">
        <Frame name="failure-long" height={420}>
          <FailureState
            title="Could not load the workspace"
            description="The workspace is still saved on disk. Try again, or copy the details for support."
            error={new Error(FULL_DIAGNOSTIC)}
            onRetry={() => count("failure-retry-long")}
          />
        </Frame>
        <Frame name="failure-short" height={420}>
          <FailureState
            title="Could not load the workspace"
            description={LONG_COPY}
            error={new Error("Short diagnostic")}
            onRetry={() => count("failure-retry-short")}
            secondaryAction={<Button motion="none">Back to workspace</Button>}
          />
        </Frame>
        <Frame name="failure-pending" height={420}>
          <FailureState
            title="Connection lost"
            description="The host stopped responding."
            error={new Error("ECONNRESET")}
            retryLabel="Reconnect"
            onRetry={async () => {
              count("failure-retry-pending");
              await sleep(900);
            }}
          />
        </Frame>
        <BoundaryDemo />
      </div>
    </Section>
  );
}

function ProgressSection() {
  const [loading, setLoading] = useState(true);
  return (
    <Section id="progress" title="Progress and placeholders">
      <div className="fx-two">
        <div className="grid gap-3 rounded-lg border border-stroke p-3" data-testid="progress-list">
          <Progress label="Unknown duration" />
          <Progress label="Not started" value={0} showValue />
          <Progress label="Downloading" value={42} showValue />
          <Progress label="Almost there" value={99.6} showValue />
          <Progress label="Finished" value={100} showValue tone="success" />
          <UsageMeter
            compact
            showLegend={false}
            showRemaining
            label="Quota remaining"
            segments={[{ id: "used", label: "Used", value: 82 }]}
            limit={100}
            unit="%"
            valueText="18% remaining"
            tone="warning"
          />
          <UsageMeter
            compact
            showLegend={false}
            showRemaining
            label="Weekly remaining"
            segments={[{ id: "used", label: "Used", value: 36 }]}
            limit={100}
            unit="%"
            valueText="64% left"
          />
          <Progress compact aria-label="Compact" value={30} />
        </div>
        <div className="grid gap-3 rounded-lg border border-stroke p-3" data-testid="skeleton-list">
          <Skeleton label="Loading sessions" avatar lines={3} />
          <div className="flex items-center gap-2">
            <Button onClick={() => setLoading((value) => !value)}>Toggle loading</Button>
            <WorkingIndicator>Thinking about it…</WorkingIndicator>
          </div>
          <Skeleton label="Loading records" loading={loading}>
            <ul className="grid gap-1 text-ui-secondary" data-testid="skeleton-content">
              <li>Record one</li>
              <li>Record two</li>
              <li>Record three</li>
            </ul>
          </Skeleton>
          <Skeleton aria-hidden lines={2} />
        </div>
      </div>
    </Section>
  );
}

function Fixture() {
  const params = new URLSearchParams(location.search);
  if (params.get("view") === "boot")
    return <BootFailure error={new Error(FULL_DIAGNOSTIC)} onRetry={() => count("boot-retry")} />;
  return (
    <main className="min-h-screen bg-(--ui-surface) text-(--color-content)">
      <StatusSection />
      <NoticesSection />
      <EmptySection />
      <FailureSection />
      <ProgressSection />
    </main>
  );
}

const params = new URLSearchParams(location.search);
document.documentElement.classList.toggle("theme-light", params.get("theme") === "light");
if (params.get("motion") === "off") document.documentElement.dataset.decorativeMotion = "off";
createRoot(document.getElementById("root")!).render(<Fixture />);
