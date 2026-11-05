import { useEffect, useState, type ReactNode } from "react";
import { useTranscriptSelection } from "../../sessions/public/useTranscriptSelection";
import { requestAddToChat } from "../../sessions/public/quoteDraft";
import type { TranscriptSelection } from "../../sessions";
import { TranscriptSelectionMenu } from "../../sessions/public/TranscriptSelectionMenu";

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
    <div ref={setRoot} className="h-full min-h-0 min-w-0" data-selectable-agent-response={path}>
      {children}
      <PreviewSelectionMenu
        selection={active ? selection : null}
        path={path}
        onDismiss={dismissSelection}
      />
    </div>
  );
}
