// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { activitySharing, dataTransfers } from "../model/transfers";
import { DataSharingNotices } from "./DataSharingNotices";

it("can send active time once or save automatic sharing before sending", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const sentModes: string[] = [];
  const send = vi.fn(async () => {
    sentModes.push(activitySharing.load());
  });
  const click = (label: string) => {
    const button = [...document.querySelectorAll("button")].find(
      (item) => item.textContent?.trim() === label,
    );
    expect(button, label).toBeDefined();
    button!.click();
  };

  const openReview = () => {
    let result: Promise<boolean> | undefined;
    act(() => {
      result = dataTransfers.run(
        {
          kind: "activity",
          destination: "https://account.test/v1/activity/days",
          files: [{ name: "activity-days.json", text: '{"days":[]}' }],
          linkedToAccount: true,
        },
        activitySharing.load,
        send,
      );
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
    act(() => dataTransfers.clearReceipts());

    const automatic = openReview();
    const save = vi.spyOn(activitySharing, "save").mockReturnValueOnce(false);
    act(() => click("Always send"));
    expect(document.body.textContent).toContain("Could not save changes");
    expect(send).toHaveBeenCalledOnce();
    save.mockRestore();
    await act(async () => {
      click("Always send");
      expect(await automatic).toBe(true);
    });
    expect(sentModes).toEqual(["ask", "auto"]);
    expect(activitySharing.load()).toBe("auto");
  } finally {
    act(() => root.unmount());
    dataTransfers.pending()?.decide(false);
    dataTransfers.clearReceipts();
    localStorage.clear();
    container.remove();
    vi.unstubAllGlobals();
  }
});
