import { invoke } from "@tauri-apps/api/core";
import { t } from "../../../shared/i18n";
import type { Attachment } from "./session";
import { MAX_ATTACHMENTS, persistableAttachment } from "./attachments";

/** Question protocols carry text: every file must have a durable readable path. */
export async function prepareQuestionAttachments(files: Attachment[]): Promise<Attachment[]> {
  if (files.length > MAX_ATTACHMENTS) throw new Error(t("Too many attachments"));
  return Promise.all(
    files.map(async (file) => {
      let path = file.path;
      if (!path?.trim()) {
        if (!file.data)
          throw new Error(t("Cannot attach {p0}: no file data is available.", { p0: file.name }));
        path = await invoke<string>("write_attachment", { name: file.name, data: file.data });
      }
      if (!path?.trim()) throw new Error(t("Could not save attachment {p0}.", { p0: file.name }));
      return {
        ...persistableAttachment({ ...file, path }),
        ...(file.hostEnvironmentId ? { hostEnvironmentId: file.hostEnvironmentId } : {}),
      };
    }),
  );
}
