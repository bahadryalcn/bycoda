import { invoke } from "@tauri-apps/api/core";
import type { Attachment, QueuedMessage } from "../../sessions/model/session";

const saved = new WeakMap<Attachment, Promise<string>>();
const needsPath = (file: Attachment) =>
  !!file.data && !file.path?.trim() && !file.hostEnvironmentId;

export const hasInlineQueueAttachments = (messages: QueuedMessage[] | undefined): boolean =>
  !!messages?.some((row) => row.attachments.some(needsPath));

/** Old queues may predate blob admission through write_attachment. Keep their bytes
 * out of the quota-limited WebView cache, using the ordinary native attachment route.
 * Never discard the original data or transfer a foreign Host's attachment locally.
 */
export async function storeInlineQueueAttachments(
  messages: QueuedMessage[],
): Promise<QueuedMessage[]> {
  const result: QueuedMessage[] = [];
  for (const row of messages) {
    const attachments: Attachment[] = [];
    for (const file of row.attachments) {
      if (!needsPath(file)) {
        attachments.push(file);
        continue;
      }
      let pending = saved.get(file);
      if (!pending) {
        pending = invoke<string>("write_attachment", { name: file.name, data: file.data }).then(
          (path) => {
            if (typeof path !== "string" || !path.trim())
              throw new Error(`Could not save attachment ${JSON.stringify(file.name)}.`);
            return path;
          },
        );
        saved.set(file, pending);
        void pending.catch(() => saved.delete(file));
      }
      attachments.push({ ...file, path: await pending });
    }
    result.push({ ...row, attachments });
  }
  return result;
}
