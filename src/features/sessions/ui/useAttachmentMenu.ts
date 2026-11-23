import { copyAttachmentImage, copyText } from "../../../platform/tauri/clipboard";
import { useT } from "../../../shared/i18n";
import { errorText } from "../../../shared/lib/errors";
import { displayPath, pathKey } from "../../../shared/lib/paths";
import type { ContextMenuActions } from "../../../shared/ui/ContextMenu";
import { toast } from "../../../shared/ui/ToastRegion";
import { parseRemotePath } from "../../connections/public/remoteProjects";
import type { Attachment } from "../model/session";
import { ownedAttachmentPath, useSaveAttachmentCopy } from "./AttachmentFilePreview";

export function useAttachmentMenu(attachment: Attachment, projectRoot?: string) {
  const t = useT();
  const saveCopy = useSaveAttachmentCopy(attachment);
  const ownedPath = ownedAttachmentPath(attachment);
  const fullPath = ownedPath && (parseRemotePath(ownedPath)?.hostPath ?? ownedPath);
  const relativePath =
    ownedPath && projectRoot && pathKey(ownedPath).startsWith(`${pathKey(projectRoot)}/`)
      ? displayPath(ownedPath, projectRoot)
      : undefined;
  const image = attachment.kind === "image";
  const actions: ContextMenuActions = {
    items: [
      { kind: "item", id: "copy-path", label: t("Copy full path"), disabled: !fullPath },
      {
        kind: "item",
        id: "copy-relative-path",
        label: t("Copy relative path"),
        disabled: !relativePath,
      },
      {
        kind: "item",
        id: "save",
        label: image ? t("Save image") : t("Save file"),
        disabled: !saveCopy.canSave || saveCopy.saving,
      },
      ...(image
        ? [
            {
              kind: "item" as const,
              id: "copy-image",
              label: t("Copy image"),
              disabled: !saveCopy.canSave,
            },
          ]
        : []),
    ],
    onPick: (id) => {
      if (id === "save") {
        saveCopy.save();
        return;
      }
      const path = id === "copy-relative-path" ? relativePath : fullPath;
      const copy = id === "copy-image" ? copyAttachmentImage(attachment) : path && copyText(path);
      if (copy) {
        void copy.then(
          () => toast.show({ tone: "success", message: t("Copied") }),
          (error: unknown) =>
            toast.show({
              tone: "danger",
              message: t("Copy failed. {p0}", { p0: errorText(error) }),
            }),
        );
      }
    },
  };
  return { actions, saveCopy };
}
