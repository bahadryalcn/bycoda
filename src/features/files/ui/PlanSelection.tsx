import { useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { createNote, noteTitle } from "../../notes";
import { loadNotesEnabled, subscribeNotesEnabled } from "../../settings/public/settings";
import { useTranscriptSelection } from "../../sessions/public/useTranscriptSelection";
import { requestAddToChat } from "../../sessions/public/quoteDraft";
import { TranscriptSelectionMenu } from "../../sessions/public/TranscriptSelectionMenu";

export function PlanSelection({
  children,
  active,
  blockId,
  text,
  sessionId,
  cwd,
}: {
  children: ReactNode;
  active: boolean;
  blockId: string;
  text: string;
  sessionId: string;
  cwd: string;
}) {
  const [root, setRoot] = useState<HTMLDivElement | null>(null);
  const { selection, dismissSelection } = useTranscriptSelection(root, active);
  const notesEnabled = useSyncExternalStore(subscribeNotesEnabled, loadNotesEnabled, () => true);
  useEffect(dismissSelection, [text, blockId, sessionId, dismissSelection]);

  return (
    <div ref={setRoot} className="h-full min-h-0" data-selectable-agent-response={blockId}>
      {children}
      <TranscriptSelectionMenu
        selection={active ? selection : null}
        onDismiss={dismissSelection}
        onAddToChat={(selected) => requestAddToChat(selected, "quote")}
        onAddToNotes={
          notesEnabled
            ? async (selected) => {
                await createNote({
                  title: noteTitle(selected),
                  body: selected,
                  sourceSessionId: sessionId,
                  sourceCwd: cwd,
                });
              }
            : undefined
        }
      />
    </div>
  );
}
