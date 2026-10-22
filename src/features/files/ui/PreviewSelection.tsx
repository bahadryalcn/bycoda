import { useEffect, useState, type ReactNode } from "react";
import { useTranscriptSelection } from "../../sessions/hooks/useTranscriptSelection";
import { requestAddToChat } from "../../sessions/model/quoteDraft";
import type { TranscriptSelection } from "../../sessions/model/transcriptSelection";
import { TranscriptSelectionMenu } from "../../sessions/ui/TranscriptSelectionMenu";

export function PreviewSelectionMenu({
  selection,
  path,
  onDismiss,
}: {
  selection: TranscriptSelection | null;
  path: string;
  onDismiss: () => void;
}) {
  return (
    <TranscriptSelectionMenu
      selection={selection}
      onDismiss={onDismiss}
      onAddToChat={(text) => requestAddToChat(`@${path}\n\n${text}`, "quote")}
    />
  );
}

export function PreviewSelection({
  children,
  active,
  path,
  contentVersion,
}: {
  children: ReactNode;
  active: boolean;
  path: string;
  contentVersion: string;
}) {
  const [root, setRoot] = useState<HTMLDivElement | null>(null);
  const { selection, dismissSelection } = useTranscriptSelection(root, active);
  useEffect(dismissSelection, [contentVersion, path, dismissSelection]);
  return (
    <div ref={setRoot} className="h-full min-h-0" data-selectable-agent-response={path}>
      {children}
      <PreviewSelectionMenu
        selection={active ? selection : null}
        path={path}
        onDismiss={dismissSelection}
      />
    </div>
  );
}
