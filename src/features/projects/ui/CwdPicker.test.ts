// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { CwdPicker } from "./CwdPicker";
vi.mock("../../../shared/ui/Popover", () => ({
  Popover: ({ children }: { children: React.ReactNode }) => createElement("div", null, children),
}));
it("searches beyond the recent preview by path, chooses the filtered keyboard target, and retains new-terminal action", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const onCwdChange = vi.fn(),
    onNewTerminal = vi.fn();
  try {
    await act(async () =>
      root.render(
        createElement(CwdPicker, {
          cwd: "/work/current",
          recents: Array.from({ length: 8 }, (_, i) => ({
            path: `/work/project${i}`,
            lastOpened: i,
          })),
          onCwdChange,
          onNewTerminal,
        }),
      ),
    );
    await act(async () => host.querySelector<HTMLButtonElement>('[aria-haspopup="menu"]')!.click());
    const search = host.querySelector<HTMLInputElement>('[aria-label="Search projects"]')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(
        search,
        "project7",
      );
      search.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(host.textContent).toContain("project7");
    expect(host.textContent).not.toContain("project0");
    await act(async () =>
      search.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })),
    );
    expect(onCwdChange).toHaveBeenCalledWith("/work/project7");
    await act(async () => host.querySelector<HTMLButtonElement>('[aria-haspopup="menu"]')!.click());
    expect(host.querySelector<HTMLInputElement>('[aria-label="Search projects"]')?.value).toBe("");
    await act(async () =>
      [...host.querySelectorAll<HTMLButtonElement>("button")]
        .find((node) => node.textContent?.includes("New terminal"))!
        .click(),
    );
    expect(onNewTerminal).toHaveBeenCalledOnce();
  } finally {
    await act(async () => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  }
});
