import { useEffect, useMemo, useRef, useState } from "react";
import type { ProjectFile } from "../../../platform/tauri/fs";
import { rankProjectFiles, type RankedFile } from "../model/fileIndex";
import type { FileRankingMessage } from "../model/fileRanking.worker";

const EMPTY: RankedFile[] = [];
type Request = {
  cwd: string;
  files: ProjectFile[];
  query: string;
  recents: string[];
  limit?: number;
};

export function useFileRanking(
  enabled: boolean,
  cwd: string,
  files: ProjectFile[],
  query: string,
  recents: string[],
  { limit, backgroundQuery = query }: { limit?: number; backgroundQuery?: string } = {},
) {
  const [failed, setFailed] = useState(false);
  const background = enabled && files.length >= 1000 && typeof Worker !== "undefined" && !failed;
  const request = useMemo(
    () => ({ cwd, files, query: backgroundQuery, recents, limit }),
    [cwd, files, backgroundQuery, recents, limit],
  );
  const submit = useRef<((next: Request) => void) | null>(null);
  const [answer, setAnswer] = useState<{ request: Request; results: RankedFile[] } | null>(null);

  // oxlint-disable-next-line bycoda/effect-names-its-sync -- Own the ranking worker for this listing and terminate it on close or project change.
  useEffect(() => {
    if (!background) return;
    let worker: Worker;
    try {
      worker = new Worker(new URL("../model/fileRanking.worker.ts", import.meta.url), {
        type: "module",
        name: "file-ranking",
      });
    } catch {
      setFailed(true);
      return;
    }
    let current: Request | null = null;
    let latest: Request | null = null;
    let sentFiles = false;
    const run = (next: Request) => {
      if (current) {
        latest = next;
        return;
      }
      current = next;
      try {
        worker.postMessage({
          query: next.query,
          recents: next.recents,
          limit: next.limit,
          files: sentFiles ? undefined : files,
        } satisfies FileRankingMessage);
        sentFiles = true;
      } catch {
        setFailed(true);
      }
    };
    worker.onerror = worker.onmessageerror = () => setFailed(true);
    worker.onmessage = ({ data }: MessageEvent<RankedFile[]>) => {
      const done = current;
      current = null;
      if (latest) {
        const next = latest;
        latest = null;
        run(next);
      } else if (done) {
        setAnswer({ request: done, results: data });
      }
    };
    submit.current = run;
    return () => {
      submit.current = null;
      worker.onmessage = worker.onerror = worker.onmessageerror = null;
      worker.terminate();
    };
  }, [background, cwd, files]);

  // oxlint-disable-next-line bycoda/effect-names-its-sync -- Send the latest query to the active ranking worker as input changes.
  useEffect(() => {
    if (background) submit.current?.(request);
  }, [background, request]);

  const local = useMemo(
    () => (enabled && !background ? rankProjectFiles(files, query, recents, limit) : EMPTY),
    [enabled, background, files, query, recents, limit],
  );
  if (!background) return { results: local, pending: false };
  return {
    results:
      answer?.request.files === files &&
      answer.request.cwd === cwd &&
      answer.request.recents === recents &&
      answer.request.limit === limit
        ? answer.results
        : EMPTY,
    pending: answer?.request !== request,
  };
}
