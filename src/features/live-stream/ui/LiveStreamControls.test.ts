// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import type { LiveStreamLiveStatus } from "../../../shared/model/host-contracts/live-stream";
import { useLiveStream } from "../hooks/useLiveStream";
import { LiveStreamControls } from "./LiveStreamControls";

const request = vi.hoisted(() => vi.fn());
vi.mock("../model/liveStreamClient", () => ({ liveStreamRequest: request }));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

function Controls() {
  const { accounts, live, feedback } = useLiveStream();
  return createElement(LiveStreamControls, { obs: { configured: true }, accounts, live, feedback });
}

function button(name: string, root: ParentNode = document.body) {
  return Array.from(root.querySelectorAll("button")).find(
    (element) => element.textContent === name || element.getAttribute("aria-label") === name,
  );
}

it("shows uncertain provider state and requires owner acknowledgement before clearing it", async () => {
  const pending: LiveStreamLiveStatus = {
    state: "uncertain",
    canStop: true,
    destinations: [
      {
        accountId: "youtube-studio",
        platform: "youtube",
        label: "Stream Studio",
        orientation: "horizontal",
        state: "failed",
      },
    ],
    reason: "STOP_UNCERTAIN",
    obsStreaming: false,
    needsPlatformConfirmation: true,
  };
  const idle: LiveStreamLiveStatus = {
    state: "idle",
    canStop: false,
    destinations: [],
    managedDestination: true,
  };
  let live = pending;
  request.mockImplementation(async (method: string, params: { platformEnded?: true }) => {
    switch (method) {
      case "liveStream.live.accounts":
        return {
          accounts: [{ accountId: "youtube-studio", platform: "youtube", label: "Stream Studio" }],
        };
      case "liveStream.live.status":
        return live;
      case "liveStream.live.stop":
        if (params.platformEnded) live = idle;
        return live;
      default:
        return null;
    }
  });
  const cache = new QueryClient();
  cache.setQueryData(["liveStream.live.status"], pending);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const confirmationLabel = "Confirm broadcast ended";

  try {
    await act(async () =>
      root.render(createElement(QueryClientProvider, { client: cache }, createElement(Controls))),
    );
    expect(container.textContent).toContain("Check OBS and the platform before trying again.");
    expect(button("Start streaming", container)).toBeUndefined();

    await act(async () => button(confirmationLabel, container)?.click());
    let dialog = document.querySelector('[role="dialog"]');
    expect(dialog?.textContent).toContain(
      "End any live or pending broadcast on the platform before confirming.",
    );
    await act(async () => button("Cancel", dialog!)?.click());
    expect(request).not.toHaveBeenCalledWith("liveStream.live.stop", expect.anything());

    await act(async () => button(confirmationLabel, container)?.click());
    dialog = document.querySelector('[role="dialog"]');
    await act(async () => button(confirmationLabel, dialog!)?.click());
    expect(request).toHaveBeenCalledWith("liveStream.live.stop", { platformEnded: true });
    await act(async () => {
      await vi.waitFor(() => expect(cache.getQueryData(["liveStream.live.status"])).toEqual(idle));
    });
    await vi.waitFor(() =>
      expect(container.textContent).toContain(
        "Save a manual server and key under Stream credentials",
      ),
    );
    expect(button("Start streaming", container)?.getAttribute("aria-disabled")).toBe("true");
  } finally {
    await act(async () => root.unmount());
    container.remove();
    cache.clear();
  }
});
