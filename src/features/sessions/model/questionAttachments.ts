import { invoke } from "@tauri-apps/api/core";
import type { Attachment } from "./session";
import { MAX_ATTACHMENTS, persistableAttachment } from "./attachments";

/** Question protocols carry text: every file must have a durable readable path. */
export async function prepareQuestionAttachments(files: Attachment[]): Promise<Attachment[]> {
  if (files.length > MAX_ATTACHMENTS) throw new Error("Too many attachments");
  return Promise.all(
    files.map(async (file) => {
      let path = file.path;
      if (!path?.trim()) {
        if (!file.data)
          throw new Error(`Cannot attach ${JSON.stringify(file.name)}: no file data is available.`);
        path = await invoke<string>("write_attachment", { name: file.name, data: file.data });
      }
      if (!path?.trim()) throw new Error(`Could not save attachment ${JSON.stringify(file.name)}.`);
      return {
        ...persistableAttachment({ ...file, path }),
        ...(file.hostEnvironmentId ? { hostEnvironmentId: file.hostEnvironmentId } : {}),
      };
    }),
  );
}
