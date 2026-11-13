// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { expect, it, vi } from "vitest";
import type { SocialClient } from "../../model/socialClient";
import { SocialChatLiveView } from "./SocialChatLiveView";

vi.mock("../browser/LiveBrowserPanel", () => ({
  LiveBrowserPanel: ({ accountId, onClose }: { accountId: string; onClose(): void }) =>
    createElement("button", { onClick: onClose }, `Live ${accountId}`),
}));

it("loads only on request and opens the chosen browser account in the current project", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const sectionSnapshot = vi.fn(async () => ({
    snapshot: {
      accounts: [
        { id: "browser-1", name: "Studio browser", platform: "x", connection: "browser" },
        { id: "browser-2", name: "Team browser", platform: "linkedin", connection: "browser" },
        { id: "api-1", name: "API account", platform: "x", connection: "oauth" },
      ],
    },
  }));
  const node = document.createElement("div");
  document.body.append(node);
  const root = createRoot(node);
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const click = async (name: string) => {
    let button: HTMLButtonElement | undefined;
    await vi.waitFor(async () => {
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
      button = Array.from(document.querySelectorAll("button")).find(
        (item) => item.textContent === name,
      );
      expect(button, name).toBeTruthy();
    });
    await act(async () => {
      button!.click();
      await new Promise((resolve) => setTimeout(resolve, 5));
    });
  };
  try {
    await act(async () =>
      root.render(
        createElement(
          QueryClientProvider,
          { client: queryClient },
          createElement(SocialChatLiveView, {
            client: { sectionSnapshot } as unknown as SocialClient,
            machineId: "host-2",
            projectId: "project-2",
          }),
        ),
      ),
    );
    expect(sectionSnapshot).not.toHaveBeenCalled();
    await click("Open live view");
    expect(sectionSnapshot).toHaveBeenCalledWith({ section: "accounts", projectId: "project-2" });
    expect(document.body.textContent).not.toContain("API account");
    await click("Team browser");
    expect(document.body.textContent).toContain("Live browser-2");
    await click("Live browser-2");
    expect(document.body.textContent).toContain("Studio browser");
  } finally {
    await act(async () => root.unmount());
    queryClient.clear();
    node.remove();
    vi.unstubAllGlobals();
  }
});
