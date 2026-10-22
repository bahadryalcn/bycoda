import { message } from "@tauri-apps/plugin-dialog";
import { appName } from "../../../shared/lib/appName";
import { t } from "../../../shared/i18n/technical";

export interface ClosingEditor {
  path: string;
  dirty: () => boolean;
  settle: () => Promise<void>;
  save: () => Promise<boolean>;
}

const editors = new Set<ClosingEditor>();

/** Window-local registry; hidden file panes remain mounted and participate. */
export function registerClosingEditor(editor: ClosingEditor): () => void {
  editors.add(editor);
  return () => {
    editors.delete(editor);
  };
}

export async function prepareEditorsToClose(): Promise<boolean> {
  await Promise.all([...editors].map((editor) => editor.settle()));
  const dirty = [...editors].filter((editor) => editor.dirty());
  if (dirty.length === 0) return true;
  const saveLabel = t("Save");
  const discardLabel = t("Discard");
  const choice = await message(
    t("Save changes before closing?\n\n{p0}", {
      p0: dirty.map((editor) => editor.path).join("\n"),
    }),
    {
      title: appName(),
      kind: "warning",
      buttons: { yes: saveLabel, no: discardLabel, cancel: t("Cancel") },
    },
  );
  if (choice === discardLabel) return true;
  if (choice !== saveLabel) return false;
  for (const editor of dirty) {
    if (!(await editor.save()) || editor.dirty()) {
      throw new Error(
        t("Could not save {p0}. Your changes are still open. Retry closing to save again.", {
          p0: editor.path,
        }),
      );
    }
  }
  // Edits made while a different document was saving must also remain open.
  return ![...editors].some((editor) => editor.dirty());
}
