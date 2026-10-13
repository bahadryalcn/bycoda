// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { PoliciesSettings } from "./PoliciesSettings";
import { POLICIES } from "../model/policies";
import { searchSettings } from "../model/settings";

const language = vi.hoisted(() => ({ locale: "en" }));
vi.mock("../../../shared/i18n", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../shared/i18n")>()),
  useLocale: () => language.locale,
}));
// Exercise the real bundled policy data without the unrelated session tool graph.
vi.mock("../../sessions/ui/AgentMarkdown", () => ({
  AgentMarkdown: ({ text }: { text: string }) => createElement("div", null, text),
}));

const container = document.createElement("div");
document.body.append(container);
const root = createRoot(container);
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  HTMLElement.prototype.scrollIntoView = vi.fn();
});
afterEach(async () => {
  await act(async () => root.render(null));
  language.locale = "en";
  vi.unstubAllGlobals();
});

it("bundles every policy offline and exposes searchable settings anchors", async () => {
  await act(async () => root.render(createElement(PoliciesSettings)));
  for (const policy of POLICIES) {
    expect(container.querySelector(`#setting-${policy.id}`)?.textContent).toContain(policy.en);
    expect(searchSettings(policy.title).some((result) => result.section === "policies")).toBe(true);
  }
  expect(container.querySelectorAll("article[lang=en]")).toHaveLength(4);
  expect(container.textContent).toContain("info@bahadrhllyalcn.com");
});

it("follows Turkish locale and restores English text when the locale changes", async () => {
  language.locale = "tr";
  await act(async () => root.render(createElement(PoliciesSettings)));
  expect(container.querySelectorAll("article[lang=tr]")).toHaveLength(3);
  expect(container.textContent).toContain(
    "Geliştirici veri toplamıyor veya kullanıcıları takip etmiyor",
  );
  expect(container.querySelector("#setting-software-license article")?.getAttribute("lang")).toBe(
    "en",
  );
  language.locale = "de";
  await act(async () => root.render(createElement(PoliciesSettings)));
  expect(container.textContent).toContain("No developer collection or tracking");
});

it("allows an explicit policy language selection without changing the app locale", async () => {
  await act(async () => root.render(createElement(PoliciesSettings)));
  const picker = container.querySelector<HTMLButtonElement>(
    "button[aria-label='Policy language: English']",
  )!;
  await act(async () => picker.click());
  const turkish = [...document.querySelectorAll<HTMLElement>("[role=option]")].find((option) =>
    option.textContent?.includes("Türkçe"),
  )!;
  await act(async () => turkish.click());
  expect(container.querySelectorAll("article[lang=tr]")).toHaveLength(3);
  expect(language.locale).toBe("en");
});
