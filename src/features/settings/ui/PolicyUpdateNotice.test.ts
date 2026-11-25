// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import {
  bundledPolicyUpdate,
  policyUpdateStorageKey,
  readPolicyUpdate,
} from "../../../shared/lib/policyUpdates";
import { PolicyUpdateNotice } from "./PolicyUpdateNotice";

vi.mock("../../../shared/lib/policyUpdates", async (importOriginal) => {
  const policy = await importOriginal<typeof import("../../../shared/lib/policyUpdates")>();
  return { ...policy, readPolicyUpdate: vi.fn(() => Promise.resolve(undefined)) };
});

it("shows a newer published revision after the bundled one was dismissed", async () => {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const revision = bundledPolicyUpdate!.revision;
  localStorage.setItem(policyUpdateStorageKey, String(revision));
  vi.mocked(readPolicyUpdate).mockResolvedValueOnce({
    ...bundledPolicyUpdate!,
    revision: revision + 1,
    documents: ["terms"],
    en: "Updated terms from the public repository.",
  });
  try {
    await act(async () => root.render(createElement(PolicyUpdateNotice)));
    expect(document.body.textContent).toContain("Updated terms from the public repository.");
    expect(document.body.textContent).toContain("Terms of use");
  } finally {
    act(() => root.unmount());
    container.remove();
    localStorage.removeItem(policyUpdateStorageKey);
  }
});

it("shows the bundled notice offline and keeps dismissal on this installation", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  localStorage.removeItem(policyUpdateStorageKey);
  try {
    await act(async () => root.render(createElement(PolicyUpdateNotice)));
    expect(document.body.textContent).toContain(bundledPolicyUpdate!.en);
    const dismiss = [...document.querySelectorAll("button")].find(
      (button) => button.textContent === "Dismiss",
    );
    expect(dismiss).toBeDefined();
    await act(async () => dismiss!.click());
    expect(document.body.textContent).not.toContain(bundledPolicyUpdate!.en);
    expect(localStorage.getItem(policyUpdateStorageKey)).toBe(
      String(bundledPolicyUpdate!.revision),
    );
  } finally {
    act(() => root.unmount());
    container.remove();
    localStorage.removeItem(policyUpdateStorageKey);
  }
});
