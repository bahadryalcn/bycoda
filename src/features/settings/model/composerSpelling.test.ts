// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";
import { loadComposerSpelling, saveComposerSpelling, useComposerSpelling } from "./composerSpelling";

describe("composer spelling preference", () => {
  it("defaults on, persists and updates subscribed composers", async () => {
    localStorage.removeItem("bycoda.composerSpelling");
    expect(loadComposerSpelling()).toBe(true);
    const container = document.createElement("div"); const root = createRoot(container);
    const Probe = () => { const value = useComposerSpelling(); return createElement("textarea", { spellCheck: value, autoCorrect: value ? "on" : "off" }); };
    try {
      await act(async () => root.render(createElement(Probe)));
      await act(async () => saveComposerSpelling(false));
      expect(loadComposerSpelling()).toBe(false);
      expect(container.querySelector("textarea")?.getAttribute("spellcheck")).toBe("false");
      expect(container.querySelector("textarea")?.getAttribute("autocorrect")).toBe("off");
      await act(async () => saveComposerSpelling(true));
      expect(container.querySelector("textarea")?.getAttribute("spellcheck")).toBe("true");
    } finally { await act(async () => root.unmount()); localStorage.removeItem("bycoda.composerSpelling"); }
  });
});
