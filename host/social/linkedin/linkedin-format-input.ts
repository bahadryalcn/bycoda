import type { LinkedInPostFormat } from "../../../src/features/social/model/social";
import { exact, str, url } from "../core/social-helpers";

export function parseLinkedInPostFormat(value: unknown): LinkedInPostFormat {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Choose a LinkedIn post format.");
  const input = value as Record<string, unknown>;
  if (input.kind === "poll") {
    exact(input, ["kind", "question", "options", "duration"]);
    const duration = input.duration;
    if (
      duration !== "ONE_DAY" &&
      duration !== "THREE_DAYS" &&
      duration !== "SEVEN_DAYS" &&
      duration !== "FOURTEEN_DAYS"
    )
      throw new Error("Choose a LinkedIn poll duration.");
    if (!Array.isArray(input.options) || input.options.length < 2 || input.options.length > 4)
      throw new Error("Provide two to four LinkedIn poll options.");
    const options = input.options.map((option) => str(option, "poll option", 30));
    if (new Set(options.map((option) => option.toLowerCase())).size !== options.length)
      throw new Error("LinkedIn poll options must be distinct.");
    return { kind: "poll", question: str(input.question, "poll question", 140), options, duration };
  }
  if (input.kind === "article") {
    exact(input, ["kind", "source", "title", "description"]);
    return {
      kind: "article",
      source: url(input.source, "article URL"),
      title: str(input.title, "article title", 399),
      ...(input.description !== undefined
        ? { description: str(input.description, "article description", 4085) }
        : {}),
    };
  }
  throw new Error("Choose a LinkedIn post format.");
}
