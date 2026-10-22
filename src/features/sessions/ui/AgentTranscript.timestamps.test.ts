// @vitest-environment happy-dom
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, it } from "vitest";
import { setLanguagePreference } from "../../../shared/i18n";
import { AgentTranscript } from "./AgentTranscript";

afterEach(async () => {
  await setLanguagePreference("en");
});

it.each([
  ["en", "Oct 17, 2024, 11:44 PM", "Oct 18, 2024, 12:04 AM"],
  ["tr", "17 Eki 2024 23:44", "18 Eki 2024 0:04"],
] as const)(
  "shows prompt and completion dates in %s across midnight",
  async (locale, prompt, end) => {
    await setLanguagePreference(locale);
    // Local constructor keeps the test independent of the machine's time zone.
    const startedAt = new Date(2024, 9, 17, 23, 44).getTime();
    const completedAt = new Date(2024, 9, 18, 0, 4).getTime();
    const container = document.createElement("div");
    container.innerHTML = renderToStaticMarkup(
      createElement(AgentTranscript, {
        blocks: [
          {
            id: "prompt",
            role: "user",
            text: "Inspect",
            startedAt,
            durationMs: completedAt - startedAt,
          },
          { id: "answer", role: "assistant", text: "Done" },
        ],
      }),
    );
    const stamps = [...container.querySelectorAll("time")];
    expect(stamps.map((stamp) => stamp.textContent)).toEqual([prompt, end]);
    expect(stamps.map((stamp) => stamp.dateTime)).toEqual([
      new Date(startedAt).toISOString(),
      new Date(completedAt).toISOString(),
    ]);
  },
);

it("does not invent a date for messages without saved timestamps", () => {
  const container = document.createElement("div");
  container.innerHTML = renderToStaticMarkup(
    createElement(AgentTranscript, {
      blocks: [{ id: "legacy", role: "user", text: "Old imported message" }],
    }),
  );
  expect(container.querySelector("time")).toBeNull();
});
