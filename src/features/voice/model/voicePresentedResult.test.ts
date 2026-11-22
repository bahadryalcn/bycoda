import { expect, it } from "vitest";
import { VoicePresentedResultSchema } from "./voicePresentedResult";

it("accepts a bounded result with actual numeric comparisons", () => {
  expect(
    VoicePresentedResultSchema.safeParse({
      title: "Test results",
      summary: "Two packages finished.",
      content: {
        kind: "chart",
        items: [
          { label: "Web", value: 8 },
          { label: "Host", value: 5 },
        ],
      },
    }).success,
  ).toBe(true);
});

it("rejects likely credentials, unsupported actions and unbounded data", () => {
  const result = { title: "Test results", summary: "Two packages finished." };
  expect(
    VoicePresentedResultSchema.safeParse({ ...result, summary: "API_KEY=example-only-value" })
      .success,
  ).toBe(false);
  expect(VoicePresentedResultSchema.safeParse({ ...result, action: "open_browser" }).success).toBe(
    false,
  );
  expect(
    VoicePresentedResultSchema.safeParse({
      ...result,
      content: { kind: "notes", items: Array(7).fill("Example") },
    }).success,
  ).toBe(false);
});
