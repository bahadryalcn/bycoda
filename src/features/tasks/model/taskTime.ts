import type { HostTask } from "./hostTasks";

/** A span of time as a card shows it: "under 1m", "12m", "3h 5m", "2d 4h". */
export function formatTaskSpan(ms: number): string {
  const minutes = Math.floor(Math.max(0, ms) / 60_000);
  if (minutes < 1) return "under 1m";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return minutes % 60 ? `${hours}h ${minutes % 60}m` : `${hours}h`;
  return hours % 24 ? `${Math.floor(hours / 24)}d ${hours % 24}h` : `${Math.floor(hours / 24)}d`;
}

/** When a card's task got to where it is: how long it has waited or run, or
 * how long ago it finished. */
export function taskTimeLabel(
  task: Pick<HostTask, "status" | "createdAt" | "updatedAt" | "startedAt" | "completedAt">,
  now: number,
): string {
  // A missing, zero or invalid timestamp would read as decades since 1970: say nothing.
  const valid = (at: number | undefined): at is number =>
    typeof at === "number" && Number.isFinite(at) && at > 0;
  if (task.status === "todo")
    return valid(task.createdAt) ? `Added ${formatTaskSpan(now - task.createdAt)} ago` : "";
  if (task.status === "queued")
    return valid(task.updatedAt) ? `Waiting ${formatTaskSpan(now - task.updatedAt)}` : "";
  if (task.status === "running") {
    const since = valid(task.startedAt) ? task.startedAt : task.updatedAt;
    return valid(since) ? `Running ${formatTaskSpan(now - since)}` : "";
  }
  if (task.status === "verifying")
    return valid(task.updatedAt) ? `Verifying ${formatTaskSpan(now - task.updatedAt)}` : "";
  const finished = valid(task.completedAt) ? task.completedAt : task.updatedAt;
  return valid(finished)
    ? `${task.status === "blocked" ? "Stopped" : "Finished"} ${formatTaskSpan(now - finished)} ago`
    : "";
}
