// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const api = vi.hoisted(() => ({ list: vi.fn(), status: vi.fn(), start: vi.fn(), cancel: vi.fn() }));
vi.mock("../model/localDictationModels", () => ({ localDictationModels: api }));
import { LocalDictationModels } from "./LocalDictationModels";
import { loadVoiceSettings } from "../model/voiceSettings";
import { setLanguagePreference, t } from "../../../shared/i18n";

it("lists owned models and prevents duplicate actions while starting a job", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  api.list.mockResolvedValue([
    { id: "small", label: "Whisper small", path: "owned/small", installed: false },
  ]);
  api.status.mockResolvedValue({ state: "idle" });
  let finish!: (value: { state: "working" }) => void;
  api.start.mockReturnValue(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () => {
      root.render(
        createElement(LocalDictationModels, { settings: loadVoiceSettings(), change: vi.fn() }),
      );
    });
    expect(container.textContent).toContain("Whisper small");
    const button = [...container.querySelectorAll("button")].find(
      (item) => item.textContent === "Download",
    )!;
    await act(async () => {
      button.click();
    });
    expect(button.getAttribute("aria-disabled")).toBe("true");
    expect(button.getAttribute("aria-busy")).toBe("true");
    expect(api.start).toHaveBeenCalledTimes(1);
    await act(async () => {
      finish({ state: "working" });
    });
  } finally {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  }
});

it("translates known Host job and action errors into Turkish", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  await setLanguagePreference("tr");
  api.list.mockResolvedValue([
    { id: "small", label: "Whisper small", path: "owned/small", installed: false },
  ]);
  api.status.mockResolvedValue({ state: "error", detail: "Downloaded model is incomplete." });
  api.start.mockRejectedValue(new Error("Disconnect voice before managing models."));
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () =>
      root.render(
        createElement(LocalDictationModels, {
          settings: loadVoiceSettings(),
          change: vi.fn(),
        }),
      ),
    );
    expect(container.textContent).toContain("İndirilen model eksik.");
    const download = [...container.querySelectorAll("button")].find(
      (button) => button.textContent === t("Download"),
    )!;
    await act(async () => download.click());
    expect(container.textContent).toContain(
      "Modelleri yönetmeden önce sesli görüşmeyi sonlandırın.",
    );
    expect(container.textContent).not.toContain("Disconnect voice before managing models.");
  } finally {
    await act(async () => root.unmount());
    container.remove();
    await setLanguagePreference("en");
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  }
});

describe("model action recovery", () => {
  let root: ReturnType<typeof createRoot>;
  let host: HTMLDivElement;
  let job: { state: string; id?: string; action?: string; detail?: string };
  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    job = { state: "idle" };
    api.list.mockResolvedValue([
      { id: "small", label: "Whisper small", path: "owned/small", installed: true },
      { id: "turbo", label: "Whisper turbo", path: "owned/turbo", installed: false },
    ]);
    api.status.mockImplementation(async () => job);
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
    vi.useRealTimers();
    vi.resetAllMocks();
    vi.unstubAllGlobals();
  });
  async function render(change = vi.fn(), path = "") {
    await act(async () =>
      root.render(
        createElement(LocalDictationModels, {
          settings: { ...loadVoiceSettings(), dictationLocalModelPath: path },
          change,
        }),
      ),
    );
  }
  async function click(text: string, scope: ParentNode = document) {
    const button = [...scope.querySelectorAll("button")].find(
      (button) => button.textContent?.trim() === text,
    )!;
    expect(button, text).toBeTruthy();
    await act(async () => button.click());
  }
  it("confirms named local-file deletion and never deletes on opening or cancel", async () => {
    api.start.mockImplementation(
      async () => (job = { state: "working", id: "small", action: "delete" }),
    );
    await render();
    await click("Delete", host);
    expect(document.body.textContent).toContain("Delete Whisper small?");
    expect(document.body.textContent).toContain("You can download it again");
    expect(api.start).not.toHaveBeenCalled();
    await click("Cancel", document.querySelector('[role="dialog"]')!);
    expect(api.start).not.toHaveBeenCalled();
    await click("Delete", host);
    await click("Delete", document.querySelector('[role="dialog"]')!);
    expect(api.start).toHaveBeenCalledOnce();
    expect(api.start.mock.calls[0].slice(0, 2)).toEqual(["delete", "small"]);
    expect(host.textContent).toContain("Whisper small: Deleting");
  });
  it("shows deferred initiating action, blocks duplicates, and names resumed jobs", async () => {
    let finish!: (value: typeof job) => void;
    api.start.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    await render();
    await click("Download", host);
    expect(host.textContent).toContain("Whisper turbo: Downloading");
    const initiating = host.querySelector('[data-setting-id="dictation-local-turbo"] button')!;
    expect(initiating.getAttribute("aria-label")).toContain("Downloading");
    expect(initiating.getAttribute("aria-disabled")).toBe("true");
    await act(async () => (initiating as HTMLButtonElement).click());
    expect(api.start).toHaveBeenCalledOnce();
    job = { state: "working", id: "turbo", action: "download" };
    await act(async () => finish(job));
    await act(async () => root.render(null));
    await render();
    expect(host.textContent).toContain("Whisper turbo: Downloading");
    expect(api.start).toHaveBeenCalledOnce();
  });
  it("keeps cancellation errors and shows requested cancellation until terminal status", async () => {
    job = { state: "working", id: "small", action: "test" };
    api.cancel.mockRejectedValueOnce(new Error("offline"));
    await render();
    await click("Cancel", host);
    expect(host.textContent).toContain("Could not request cancellation");
    await act(async () => vi.advanceTimersByTimeAsync(1000));
    expect(host.textContent).toContain("Could not request cancellation");
    api.cancel.mockResolvedValue(job);
    await click("Cancel", host);
    expect(host.textContent).toContain("Cancellation requested");
    expect(
      [...host.querySelectorAll("button")].find(
        (button) => button.textContent === "Cancellation requested",
      )!.disabled,
    ).toBe(true);
    job = { state: "ready", id: "small", action: "test" };
    await act(async () => vi.advanceTimersByTimeAsync(1000));
    expect(host.textContent).toContain("Model loaded successfully on CPU");
    expect(host.textContent).not.toContain("Cancellation requested");
  });
  it("retains selection until confirmed deletion completes and permits retry after start failure", async () => {
    const change = vi.fn();
    api.start.mockRejectedValueOnce(new Error("Disconnect voice before managing models."));
    await render(change, "owned/small");
    await click("Test model load", host);
    expect(host.textContent).toContain("Disconnect voice before managing models");
    expect(change).not.toHaveBeenCalled();
    job = { state: "ready", id: "small", action: "delete" };
    api.list.mockResolvedValue([
      { id: "small", label: "Whisper small", path: "owned/small", installed: false },
    ]);
    await act(async () => root.render(null));
    await render(change, "owned/small");
    expect(change).toHaveBeenCalledWith({ dictationLocalModelPath: "" });
  });
});
