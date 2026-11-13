// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import type { SocialClient } from "../../model/socialClient";
import { ChromeSessionConnect } from "./ChromeSessionConnect";

function setup(tabs = [{ id: "tab", title: "Owner X", site: "x.com" }]) {
  const client = {
    browserChromeTabs: vi.fn(async () => ({ tabs })),
    browserChromeConnect: vi.fn(async () => ({ status: "connected" })),
  };
  const onChanged = vi.fn();
  const node = document.createElement("div");
  document.body.append(node);
  const root = createRoot(node);
  act(() =>
    root.render(
      createElement(ChromeSessionConnect, {
        client: client as unknown as SocialClient,
        accountId: "account",
        disabled: false,
        onChanged,
      }),
    ),
  );
  const button = (label: string) =>
    [...node.querySelectorAll("button")].find((item) => item.textContent?.trim() === label)!;
  act(() => node.querySelector<HTMLElement>("summary")!.click());
  return {
    client,
    onChanged,
    node,
    button,
    close() {
      act(() => root.unmount());
      node.remove();
    },
  };
}
it("requires explicit consent before discovery and verifies the selected account", async () => {
  const f = setup();
  try {
    expect(f.button("Find Chrome tabs").disabled).toBe(true);
    expect(f.node.textContent).toContain("other tabs and profile data");
    await act(async () =>
      f.node.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click(),
    );
    await act(async () => f.button("Find Chrome tabs").click());
    expect(f.client.browserChromeTabs).toHaveBeenCalledWith("account", true);
    await act(async () => f.button("Connect selected Chrome account").click());
    expect(f.client.browserChromeConnect).toHaveBeenCalledWith("account", "tab", true, undefined);
    expect(f.onChanged).toHaveBeenCalledOnce();
    expect(f.node.textContent).toContain("identity verified");
  } finally {
    f.close();
  }
});
it("keeps denied and empty discovery recoverable without claiming connection", async () => {
  const f = setup([]);
  try {
    await act(async () =>
      f.node.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click(),
    );
    f.client.browserChromeTabs.mockRejectedValueOnce(new Error("Chrome permission denied"));
    await act(async () => f.button("Find Chrome tabs").click());
    expect(f.node.textContent).toContain("Chrome permission denied");
    expect(f.onChanged).not.toHaveBeenCalled();
    await act(async () => f.button("Find Chrome tabs").click());
    expect(f.node.textContent).toContain("No matching platform tabs");
    expect(f.button("Connect selected Chrome account")).toBeUndefined();
  } finally {
    f.close();
  }
});
