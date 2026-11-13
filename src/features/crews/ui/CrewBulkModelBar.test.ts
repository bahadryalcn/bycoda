import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import type { HostModelCatalog } from "../../connections/public/protocol";
import { CrewBulkModelBar } from "./CrewBulkModelBar";

vi.mock("../../model-routing/public/choice", () => ({ ModelChoiceField: () => null }));

it.each([
  ["members", 0, "Apply to 0 members"],
  ["members", 1, "Apply to 1 member"],
  ["members", 2, "Apply to 2 members"],
  ["profiles", 0, "Apply to 0 profiles"],
  ["profiles", 1, "Apply to 1 profile"],
  ["profiles", 2, "Apply to 2 profiles"],
] as const)("names %s targets at count %s", (noun, targetCount, expected) => {
  const html = renderToStaticMarkup(
    createElement(CrewBulkModelBar, {
      cwd: "/fixture",
      catalog: { models: {}, errors: {} } as HostModelCatalog,
      noun,
      targetCount,
      suggested: {
        id: "codex/codex:fixture",
        harness: "codex",
        model: "codex:fixture",
        modelSettings: {},
        capabilities: {},
      },
      onApply: vi.fn(),
    }),
  );
  const buttonText = html
    .match(/<button\b[^>]*>([\s\S]*?)<\/button>/)?.[1]
    .replace(/<[^>]*>/g, "")
    .trim();
  expect(buttonText).toBe(expected);
  expect(/<button[^>]*\sdisabled(?:=|\s|>)/.test(html)).toBe(targetCount === 0);
});
