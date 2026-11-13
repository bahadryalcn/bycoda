// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { loadVoiceSettings } from "../model/voiceSettings";
import { clearRetainedVoiceDrafts } from "../model/voiceSettingsDrafts";
afterEach(() => clearRetainedVoiceDrafts());
import { VoiceWakeRows } from "./VoiceWakeSettings";

it("updates an untouched phrase when settings change externally", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const change = vi.fn();
  const settings = { ...loadVoiceSettings(), wakeEnabled: true, wakePhrase: "Hello there" };
  await act(async () => root.render(createElement(VoiceWakeRows, { settings, change })));
  await act(async () =>
    root.render(
      createElement(VoiceWakeRows, { settings: { ...settings, wakePhrase: "New phrase" }, change }),
    ),
  );
  expect(container.querySelector<HTMLInputElement>("input")!.value).toBe("New phrase");
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

it("preserves edits across external changes and commits valid, invalid, and default phrases", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const change = vi.fn();
  const settings = { ...loadVoiceSettings(), wakeEnabled: true, wakePhrase: "Hello there" };
  const render = async (wakePhrase: string) =>
    act(async () =>
      root.render(createElement(VoiceWakeRows, { settings: { ...settings, wakePhrase }, change })),
    );
  await render(settings.wakePhrase);
  const input = container.querySelector<HTMLInputElement>("input")!;
  const edit = async (value: string) =>
    act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
  const enter = async () =>
    act(async () =>
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })),
    );
  await edit("My phrase");
  await render("External phrase");
  expect(input.value).toBe("My phrase");
  await enter();
  expect(change).toHaveBeenLastCalledWith({ wakePhrase: "My phrase" });
  await render("My phrase");
  change.mockClear();
  await enter();
  expect(change).not.toHaveBeenCalled();
  await edit("x");
  await enter();
  expect(change).not.toHaveBeenCalled();
  await edit("");
  await enter();
  expect(change).toHaveBeenLastCalledWith({ wakePhrase: undefined });
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

it("keeps invalid wake and sleep drafts through navigation and disable/remount without saving", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const change = vi.fn();
  const settings = { ...loadVoiceSettings(), wakeEnabled: true };
  try {
    const render = async (wakeEnabled = true) =>
      act(async () =>
        root.render(
          createElement(VoiceWakeRows, { settings: { ...settings, wakeEnabled }, change }),
        ),
      );
    await render();
    for (const [index, value] of ["x", "y"].entries())
      await act(async () => {
        const input = host.querySelectorAll("input")[index];
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(
          input,
          value,
        );
        input.dispatchEvent(new Event("input", { bubbles: true }));
        input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
      });
    await act(async () => root.render(null));
    await render(false);
    await render();
    expect([...host.querySelectorAll("input")].map((input) => input.value)).toEqual(["x", "y"]);
    expect(host.textContent).toContain("Use 2 to 40 characters");
    expect(change).not.toHaveBeenCalled();
  } finally {
    await act(async () => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  }
});
