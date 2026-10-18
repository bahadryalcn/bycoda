import {
  evaluatePreviewSearch,
  type PreviewSearchOptions,
  type PreviewTextResult,
} from "./previewSearchEvaluation";

export const PREVIEW_REGEX_DEADLINE_MS = 200;

/** Each request owns a worker. Cancellation and the deadline terminate native regex work. */
export function startPreviewSearch(texts: string[], query: string, options: PreviewSearchOptions) {
  if (!options.regexp)
    return { result: Promise.resolve(evaluatePreviewSearch(texts, query, options)), cancel() {} };
  let worker: Worker | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let resolveResult!: (value: PreviewTextResult) => void;
  let settled = false;
  const result = new Promise<PreviewTextResult>((resolve) => {
    resolveResult = resolve;
  });
  const finish = (value: PreviewTextResult) => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    worker?.terminate();
    resolveResult(value);
  };
  const unavailable: PreviewTextResult = {
    matches: [],
    capped: false,
    invalid: false,
    timedOut: true,
  };
  try {
    worker = new Worker(new URL("./previewRegex.worker.ts", import.meta.url), { type: "module" });
    worker.onmessage = (event: MessageEvent<PreviewTextResult>) => finish(event.data);
    worker.onerror = () => finish(unavailable);
    timer = setTimeout(() => finish(unavailable), PREVIEW_REGEX_DEADLINE_MS);
    worker.postMessage([texts, query, options]);
  } catch {
    finish(unavailable);
  }
  return { result, cancel: () => finish(unavailable) };
}
