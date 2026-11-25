import { z } from "zod";
import { defineSpec, shortText, tone, type PresentedSpec } from "./voicePresentedSpec";

const strict = z.strictObject;
const money = z.number().min(0).max(1e12);

const JSON_MAX_DEPTH = 6;
const JSON_MAX_TEXT = 6000;
const SECRET_KEY =
  /^(?:token|secret|password|authorization|api.?key|(?:access|refresh).?token|credential)$/i;
const UNSAFE_KEY = /^(?:__proto__|constructor|prototype)$/;

/** Why a JSON value cannot be shown, or undefined when it can. Keys are checked as well as values. */
export function jsonRefusal(value: unknown, depth = 1): string | undefined {
  if (depth > JSON_MAX_DEPTH) return `Nesting is limited to ${JSON_MAX_DEPTH} levels.`;
  if (typeof value === "number")
    // The program writes numbers as JSON literals; an exponent form is not a plain decimal.
    return Number.isFinite(value) && !/e/i.test(String(value))
      ? undefined
      : "Numbers must be finite plain decimals.";
  if (value === null || typeof value === "string" || typeof value === "boolean") return undefined;
  if (Array.isArray(value)) {
    for (const item of value) {
      const problem = jsonRefusal(item, depth + 1);
      if (problem) return problem;
    }
    return undefined;
  }
  if (typeof value !== "object") return "Only JSON values can be shown.";
  for (const [key, item] of Object.entries(value)) {
    if (UNSAFE_KEY.test(key)) return `The key "${key}" is not allowed.`;
    if (SECRET_KEY.test(key)) return `The key "${key}" looks like a credential. Remove it.`;
    const problem = jsonRefusal(item, depth + 1);
    if (problem) return problem;
  }
  return undefined;
}

const jsonData = z.unknown().superRefine((value, ctx) => {
  const problem =
    value === undefined
      ? "Send the JSON value to show."
      : (jsonRefusal(value) ??
        (JSON.stringify(value).length > JSON_MAX_TEXT
          ? `The value is limited to ${JSON_MAX_TEXT} characters of JSON.`
          : undefined));
  if (problem) ctx.addIssue({ code: "custom", message: problem });
});

/** Only a plain https address with no embedded login can be opened. */
export const safeHttpsUrl = (value: string) => {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password && url.hostname !== "";
  } catch {
    return false;
  }
};

