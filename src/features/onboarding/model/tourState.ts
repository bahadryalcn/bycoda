/** Which guided tour runs: the first-run walkthrough or the short "What's new" highlights. */
export type TourKind = "first-run" | "whats-new";

/**
 * What happened to the first-run tour. No record means the user was never offered it.
 * - `completed`: reached Done.
 * - `skipped`: chose Skip tour (or the close button).
 * - `later`: dismissed the welcome offer; it is not offered again, the entries stay.
 * - `paused`: left with Esc part-way; `step` is where to resume.
 */
export type TourStatus = "completed" | "skipped" | "later" | "paused";

export type TourRecord = { status: TourStatus; step?: string; at: number };

const KEY = "bycoda.tour.v1";
export const START_TOUR_EVENT = "bycoda:start-tour";

const STATUSES: ReadonlySet<string> = new Set<TourStatus>([
  "completed",
  "skipped",
  "later",
  "paused",
]);
const listeners = new Set<() => void>();
/** Keeps the choice for this window when storage is unavailable, so the offer never repeats. */
let fallback: TourRecord | null = null;

function parse(raw: string | null): TourRecord | null {
  if (raw === null) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object") return null;
    const { status, step, at } = value as Record<string, unknown>;
    if (typeof status !== "string" || !STATUSES.has(status)) return null;
    return {
      status: status as TourStatus,
      step: typeof step === "string" && step ? step : undefined,
      at: typeof at === "number" ? at : 0,
    };
  } catch {
    return null;
  }
}

export function loadTourRecord(): TourRecord | null {
  try {
    return parse(localStorage.getItem(KEY)) ?? fallback;
  } catch {
    return fallback;
  }
}

/** Stable string snapshot for `useSyncExternalStore`; empty when the tour was never offered. */
export function getTourSnapshot(): string {
  const record = loadTourRecord();
  return record ? `${record.status}:${record.step ?? ""}` : "";
}

export function subscribeTour(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function saveTourRecord(status: TourStatus, step?: string): void {
  const record: TourRecord = {
    status,
    step: status === "paused" ? step : undefined,
    at: Date.now(),
  };
  try {
    localStorage.setItem(KEY, JSON.stringify(record));
    fallback = null;
  } catch {
    // The current window still honours the choice when storage is unavailable.
    fallback = record;
  }
  for (const listener of listeners) listener();
}

/**
 * Remembers progress (`paused` at a step) or the offer being declined (`later`) without ever
 * downgrading a finished or skipped tour: re-running it later only changes the record when the
 * run itself ends (completed or skipped).
 */
export function recordTourProgress(status: "paused" | "later", step?: string): void {
  const current = loadTourRecord()?.status;
  if (current === "completed" || current === "skipped") return;
  saveTourRecord(status, step);
}

/** Everyone without a record is offered the tour once, existing users included. */
export function shouldOfferTour(): boolean {
  return loadTourRecord() === null;
}

/** The step a re-launch continues from; the first step unless the tour was left part-way. */
export function tourResumeStep(): string | undefined {
  const record = loadTourRecord();
  return record?.status === "paused" ? record.step : undefined;
}

/** Asks the host to start a tour. The shell also listens, to reveal the workspace first. */
export function startTour(kind: TourKind = "first-run"): void {
  window.dispatchEvent(new CustomEvent<TourKind>(START_TOUR_EVENT, { detail: kind }));
}
