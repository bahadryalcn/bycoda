// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { activitySharing, dataTransfers } from "../model/transfers";
import { DataSharingNotices } from "./DataSharingNotices";

it("applies all five active-time choices and shows one daily receipt", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 10, 25, 23, 55));
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const sentModes: string[] = [];
  const send = vi.fn(async () => {
    sentModes.push(activitySharing.load());
  });
  const transfer = (accountId = "account-a") =>
    dataTransfers.run(
      {
        kind: "activity",
        destination: "https://account.test/v1/activity/days",
        files: [{ name: "activity-days.json", text: '{"days":[]}' }],
        linkedToAccount: true,
      },
      activitySharing.load,
      send,
      undefined,
      accountId,
    );
  const click = (label: string) => {
    const button = [...document.querySelectorAll<HTMLElement>('button, [role="menuitem"]')].find(
      (item) => item.textContent?.trim() === label,
    );
    expect(button, label).toBeDefined();
    button!.click();
  };

  const openReview = () => {
    let result: Promise<boolean> | undefined;
    act(() => {
      result = transfer();
    });
    act(() => click("Details"));
    return result;
  };

  try {
    act(() => root.render(createElement(DataSharingNotices)));
    const oneTime = openReview();
    await act(async () => {
      click("Send once");
      expect(await oneTime).toBe(true);
    });
    expect(activitySharing.load()).toBe("ask");
    expect(sentModes).toEqual(["ask"]);
    expect(dataTransfers.receipts()).toHaveLength(1);
    act(() => dataTransfers.clearReceipts());
    await expect(transfer()).resolves.toBe(false);
    expect(dataTransfers.pending()).toBeNull();
    expect(send).toHaveBeenCalledOnce();

    vi.setSystemTime(new Date(2026, 10, 26, 23, 55));
    const today = openReview();
    await act(async () => {
      click("Send for today");
      expect(await today).toBe(true);
    });
    expect(activitySharing.load()).toBe("ask");
    expect(dataTransfers.receipts()).toHaveLength(1);
    act(() => dataTransfers.clearReceipts());
    await act(async () => {
      const following = transfer();
      expect(dataTransfers.pending()).toBeNull();
      await expect(following).resolves.toBe(true);
    });
    expect(dataTransfers.receipts()).toHaveLength(0);

    act(() => {
      void transfer("account-b");
      expect(dataTransfers.pending()).not.toBeNull();
      dataTransfers.accountChanged();
    });

    vi.setSystemTime(new Date(2026, 10, 27, 0, 1));
    const automatic = openReview();
    const save = vi.spyOn(activitySharing, "save").mockReturnValueOnce(false);
    act(() => click("Always send"));
    expect(document.body.textContent).toContain("Could not save changes");
    expect(send).toHaveBeenCalledTimes(3);
    save.mockRestore();
    await act(async () => {
      click("Always send");
      expect(await automatic).toBe(true);
    });
    expect(sentModes).toEqual(["ask", "ask", "ask", "auto"]);
    expect(activitySharing.load()).toBe("auto");
    expect(localStorage.getItem("bycoda.data-sharing.activity")).toBe("auto");
    expect(dataTransfers.receipts()).toHaveLength(1);
    await act(async () => {
      const following = transfer();
      expect(dataTransfers.pending()).toBeNull();
      await expect(following).resolves.toBe(true);
    });
    expect(dataTransfers.receipts()).toHaveLength(1);
    act(() => {
      dataTransfers.clearReceipts();
      activitySharing.save("ask");
    });
    vi.setSystemTime(new Date(2026, 10, 28, 23, 55));
    const later = openReview();
    act(() => click("More options"));
    await act(async () => {
      click("Ask later");
      expect(await later).toBe(false);
    });
    expect(activitySharing.load()).toBe("ask");
    await expect(transfer()).resolves.toBe(false);

    vi.setSystemTime(new Date(2026, 10, 29, 0, 1));
    const never = openReview();
    act(() => click("More options"));
    await act(async () => {
      click("Never send");
      expect(await never).toBe(false);
    });
    expect(localStorage.getItem("bycoda.data-sharing.activity")).toBe("off");
    vi.setSystemTime(new Date(2026, 10, 30, 0, 1));
    await expect(transfer()).resolves.toBe(false);
    expect(dataTransfers.pending()).toBeNull();
    expect(send).toHaveBeenCalledTimes(5);
  } finally {
    act(() => root.unmount());
    dataTransfers.pending()?.decide(false);
    dataTransfers.clearReceipts();
    localStorage.clear();
    container.remove();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  }
});
