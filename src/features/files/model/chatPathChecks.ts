import { statFiles } from "../../../platform/tauri/fs";

// Ambiguous inline spans such as `src/components` need an existence check so
// protocol methods such as `currentTime/read` keep their ordinary code styling.
// Collect all spans rendered in one frame into one metadata request.
export type ChatPathInfo = { exists: boolean; isDir: boolean };
const MISSING: ChatPathInfo = { exists: false, isDir: false };
let pending = new Map<string, ((info: ChatPathInfo) => void)[]>();
const results = new Map<string, { info: ChatPathInfo; until: number }>();
const inFlight = new Map<string, Promise<ChatPathInfo>>();
export function existingChatPath(path: string): Promise<boolean> {
  return chatPathInfo(path).then((info) => info.exists);
}
/** Whether the path exists and is a folder; same batching and short cache as `existingChatPath`. */
export function chatPathInfo(path: string): Promise<ChatPathInfo> {
  const cached = results.get(path);
  if (cached && cached.until > Date.now()) return Promise.resolve(cached.info);
  const reading = inFlight.get(path);
  if (reading) return reading;
  const request = new Promise<ChatPathInfo>((resolve) => {
    const scheduled = pending.size > 0;
    const listeners = pending.get(path) ?? [];
    listeners.push(resolve);
    pending.set(path, listeners);
    if (scheduled) return;
    queueMicrotask(async () => {
      const batch = pending;
      pending = new Map();
      const paths = [...batch.keys()];
      for (let offset = 0; offset < paths.length; offset += 200) {
        const chunk = paths.slice(offset, offset + 200);
        const infos = await statFiles(chunk).catch(() => null);
        const found = new Map<string, ChatPathInfo>(
          (infos ?? [])
            .filter((info) => info.isDir || info.mtimeMs != null)
            .map((info) => [info.path, { exists: true, isDir: !!info.isDir }]),
        );
        for (const path of chunk) {
          inFlight.delete(path);
          if (infos) {
            if (results.size >= 1000) results.delete(results.keys().next().value!);
            results.set(path, { info: found.get(path) ?? MISSING, until: Date.now() + 5000 });
          }
          for (const resolve of batch.get(path) ?? []) resolve(found.get(path) ?? MISSING);
        }
      }
    });
  });
  inFlight.set(path, request);
  return request;
}
