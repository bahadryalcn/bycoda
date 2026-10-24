// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { TranslationResultDialog } from "./TranslationResultDialog";
import { TranslationSettings } from "../../settings/ui/TranslationSettings";
import { translateSelection } from "../model/translation";
import {
  loadDefaultTranslationChoice,
  parseTranslationChoice,
  saveDefaultTranslationChoice,
  loadDefaultRepromptChoice,
  saveDefaultRepromptChoice,
  type TranslationChoice,
} from "../model/translationPreferences";

vi.mock("../model/translation", async (original) => ({
  ...(await original<typeof import("../model/translation")>()),
  canTranslate: () => true,
  translateSelection: vi.fn(async () => "Hello"),
}));
vi.mock("./ModelPicker", () => ({
  ModelPicker: ({
    onChange,
  }: {
    onChange: (harness: string, model: string, accountId?: string) => void;
  }) =>
    createElement(
      "button",
      { onClick: () => onChange("claude", "claude:sonnet-5", "temporary") },
      "Change model",
    ),
}));

const choice: TranslationChoice = {
  harness: "codex",
  model: "codex:gpt-6.1",
  modelSettings: { effort: "medium" },
  providerAccountId: "translator",
};
const context = {
  cwd: "/calling-project",
  harness: "claude" as const,
  model: "claude:sonnet-5",
  providerAccountId: "conversation-account",
};
let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});
async function open(target: "en" | "reprompt" = "en") {
  await act(async () =>
    root.render(
      createElement(TranslationResultDialog, {
        text: "selam",
        target,
        context,
        onApply: vi.fn(),
        onClose: vi.fn(),
      }),
    ),
  );
}

it("uses the independent reprompt default and leaves it unchanged by dialog model changes", async () => {
  saveDefaultTranslationChoice({ ...choice, providerAccountId: "translator" });
  saveDefaultRepromptChoice({ ...choice, providerAccountId: "rewriter" });
  await open("reprompt");
  expect(translateSelection).toHaveBeenCalledWith(
    "selam",
    "reprompt",
    { ...context, ...choice, providerAccountId: "rewriter" },
    expect.any(AbortSignal),
    undefined,
  );
  expect(document.querySelector('[role="dialog"]')?.textContent).toContain("Rewritten prompt");
  const change = [...document.querySelectorAll<HTMLButtonElement>("button")].find(
    (button) => button.textContent === "Change model",
  )!;
  await act(async () => change.click());
  expect(loadDefaultRepromptChoice()?.providerAccountId).toBe("rewriter");
  expect(loadDefaultTranslationChoice()?.providerAccountId).toBe("translator");
});

it("saves and resets reprompt settings without changing translation settings", async () => {
  saveDefaultTranslationChoice(choice);
  await act(async () => root.render(createElement(TranslationSettings, { action: "reprompt" })));
  const change = [...container.querySelectorAll<HTMLButtonElement>("button")].find(
    (button) => button.textContent === "Change model",
  )!;
  await act(async () => change.click());
  expect(loadDefaultRepromptChoice()).toMatchObject({
    harness: "claude",
    model: "claude:sonnet-5",
    providerAccountId: "temporary",
  });
  expect(loadDefaultTranslationChoice()).toEqual(choice);
  const reset = [...container.querySelectorAll<HTMLButtonElement>("button")].find(
    (button) => button.textContent === "Use conversation model",
  )!;
  await act(async () => reset.click());
  expect(loadDefaultRepromptChoice()).toBeUndefined();
  expect(loadDefaultTranslationChoice()).toEqual(choice);
});

it("starts with the persisted translation account and model while keeping the caller project", async () => {
  saveDefaultTranslationChoice(choice);
  await open();
  expect(translateSelection).toHaveBeenCalledWith(
    "selam",
    "en",
    { ...context, ...choice },
    expect.any(AbortSignal),
  );
  const change = [...document.querySelectorAll<HTMLButtonElement>("button")].find(
    (button) => button.textContent === "Change model",
  )!;
  await act(async () => change.click());
  expect(loadDefaultTranslationChoice()).toEqual(choice);
});

it("returns to the conversation model and account after resetting the default", async () => {
  saveDefaultTranslationChoice(choice);
  saveDefaultTranslationChoice(undefined);
  await open();
  expect(translateSelection).toHaveBeenCalledWith("selam", "en", context, expect.any(AbortSignal));
});

it("saves the settings picker selection and resets it to the conversation model", async () => {
  await act(async () => root.render(createElement(TranslationSettings)));
  const change = [...container.querySelectorAll<HTMLButtonElement>("button")].find(
    (button) => button.textContent === "Change model",
  )!;
  await act(async () => change.click());
  expect(loadDefaultTranslationChoice()).toMatchObject({
    harness: "claude",
    model: "claude:sonnet-5",
    providerAccountId: "temporary",
  });
  const reset = [...container.querySelectorAll<HTMLButtonElement>("button")].find(
    (button) => button.textContent === "Use conversation model",
  )!;
  await act(async () => reset.click());
  expect(loadDefaultTranslationChoice()).toBeUndefined();
});

it("does not inherit the conversation account when the default has no account", async () => {
  saveDefaultTranslationChoice({ ...choice, providerAccountId: undefined });
  await open();
  expect(vi.mocked(translateSelection).mock.calls[0][2].providerAccountId).toBeUndefined();
});

it("ignores corrupt saved choices and filters invalid model settings", () => {
  for (const raw of [
    "invalid",
    "null",
    '{"harness":"unknown","model":"x"}',
    '{"harness":"codex","model":""}',
  ]) {
    expect(parseTranslationChoice(raw)).toBeUndefined();
  }
  expect(
    parseTranslationChoice(
      JSON.stringify({ ...choice, modelSettings: { effort: "medium", invalid: false } }),
    )?.modelSettings,
  ).toEqual({ effort: "medium" });
});
