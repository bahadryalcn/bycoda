// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { ApprovalRequest, type ApprovalRequestProps } from "./ApprovalRequest";

const clipboard = vi.hoisted(() => ({ copyText: vi.fn(async (_text: string) => {}) }));
vi.mock("../../platform/tauri/clipboard", () => ({ copyText: clipboard.copyText }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let cleanup: (() => void) | undefined;
afterEach(() => cleanup?.());
function mount(overrides: Partial<ApprovalRequestProps> = {}) {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const allow = vi.fn();
  const deny = vi.fn();
  const always = vi.fn();
  act(() =>
    root.render(
      createElement(ApprovalRequest, {
        title: "Needs approval",
        detail: "echo <exact>\nsecond line",
        allow: { label: "Allow", onClick: allow },
        deny: { label: "Deny", onClick: deny },
        actions: [{ label: "Always", onClick: always }],
        ...overrides,
      }),
    ),
  );
  cleanup = () => {
    act(() => root.unmount());
    host.remove();
  };
  return { host, allow, deny, always };
}
const decisionButtons = (host: HTMLElement) =>
  host.querySelectorAll<HTMLButtonElement>("section > div:last-child button");
it("keeps exact request on the shared code ground and Allow as the sole primary", () => {
  const { host, allow, deny, always } = mount();
  expect(host.querySelector("pre")?.textContent).toBe("echo <exact>\nsecond line");
  expect(host.querySelector("pre")?.getAttribute("data-frame")).toBe("filled");
  expect(host.querySelectorAll('[data-button-variant="primary"]')).toHaveLength(1);
  const buttons = decisionButtons(host);
  expect([...buttons].map((button) => button.textContent)).toEqual(["Always", "Deny", "Allow"]);
  expect(host.querySelector('[data-button-variant="primary"]')?.textContent).toBe("Allow");
  act(() => buttons.forEach((button) => button.click()));
  expect(allow).toHaveBeenCalledOnce();
  expect(deny).toHaveBeenCalledOnce();
  expect(always).toHaveBeenCalledOnce();
  expect(host.querySelector("[aria-hidden] svg")).not.toBeNull();
});
it("preserves caller-owned pending and disabled state and details disclosure", () => {
  const allow = vi.fn();
  const deny = vi.fn();
  const { host } = mount({
    allow: { label: "Allow", onClick: allow, pending: true },
    deny: { label: "Deny", onClick: deny, disabled: true },
    details: { label: "Details", content: "Full request context" },
  });
  expect(host.querySelector("details")?.open).toBe(false);
  expect(host.querySelector("details")?.textContent).toContain("Full request context");
  const [always, denyButton, allowButton] = decisionButtons(host);
  expect(always.textContent).toBe("Always");
  expect(allowButton.getAttribute("aria-busy")).toBe("true");
  expect(denyButton.disabled).toBe(true);
  act(() => {
    allowButton.click();
    denyButton.click();
  });
  expect(allow).not.toHaveBeenCalled();
  expect(deny).not.toHaveBeenCalled();
});
it("copies the exact request and toggles line wrapping from its corner", async () => {
  const { host } = mount();
  const copy = host.querySelector<HTMLButtonElement>('button[aria-label="Copy"]')!;
  const wrap = host.querySelector<HTMLButtonElement>('button[aria-label="Wrap lines"]')!;
  await act(async () => copy.click());
  expect(clipboard.copyText).toHaveBeenCalledExactlyOnceWith("echo <exact>\nsecond line");
  expect(host.querySelector("pre")?.getAttribute("data-wrap")).toBeNull();
  act(() => wrap.click());
  expect(host.querySelector("pre")?.getAttribute("data-wrap")).toBe("false");
  act(() => wrap.click());
});
it("shows where and how far the decision reaches above the request", () => {
  const { host } = mount({ context: ["/repo", "This request only"] });
  expect(
    [...host.querySelectorAll('[data-wrap="anywhere"]')].map((line) => line.textContent),
  ).toEqual(["/repo", "This request only"]);
});

it("keeps the approval name and decision context in a compact row", () => {
  const { host } = mount({
    appearance: "compact",
    path: "/repo/worktree",
    scope: "This request only",
  });
  const section = host.querySelector("section");
  expect(section?.getAttribute("aria-label")).toBe("Needs approval");
  expect(section?.textContent).not.toContain("Needs approval");
  expect(section?.textContent).toContain("/repo/worktree");
  expect(section?.textContent).toContain("This request only");
  expect(section?.querySelector('[data-button-variant="primary"]')?.textContent).toBe("Allow");
});
