import { execFile } from "node:child_process";

const SAMPLE_DEADLINE_MS = 3_000;

/** One bounded OS query for resident memory of the given pids. Failures yield an empty map. */
export function readRssBytes(pids: number[]): Promise<Map<number, number>> {
  const sizes = new Map<number, number>();
  if (!pids.length) return Promise.resolve(sizes);
  const win = process.platform === "win32";
  const [command, args] = win
    ? ["tasklist", ["/FO", "CSV", "/NH"]]
    : ["ps", ["-o", "pid=,rss=", "-p", pids.join(",")]];
  return new Promise((resolve) => {
    execFile(
      command,
      args,
      {
        windowsHide: true,
        timeout: SAMPLE_DEADLINE_MS,
        encoding: "utf8",
        maxBuffer: 8 * 1024 * 1024,
      },
      (error, stdout) => {
        if (error) return resolve(sizes);
        const wanted = new Set(pids);
        for (const line of stdout.split(/\r?\n/)) {
          if (win) {
            const fields = line.split('","').map((field) => field.replace(/^"|"$/g, ""));
            const pid = Number(fields[1]);
            const kilobytes = Number(String(fields[4] ?? "").replace(/[^0-9]/g, ""));
            if (wanted.has(pid) && Number.isFinite(kilobytes)) sizes.set(pid, kilobytes * 1024);
          } else {
            const [pid, rss] = line.trim().split(/\s+/).map(Number);
            if (wanted.has(pid) && Number.isFinite(rss)) sizes.set(pid, rss * 1024);
          }
        }
        resolve(sizes);
      },
    );
  });
}
