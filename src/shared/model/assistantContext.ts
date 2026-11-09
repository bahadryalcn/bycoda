/** Context admission shared by the Host supervisor and its read-only Room meter.
 * Unknown or invalid measurements require compaction before another message. */
export type WorkerContextSettings = {
  workerSoftContext?: number;
  workerHardContext?: number;
  workerCompactPercent?: number;
  workerHandoffPercent?: number;
};
export const DEFAULT_WORKER_CONTEXT_SETTINGS = Object.freeze({
  workerSoftContext: 150000,
  workerHardContext: 300000,
  workerCompactPercent: 50,
  workerHandoffPercent: 80,
});
export function workerContextSettings(settings: WorkerContextSettings = {}) {
  return {
    workerSoftContext:
      settings.workerSoftContext ?? DEFAULT_WORKER_CONTEXT_SETTINGS.workerSoftContext,
    workerHardContext:
      settings.workerHardContext ?? DEFAULT_WORKER_CONTEXT_SETTINGS.workerHardContext,
    workerCompactPercent:
      settings.workerCompactPercent ?? DEFAULT_WORKER_CONTEXT_SETTINGS.workerCompactPercent,
    workerHandoffPercent:
      settings.workerHandoffPercent ?? DEFAULT_WORKER_CONTEXT_SETTINGS.workerHandoffPercent,
  };
}
export function validWorkerContextSettings(settings: WorkerContextSettings): boolean {
  const value = workerContextSettings(settings);
  return (
    Object.values(value).every(Number.isSafeInteger) &&
    value.workerSoftContext >= 10000 &&
    value.workerSoftContext < value.workerHardContext &&
    value.workerHardContext <= 1000000 &&
    value.workerCompactPercent >= 1 &&
    value.workerCompactPercent < value.workerHandoffPercent &&
    value.workerHandoffPercent <= 99
  );
}
export function workerContextAction(
  used?: number,
  window?: number,
  settings: WorkerContextSettings = {},
): "send" | "compact" | "handoff" {
  if (
    !Number.isFinite(used) ||
    !Number.isFinite(window) ||
    used === undefined ||
    window === undefined ||
    used < 0 ||
    window <= 0 ||
    !validWorkerContextSettings(settings)
  )
    return "compact";
  const policy = workerContextSettings(settings);
  if (used >= policy.workerHardContext || used / window >= policy.workerHandoffPercent / 100)
    return "handoff";
  if (used >= policy.workerSoftContext || used / window >= policy.workerCompactPercent / 100)
    return "compact";
  return "send";
}
