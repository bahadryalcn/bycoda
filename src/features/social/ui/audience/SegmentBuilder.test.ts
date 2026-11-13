// @vitest-environment happy-dom
import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SegmentBuilder } from "./SegmentBuilder";
import {
  asClient,
  bodyText,
  buttonByText,
  clientMock,
  flush,
  mountHost,
  setFieldValue,
  type ClientMock,
  type MountedHost,
} from "./audienceTestKit";

let host: MountedHost;

beforeEach(() => {
  host = mountHost();
});

afterEach(() => {
  host.unmount();
});

function checkboxLabelled(text: string): HTMLInputElement | undefined {
  const label = Array.from(document.querySelectorAll("label")).find(
    (item) => item.textContent?.trim() === text,
  );
  return label?.querySelector("input[type=checkbox]") ?? undefined;
}

describe("SegmentBuilder", () => {
  it("keeps Save disabled until there is a name and at least one condition", async () => {
    const mock: ClientMock = clientMock();
    host.render(
      createElement(SegmentBuilder, {
        client: asClient(mock),
        onClose: vi.fn(),
        onSaved: vi.fn(),
      }),
    );
    await flush();
    expect(buttonByText("Save segment")?.disabled).toBe(true);
    expect(bodyText()).toContain("Enter a name for the segment.");

    setFieldValue(document.querySelector("input")!, "Turkish buyers");
    await flush();
    expect(buttonByText("Save segment")?.disabled).toBe(true);
    expect(bodyText()).toContain("Add at least one condition.");
  });

  it("saves a dynamic list that carries the chosen filter", async () => {
    const mock: ClientMock = clientMock();
    const onSaved = vi.fn();
    const onClose = vi.fn();
    host.render(createElement(SegmentBuilder, { client: asClient(mock), onClose, onSaved }));
    await flush();

    setFieldValue(document.querySelector("input")!, "X buyers");
    const platform = checkboxLabelled("X");
    expect(platform).toBeTruthy();
    platform!.click();
    await flush();

    const save = buttonByText("Save segment");
    expect(save?.disabled).toBe(false);
    save!.click();
    await flush();

    expect(mock.lists.save).toHaveBeenCalledWith({
      name: "X buyers",
      kind: "dynamic",
      filter: { platforms: ["x"] },
      projectIds: [],
    });
    expect(onSaved).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalled();
  });
});
