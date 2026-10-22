import { statFiles } from "../../../platform/tauri/fs";

// Ambiguous inline spans such as `src/components` need an existence check so
// protocol methods such as `currentTime/read` keep their ordinary code styling.
// Collect all spans rendered in one frame into one metadata request.
let pending = new Map<string, ((exists: boolean) => void)[]>();
const results = new Map<string, { exists: boolean; until: number }>();
const inFlight = new Map<string, Promise<boolean>>();
export function existingChatPath(path: string): Promise<boolean> {
  const cached = results.get(path);
  if (cached && cached.until > Date.now()) return Promise.resolve(cached.exists);
  const reading = inFlight.get(path);
  if (reading) return reading;
  const request = new Promise<boolean>((resolve) => {
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
        const existing = new Set(
          (infos ?? [])
            .filter((info) => info.isDir || info.mtimeMs != null)
            .map((info) => info.path),
        );
        for (const path of chunk) {
          inFlight.delete(path);
          if (infos) {
            if (results.size >= 1000) results.delete(results.keys().next().value!);
            results.set(path, { exists: existing.has(path), until: Date.now() + 5000 });
          }
          for (const resolve of batch.get(path) ?? []) resolve(existing.has(path));
        }
      }
    });
  });
  inFlight.set(path, request);
  return request;
}
