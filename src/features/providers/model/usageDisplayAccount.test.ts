// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { saveUsageDisplayAccount, useUsageDisplayAccount } from "./usageDisplayAccount";

const key = "bycoda.usageDisplayAccount.v1.claude";

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

it("clears an unsaved display choice on matching cross-window storage events", async () => {
  const container = document.createElement("div");
  const root = createRoot(container);
  const seen: Array<string | null> = [];
  function Probe() {
    seen.push(useUsageDisplayAccount("claude"));
    return null;
  }

  await act(async () => root.render(createElement(Probe)));
  const write = vi.spyOn(localStorage, "setItem").mockImplementation(() => {
    throw new Error("storage full");
  });
  await act(async () => saveUsageDisplayAccount("claude", "unsaved"));
  expect(seen.at(-1)).toBe("unsaved");

  const previousCount = seen.length;
  await act(async () => window.dispatchEvent(new StorageEvent("storage", { key: "unrelated" })));
  expect(seen).toHaveLength(previousCount);

  write.mockRestore();
  localStorage.setItem(key, "remote-choice");
  await act(async () => window.dispatchEvent(new StorageEvent("storage", { key })));
  expect(seen.at(-1)).toBe("remote-choice");
  await act(async () => root.unmount());
});
