import { useState } from "react";
import PdfViewer from "../../../src/features/files/ui/PdfViewer";
import DocxViewer from "../../../src/features/files/ui/DocxViewer";
import SheetViewer from "../../../src/features/files/ui/SheetViewer";
import { DelimitedFileView } from "../../../src/features/files/ui/DelimitedFileView";
import { DocumentMessage } from "../../../src/features/files/ui/DocumentMessage";
import { CwdPicker } from "../../../src/features/projects/ui/CwdPicker";
import { SearchableProjectPicker } from "../../../src/features/projects/ui/SearchableProjectPicker";
import { ProjectIconPicker } from "../../../src/features/projects/ui/ProjectIconPicker";
import { ProjectQuickActions } from "../../../src/features/projects/ui/ProjectQuickActions";
import { CommitDiff } from "../../../src/features/source-control/ui/CommitDiff";
import { SessionChangesDiff } from "../../../src/features/source-control/ui/SessionChangesDiff";
import { GitConflictCompare } from "../../../src/features/source-control/ui/GitConflictCompare";
import { QuickDeleteWorktreeDialog } from "../../../src/features/source-control/ui/QuickDeleteWorktreeDialog";
import { WorkingTreeDiff } from "../../../src/features/source-control/ui/WorkingTreeDiff";
import { GitHistoryGraph } from "../../../src/features/source-control/ui/GitHistoryGraph";
import { GitChangesPanel } from "../../../src/features/source-control/ui/GitChangesPanel";
import { WorkspaceSourceControl } from "../../../src/features/source-control/ui/WorkspaceSourceControl";
import { UnifiedDiffView } from "../../../src/features/source-control/ui/UnifiedDiffView";

const bytes = new Uint8Array([1, 2, 3]);
const noop = () => {};

/** Actual consumers with deterministic reads paused by the fixture bridge/worker stub. */
export function VisualCaller({ view }: { view: string }) {
  const [icon, setIcon] = useState<string | null>(null);
  const content =
    view === "working-loading" ? (
      <WorkingTreeDiff cwd="/fixture" />
    ) : view === "history-loading" ? (
      <GitHistoryGraph
        cwd="/fixture"
        enabled
        expanded
        onToggleExpanded={noop}
        onOpenCommit={noop}
      />
    ) : view === "changes-loading" ? (
      <GitChangesPanel
        cwd="/fixture"
        enabled
        onOpenFile={noop}
        onOpenAllChanges={noop}
        onOpenCommit={noop}
      />
    ) : view === "unified-empty" ? (
      <UnifiedDiffView files={[]} />
    ) : view === "workspace-error" ? (
      <WorkspaceSourceControl cwd="/fixture" paths={["/fixture"]} enabled onOpen={noop} />
    ) : view === "document-error" ? (
      <DocumentMessage title="Could not read document" error>
        Fixture document is unavailable. Try opening it in the default app.
      </DocumentMessage>
    ) : view === "pdf" ? (
      <PdfViewer bytes={bytes} />
    ) : view === "document-message" ? (
      <DocumentMessage title="This file type is not supported">
        Open it in an external application.
      </DocumentMessage>
    ) : view === "docx" ? (
      <DocxViewer bytes={bytes} />
    ) : view === "sheet" ? (
      <SheetViewer bytes={bytes} />
    ) : view === "delimited" ? (
      <DelimitedFileView path="/fixture/report.csv" cwd="/fixture" active onDirtyChange={noop} />
    ) : view === "cwd" ? (
      <CwdPicker cwd="/fixture" recents={[]} mode="move" onCwdChange={noop} />
    ) : view === "project" ? (
      <SearchableProjectPicker cwd="/fixture" recents={[]} onSelectProject={noop} />
    ) : view === "icon" ? (
      <ProjectIconPicker project="/fixture" name={icon} onPick={setIcon} />
    ) : view === "quick-actions" ? (
      <ProjectQuickActions cwd="/fixture" />
    ) : view === "commit" ? (
      <CommitDiff cwd="/fixture" sha={"a".repeat(40)} />
    ) : view === "session" ? (
      <SessionChangesDiff cwd="/fixture" sessionId="fixture-session" />
    ) : view === "conflict" ? (
      <GitConflictCompare cwd="/fixture" relative="src/example.ts" onClose={noop} />
    ) : view === "delete" ? (
      <QuickDeleteWorktreeDialog
        request={{ cwd: "/fixture", deletePath: "/trees/example" }}
        onRemove={async () => {
          throw new Error("Removal disabled in fixture");
        }}
        onClose={noop}
      />
    ) : null;
  return (
    <main className="bg-background-base text-content" style={{ height: "100vh", padding: 24 }}>
      <section
        data-testid="visual-caller"
        data-view={view}
        style={{
          height: view === "cwd" || view === "project" ? 28 : "100%",
          minHeight: 0,
          ...(view === "cwd" || view === "project" ? { width: 280 } : {}),
        }}
      >
        {content}
      </section>
    </main>
  );
}
