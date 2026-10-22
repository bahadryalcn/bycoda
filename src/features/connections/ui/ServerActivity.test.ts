// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { ServerActivity } from "./ServerActivity";
import { bookmarkServerActivity, type ServerRecord } from "../model/serverInventory";
vi.mock("../model/serverInventory", () => ({ bookmarkServerActivity: vi.fn() }));
vi.mock("../../../shared/ui/Timestamp", () => ({
  Timestamp: ({ value }: { value: number }) => createElement("time", null, String(value)),
}));
it("shows launch metadata without executing anything and bookmarks the exact canonical event", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  const root = createRoot(container);
  const server: ServerRecord = {
    id: "server-one",
    name: "One",
    kind: "ssh",
    metadata: {
      tags: [],
      favorite: false,
      activity: [{ id: "launch-one", at: 1, kind: "terminal-opened", bookmarked: false }],
    },
  };
  try {
    await act(async () => root.render(createElement(ServerActivity, { server })));
    expect(bookmarkServerActivity).not.toHaveBeenCalled();
    expect(container.textContent).toContain("Terminal opened");
    await act(async () =>
      container.querySelector<HTMLButtonElement>('[aria-label="Bookmark"]')!.click(),
    );
    expect(bookmarkServerActivity).toHaveBeenCalledExactlyOnceWith(
      "server-one",
      "launch-one",
      true,
    );
  } finally {
    act(() => root.unmount());
    vi.unstubAllGlobals();
  }
});