/** Records and richer displays drawn from values the model sends; all text is plain text. */
export const presentedRecordSpecs = [
  defineSpec({
    name: "Timeline",
    group: "data",
    description:
      "Events of one thing in time, newest first and grouped by day. An event with detail opens in place.",
    source: "Timeline",
    props: strict({
      label: shortText(80),
      events: z
        .array(
          strict({
            at: z.iso.datetime({ offset: true }),
            title: shortText(160),
            actor: shortText(60).optional(),
            meta: shortText(120).optional(),
            detail: shortText(400).optional(),
            tone: z.enum(["neutral", "success", "danger"]).optional(),
          }),
        )
        .min(1)
        .max(20),
    }),
    example: {
      type: "Timeline",
      label: "Run history",
      events: [
        { at: "2026-11-24T09:00:00Z", title: "started the build", actor: "Arif" },
        { at: "2026-11-24T09:04:00Z", title: "build passed", tone: "success", detail: "42 tests" },
      ],
    },
  }),
  defineSpec({
    name: "StepStrip",
    group: "data",
    description:
      "The recent outcome of a run's steps as small cells, oldest first. The label states the counts in words.",
    source: "StepStrip",
    props: strict({
      label: shortText(80),
      steps: z
        .array(z.enum(["done", "failed", "active"]))
        .min(1)
        .max(40),
    }),
    example: {
      type: "StepStrip",
      label: "3 of 4 steps done, 1 failed",
      steps: ["done", "done", "failed", "done"],
    },
  }),
  defineSpec({
    name: "UsageMeter",
    group: "data",
    description:
      "Used against a limit for a quota or budget, split into up to four named parts, with the amount left.",
    source: "UsageMeter",
    props: strict({
      label: shortText(80),
      limit: z.number().positive().max(1e12),
      segments: z
        .array(strict({ label: shortText(40), value: money }))
        .min(1)
        .max(4),
      unit: shortText(20).optional(),
      valueText: shortText(60).optional(),
      tone: tone.optional(),
    }),
    example: {
      type: "UsageMeter",
      label: "Monthly budget",
      limit: 100,
      unit: "USD",
      segments: [
        { label: "Chat", value: 30 },
        { label: "Voice", value: 12 },
      ],
    },
  }),
  defineSpec({
    name: "ActivityHeatmap",
    group: "data",
    description:
      "Per-day activity over several weeks or months, drawn from the first to the last day sent. One entry per day with a count; days left out count as zero.",
    source: "ActivityHeatmap",
    props: strict({
      label: shortText(80),
      period: shortText(60),
      unit: strict({ one: shortText(20), other: shortText(20) }),
      days: z
        .array(strict({ date: z.iso.date(), count: z.number().int().min(0).max(1e6) }))
        .min(1)
        .max(366)
        .refine((days) => new Set(days.map((day) => day.date)).size === days.length, {
          message: "Each day may appear once.",
        }),
    }),
    example: {
      type: "ActivityHeatmap",
      label: "Runs per day",
      period: "November",
      unit: { one: "run", other: "runs" },
      days: [
        { date: "2026-10-01", count: 1 },
        { date: "2026-10-14", count: 3 },
        { date: "2026-11-03", count: 2 },
        { date: "2026-11-23", count: 2 },
        { date: "2026-11-24", count: 5 },
      ],
    },
  }),
  defineSpec({
    name: "JsonViewer",
    group: "data",
    description:
      "An inspectable tree of one JSON value the turn observed (a result, a config), with search. Not for summaries: use DescriptionList. Credential-looking keys are refused.",
    source: "JsonViewer",
    props: strict({ label: shortText(60), data: jsonData }),
    example: { type: "JsonViewer", label: "Result", data: { passed: 42, failed: ["a", "b"] } },
  }),
  defineSpec({
    name: "StatusBadge",
    group: "feedback",
    description: "A run, job or check status as a pill; the text replaces the standard word.",
    source: "StatusBadge",
    props: strict({
      status: z.enum(["failed", "running", "retrying", "done", "queued", "warning"]),
      text: shortText(40).optional(),
    }),
    example: { type: "StatusBadge", status: "failed", text: "Failed · 3" },
  }),
  defineSpec({
    name: "Link",
    group: "text",
    description:
      "An https link the owner may open; the address host is shown beside the label so it cannot be hidden. No other schemes.",
    source: "Link",
    props: strict({
      label: shortText(80),
      url: z.string().trim().max(2000).refine(safeHttpsUrl, "Send a plain https address."),
    }),
    example: { type: "Link", label: "Release notes", url: "https://example.com/notes" },
  }),
  defineSpec({
    name: "ShortcutKeys",
    group: "text",
    description:
      'A keyboard shortcut as key caps spelled for the owner\'s platform: "mod+k", "Ctrl+Shift+P" or "Esc Esc".',
    source: "ShortcutKeys",
    props: strict({ keys: shortText(40) }),
    example: { type: "ShortcutKeys", keys: "mod+shift+p" },
  }),
  defineSpec({
    name: "ClampText",
    group: "text",
    description:
      "Long plain text cut at a few lines with a Show more action that appears only when it overflows.",
    source: "ClampText",
    props: strict({
      text: z.string().trim().min(1).max(4000),
      lines: z.number().int().min(1).max(12).optional(),
    }),
    example: { type: "ClampText", text: "A long note the owner can expand.", lines: 3 },
  }),
] satisfies PresentedSpec[];
