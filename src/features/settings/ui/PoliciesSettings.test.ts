// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { PoliciesSettings } from "./PoliciesSettings";
import { POLICIES } from "../model/policies";
import { searchSettings } from "../model/settings";
import { RevealedSetting } from "../../../shared/ui/settings";

const language = vi.hoisted(() => ({ locale: "en" }));
vi.mock("../../../shared/i18n", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../shared/i18n")>()),
  useLocale: () => language.locale,
}));
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

async function openPolicy(id = POLICIES[0].id) {
  await act(async () =>
    root.render(
      createElement(RevealedSetting.Provider, { value: id }, createElement(PoliciesSettings)),
    ),
  );
}
it("opens privacy by default and replaces the inline reader with each full offline document", async () => {
  await act(async () => root.render(createElement(PoliciesSettings)));
  expect(document.querySelector("article")?.textContent).toContain(POLICIES[0].en);
  for (const policy of POLICIES) {
    expect(searchSettings(policy.title).some((result) => result.section === "policies")).toBe(true);
    await openPolicy(policy.id);
    expect(container.querySelector(`#setting-${policy.id}`)?.getAttribute("aria-label")).toBe(
      policy.title,
    );
    expect(document.querySelectorAll("article")).toHaveLength(1);
    expect(document.querySelector("article")?.textContent).toContain(policy.en);
    expect(document.querySelector("article")?.lang).toBe("en");
  }
});

it("follows Turkish locale while retaining the original MIT license", async () => {
  language.locale = "tr";
  await act(async () => root.render(createElement(PoliciesSettings)));
  await openPolicy();
  expect(document.querySelector("article")?.lang).toBe("tr");
  expect(document.querySelector("article")?.textContent).toContain(
    "Hesapla da hesapsız da asla toplanmayanlar",
  );
  await openPolicy("software-license");
  expect(document.querySelector("article")?.lang).toBe("en");
  expect(document.querySelector("article")?.textContent).toContain(POLICIES[3].en);
  language.locale = "de";
  await act(async () => root.render(createElement(PoliciesSettings)));
  await openPolicy();
  expect(document.querySelector("article")?.textContent).toContain(
    "What bycoda collects, and what it does not",
  );
});

it("allows a document language override without changing the app locale", async () => {
  await openPolicy();
  await act(async () =>
    container
      .querySelector<HTMLButtonElement>("button[aria-label='Policy language: English']")!
      .click(),
  );
  const turkish = [...document.querySelectorAll<HTMLElement>("[role=option]")].find((option) =>
    option.textContent?.includes("Türkçe"),
  )!;
  await act(async () => turkish.click());
  expect(document.querySelector("article")?.lang).toBe("tr");
  expect(language.locale).toBe("en");
});
