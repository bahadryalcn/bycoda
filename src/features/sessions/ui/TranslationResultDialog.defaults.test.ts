import { QueryClient, QueryClientProvider, notifyManager } from "@tanstack/react-query";
import type { ReactNode } from "react";
// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { TranslationResultDialog } from "./TranslationResultDialog";
import { HelperModelsSettings } from "../../settings/ui/HelperModelsSettings";
import { translateSelection } from "../model/translation";
import { defaultProviderAccountId } from "../../providers/model/providerAccounts";
import { defaultTextActionChoice, type TranslationChoice } from "../model/translationPreferences";

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

const routing = vi.hoisted(() => ({ resolve: vi.fn(), open: vi.fn() }));
vi.mock("../../model-routing/public/helpers", async (original) => ({
  ...(await original<typeof import("../../model-routing/public/helpers")>()),
  resolveHelperModel: routing.resolve,
}));
vi.mock("../../settings/public/modelsSettingsLink", () => ({ openModelsSettings: routing.open }));

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
let client: QueryClient;
function render(node: ReactNode) {
  root.render(createElement(QueryClientProvider, { client }, node));
}
let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
beforeEach(() => {
  notifyManager.setScheduler((callback) => callback());
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  routing.resolve.mockResolvedValue(undefined);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.clear();
  vi.clearAllMocks();
  vi.mocked(translateSelection).mockResolvedValue("Hello");
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  client.clear();
  notifyManager.setScheduler((callback) => setTimeout(callback, 0));
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
async function open(target: "en" | "reprompt" = "en") {
  await act(async () =>
    render(
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

it("uses the reprompt role and leaves it unchanged by dialog model changes", async () => {
  routing.resolve.mockResolvedValue({ ...choice, providerAccountId: "rewriter" });
  await open("reprompt");
  expect(translateSelection).toHaveBeenCalledWith(
    "selam",
    "reprompt",
    { ...context, ...choice, providerAccountId: "rewriter" },
    expect.any(AbortSignal),
    undefined,
    expect.any(Function),
  );
  expect(document.querySelector('[role="dialog"]')?.textContent).toContain("Rewritten prompt");
  const change = [...document.querySelectorAll<HTMLButtonElement>("button")].find(
    (button) => button.textContent === "Change model",
  )!;
  await act(async () => change.click());
});

it("links helper model settings to Models roles", async () => {
  routing.resolve.mockResolvedValue(choice);
  await act(async () => render(createElement(HelperModelsSettings)));
  const manage = [...container.querySelectorAll<HTMLButtonElement>("button")].find(
    (button) => button.textContent === "Manage models",
  )!;
  await act(async () => manage.click());
  expect(routing.open).toHaveBeenCalledWith("roles");
  expect(container.textContent).not.toContain("Change model");
});

it("starts with the Host translation account and model while keeping the caller project", async () => {
  routing.resolve.mockResolvedValue(choice);
  await open();
  expect(translateSelection).toHaveBeenCalledWith(
    "selam",
    "en",
    { ...context, ...choice },
    expect.any(AbortSignal),
    undefined,
    expect.any(Function),
  );
  const change = [...document.querySelectorAll<HTMLButtonElement>("button")].find(
    (button) => button.textContent === "Change model",
  )!;
  await act(async () => change.click());
});

it("returns to the Settings default model and account for an unbound role", async () => {
  routing.resolve.mockResolvedValue(choice);
  routing.resolve.mockResolvedValue(undefined);
  await open();
  expect(translateSelection).toHaveBeenCalledWith(
    "selam",
    "en",
    { ...context, ...defaultTextActionChoice() },
    expect.any(AbortSignal),
    undefined,
    expect.any(Function),
  );
});

it("uses the Host role while retaining the calling project", async () => {
  routing.resolve.mockResolvedValue({ ...choice, providerAccountId: "role-account" });
  await open();
  expect(translateSelection).toHaveBeenCalledWith(
    "selam",
    "en",
    { ...context, ...choice, providerAccountId: "role-account" },
    expect.any(AbortSignal),
    undefined,
    expect.any(Function),
  );
});

it("does not inherit the conversation account when the default has no account", async () => {
  routing.resolve.mockResolvedValue({
    ...choice,
    providerAccountId: defaultProviderAccountId("codex"),
  });
  await open();
  expect(vi.mocked(translateSelection).mock.calls[0][2].providerAccountId).toBe(
    defaultProviderAccountId("codex"),
  );
});

it.each(["en", "reprompt"] as const)(
  "automatically starts %s and shows one waiting label, then partial text",
  async (target) => {
    let finish!: (text: string) => void;
    vi.mocked(translateSelection).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    await open(target);
    const request = vi.mocked(translateSelection).mock.lastCall!;
    expect(translateSelection).toHaveBeenCalledOnce();
    const label = target === "reprompt" ? "Rewriting…" : "Translating…";
    expect(document.body.textContent?.split(label).length).toBe(2);
    expect(document.body.textContent).not.toContain("After applying:");
    await act(async () => request[5]?.("Partial output"));
    expect(document.body.textContent).toContain("Partial output");
    const apply = [...document.querySelectorAll<HTMLButtonElement>("button")].find(
      (button) =>
        button.textContent === (target === "reprompt" ? "Apply prompt" : "Apply translation"),
    )!;
    expect(apply.disabled).toBe(true);
    await act(async () => finish("Complete output"));
    expect(apply.disabled).toBe(false);
    expect(document.body.textContent).not.toContain(label);
  },
);

it("explains a slow request and ignores output after closing", async () => {
  vi.useFakeTimers();
  vi.mocked(translateSelection).mockImplementationOnce(() => new Promise(() => {}));
  await open("reprompt");
  const request = vi.mocked(translateSelection).mock.lastCall!;
  await act(async () => vi.advanceTimersByTimeAsync(12000));
  expect(document.body.textContent).toContain("Taking longer than usual");
  expect(document.body.textContent).toContain("12s");
  act(() => render(null));
  expect(request[3].aborted).toBe(true);
  act(() => request[5]?.("Late output"));
  expect(document.body.textContent).not.toContain("Late output");
});

it("preserves owner selection while the initial role lookup finishes", async () => {
  let finish!: (choice: TranslationChoice) => void;
  routing.resolve.mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  await open();
  const button = (label: string) =>
    [...document.querySelectorAll<HTMLButtonElement>("button")].find(
      (node) => node.textContent === label,
    )!;
  await act(async () => button("Change model").click());
  await act(async () => finish(choice));
  await act(async () => button("Translate selected text").click());
  expect(vi.mocked(translateSelection).mock.lastCall?.[2]).toMatchObject({
    harness: "claude",
    providerAccountId: "temporary",
  });
});
