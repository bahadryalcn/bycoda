import type { RuntimeLogEntry, RuntimeLogLevel } from "./runtimeLogTypes";

export type RuntimeLogDisplayLevel = RuntimeLogLevel | "http" | "success";

/** Presentation categories do not change the host's four-level wire contract. */
export function runtimeLogDisplayLevel(
  entry: Pick<RuntimeLogEntry, "level" | "message">,
  message?: string,
): RuntimeLogDisplayLevel {
  if (entry.level !== "info") return entry.level;
  message ??= entry.message;
  const request =
    /^\s*(?:\[[^\]]+\]\s*)?(?:GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s+\S+\s+(\d{3})\b/i.exec(
      message,
    );
  if (request) return Number(request[1]) >= 400 ? "error" : "http";
  if (
    /^\s*(?:\[[^\]]+\]\s*)?(?:HTTP\/\d(?:\.\d)?\s+\d{3}\b|(?:GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s+https?:\/\/)/i.test(
      message,
    )
  )
    return "http";
  if (
    /^\s*(?:[✓✔]\s*)?(?:ready in\b|compiled(?: successfully|\s+\S+\s+in)\b|success(?:fully)?\b)/i.test(
      message,
    )
  )
    return "success";
  return "info";
}
