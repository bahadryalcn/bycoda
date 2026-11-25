// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import type { AssistantProfilePatch } from "../../../../shared/model/host-contracts/assistant";

vi.mock("../../../../shared/i18n", () => ({
  t: (key: string, values?: Record<string, string>) =>
    key.replace(/\{(p\d)\}/g, (_, name: string) => values?.[name] ?? ""),
  useT: () => (key: string) => key,
}));
vi.mock("../../../../shared/ui/Modal", async () => {
  const { createElement: h } = await import("react");
  return {
    Modal: ({ title, footer, children }: any) =>
      h("div", { role: "dialog" }, title, children, footer),
    ModalActions: ({ children }: any) => h("div", null, children),
  };
});
vi.mock("../../../voice/public/settings", () => ({ loadVoiceSettings: () => ({}) }));

const { useLanguageChangeFlow } = await import("./useLanguageChangeFlow");

let root: Root | undefined;
let container: HTMLDivElement;
afterEach(async () => {
  await act(async () => root?.unmount());
  container?.remove();
});

async function mount(draft: AssistantProfilePatch) {
  const applyLanguage = vi.fn();
  const startBuilder = vi.fn();
  let flow!: ReturnType<typeof useLanguageChangeFlow>;
  function Harness() {
    flow = useLanguageChangeFlow({
      draft,
      lastSpoken: null,
      applyLanguage,
      startBuilder,
      readVoice: () => ({}),
    });
    return createElement("div", null, flow.dialog);
  }
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root!.render(createElement(Harness)));
  const button = (name: string) =>
    [...container.querySelectorAll("button")].find((item) => item.textContent === name)!;
  return { applyLanguage, startBuilder, flow: () => flow, button };
}

const turkish: AssistantProfilePatch = {
  language: "tr-TR",
  persona: "Rahat konuş.",
  addressAs: "Efendim",
};

it("applies a change at once when nothing is language-bound", async () => {
  const { flow } = await mount({ language: "tr-TR" });
  let held = true;
  await act(async () => {
    held = flow().intercept({ language: "en-US" });
  });
  expect(held).toBe(false);
  expect(container.querySelector("[role=dialog]")).toBeNull();
});

it("Cancel keeps the language and applies nothing", async () => {
  const { flow, button, applyLanguage, startBuilder } = await mount(turkish);
  await act(async () => void flow().intercept({ language: "en-US" }));
  expect(container.textContent).toContain("Persona");
  expect(container.textContent).toContain("How should I address you?");
  await act(async () => button("Cancel").click());
  expect(applyLanguage).not.toHaveBeenCalled();
  expect(startBuilder).not.toHaveBeenCalled();
  expect(container.querySelector("[role=dialog]")).toBeNull();
  expect(flow().review).toBeUndefined();
});

it("I will review them myself applies the language and flags the fields", async () => {
  const { flow, button, applyLanguage, startBuilder } = await mount(turkish);
  await act(async () => void flow().intercept({ language: "en-US" }));
  await act(async () => button("I will review them myself").click());
  expect(applyLanguage).toHaveBeenCalledWith("en-US");
  expect(startBuilder).not.toHaveBeenCalled();
  expect([...flow().review!.keys].sort()).toEqual(["addressAs", "persona"]);
});

it("Create again with AI applies the language and starts the builder", async () => {
  const { flow, button, applyLanguage, startBuilder } = await mount(turkish);
  await act(async () => void flow().intercept({ language: "en-US" }));
  await act(async () => button("Create again with AI").click());
  expect(applyLanguage).toHaveBeenCalledWith("en-US");
  expect(startBuilder).toHaveBeenCalledTimes(1);
  expect(startBuilder.mock.calls[0][0]).toContain("Rewrite my persona");
});
