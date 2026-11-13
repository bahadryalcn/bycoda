// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { AccountExternalLink } from "./AccountExternalLink";
const mocks = vi.hoisted(() => ({ open: vi.fn(), copy: vi.fn() }));
vi.mock("../../../platform/tauri/openExternal", () => ({ openExternal: mocks.open }));
vi.mock("../../../platform/tauri/clipboard", () => ({ copyText: mocks.copy }));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
it("guards pending opens, exposes real URL, handles clipboard failure and retries", async () => {
  let fail!: (error: Error) => void;
  mocks.open
    .mockImplementationOnce(
      () =>
        new Promise((_, reject) => {
          fail = reject;
        }),
    )
    .mockResolvedValue(undefined);
  mocks.copy.mockRejectedValue(new Error("clipboard unavailable"));
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const button = (name: string) =>
    [...container.querySelectorAll("button")].find((node) => node.textContent === name)!;
  try {
    await act(async () =>
      root.render(
        createElement(AccountExternalLink, {
          url: "https://example.test/project",
          label: "Read more",
        }),
      ),
    );
    const open = button("Read more");
    await act(async () => {
      open.click();
      open.click();
    });
    expect(mocks.open).toHaveBeenCalledOnce();
    await act(async () => fail(new Error("offline")));
    expect(container.textContent).toContain("https://example.test/project");
    await act(async () => button("Copy").click());
    expect(container.textContent).toContain("Could not copy.");
    mocks.copy.mockResolvedValue(undefined);
    button("Copy").focus();
    await act(async () => button("Copy").click());
    expect(container.textContent).toContain("Copied");
    expect(document.activeElement).toBe(open);
    await act(async () => button("Read more").click());
    expect(mocks.open).toHaveBeenCalledTimes(2);
    expect(container.querySelector('[role="alert"]')).toBeNull();
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});
