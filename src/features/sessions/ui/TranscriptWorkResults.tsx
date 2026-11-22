import type { ReactNode } from "react";
import { useT } from "../../../shared/i18n";
import { Button } from "../../../shared/ui/Button";
import { Disclosure } from "../../../shared/ui/Disclosure";
import { Text } from "../../../shared/ui/Text";
import { bycodaToolCall } from "../model/bycodaToolCall";
import { useToolCallDisplay } from "../model/reactiveReads";
import type { Block } from "../model/session";
import {
  isAdvisorBlock,
  isHiddenTool,
  isSubagentBlock,
  needsApproval,
  toolCallLabel,
} from "../model/transcriptActivity";
import { SessionWorkResultList } from "./SessionWorkSummary";
import { hasToolInspection, ToolInspectionPanel } from "./ToolInspectionPanel";
import { useRetainedDisclosure } from "./useRetainedDisclosure";

type Props = {
  turnId: string;
  turn: readonly Block[];
  cwd?: string;
  onOpenFile?: (path: string) => void;
  onOpenDiff?: (path: string) => void;
  renderRemoteLoad?: (block: Block) => ReactNode;
};

function isTranscriptResult(block: Block): boolean {
  return (
    block.role === "tool" &&
    !block.internal &&
    !block.draft &&
    !block.inlineVisual &&
    (hasToolInspection(block) || !!block.remoteContent) &&
    !isHiddenTool(block) &&
    !isAdvisorBlock(block) &&
    !isSubagentBlock(block) &&
    !needsApproval(block) &&
    // The dedicated app call row intentionally presents a scoped summary of these calls.
    !bycodaToolCall(block)
  );
}

/** One disclosure for the retained evidence of a settled turn, beside its reply. */
export function TranscriptWorkResults({ turnId, turn, ...targets }: Props) {
  const t = useT();
  const [open, setOpen] = useRetainedDisclosure<boolean>(`turn-results:${turnId}`, false);
  const results = turn.filter(isTranscriptResult);
  if (!results.length) return null;
  return (
    <div className="min-w-0 px-4 pb-2" data-transcript-work-results>
      <Disclosure
        variant="row"
        summary={t("Results")}
        count={results.length}
        open={open}
        onOpenChange={setOpen}
      >
        {open ? (
          <SessionWorkResultList
            tools={results}
            busy={false}
            renderSelected={(block) => (
              <TranscriptWorkResultDetail key={block.id} {...targets} block={block} />
            )}
          />
        ) : null}
      </Disclosure>
    </div>
  );
}

function TranscriptWorkResultDetail({
  block,
  cwd,
  onOpenFile,
  onOpenDiff,
  renderRemoteLoad,
}: Omit<Props, "turnId" | "turn"> & { block: Block }) {
  const t = useT();
  const { action, filePath, isFile, previewMatchesFile } = useToolCallDisplay(
    toolCallLabel(block, cwd),
    block.tool?.preview,
    cwd,
  );
  const edit = action === "Edit" || action === "Write";
  const openDiff = edit && previewMatchesFile ? onOpenDiff : undefined;
  const openFile = openDiff ?? onOpenFile;
  return (
    <>
      {block.remoteContent ? (
        <>
          <Text tone="secondary">{t("Only a summary of this output is kept here.")}</Text>
          {renderRemoteLoad?.(block)}
        </>
      ) : null}
      {hasToolInspection(block) ? <ToolInspectionPanel block={block} /> : null}
      {isFile && filePath && openFile && (!edit || previewMatchesFile) ? (
        <div className="flex justify-end">
          <Button onClick={() => openFile(filePath)}>
            {t(openDiff ? "Open changes" : "Open in editor")}
          </Button>
        </div>
      ) : null}
    </>
  );
}
