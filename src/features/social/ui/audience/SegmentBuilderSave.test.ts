// @vitest-environment happy-dom
import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SegmentBuilder } from "./SegmentBuilder";
import {
  asClient,
  bodyText,
  buttonByText,
  clientMock,
  clickButton,
  deferred,
  fieldByLabel,
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

function renderBuilder(mock: ClientMock) {
  const onClose = vi.fn();
  const onSaved = vi.fn();
  host.render(createElement(SegmentBuilder, { client: asClient(mock), onClose, onSaved }));
  return { onClose, onSaved };
}

describe("SegmentBuilder save", () => {
  it("saves the trimmed name with every condition the owner set", async () => {
    const mock = clientMock();
    renderBuilder(mock);
    await flush();
    setFieldValue(fieldByLabel("Segment name"), "  Warm Turkish leads ");
    setFieldValue(fieldByLabel("Language"), "tr");
    setFieldValue(fieldByLabel("Minimum interest score"), "40");
    setFieldValue(fieldByLabel("Name or text contains"), "price");
    clickButton("Save segment");
    await flush();

    expect(mock.lists.save).toHaveBeenCalledWith({
      name: "Warm Turkish leads",
      kind: "dynamic",
      filter: { language: "tr", minScore: 40, query: "price" },
      projectIds: [],
    });
  });

  it("treats a minimum score of zero as a condition", async () => {
    renderBuilder(clientMock());
    await flush();
    setFieldValue(fieldByLabel("Segment name"), "Everyone scored");
    setFieldValue(fieldByLabel("Minimum interest score"), "0");
    expect(buttonByText("Save segment")?.disabled).toBe(false);
  });

  it("stays open with the Host reason and the typed conditions when saving fails", async () => {
    const mock = clientMock({
      lists: {
        ...clientMock().lists,
        save: vi.fn(async () => {
          throw new Error("A segment with this name exists.");
        }),
      },
    });
    const { onClose, onSaved } = renderBuilder(mock);
    await flush();
    setFieldValue(fieldByLabel("Segment name"), "Turkish");
    setFieldValue(fieldByLabel("Language"), "tr");
    clickButton("Save segment");
    await flush();

    expect(bodyText()).toContain("A segment with this name exists.");
    expect(onSaved).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(fieldByLabel("Language").value).toBe("tr");
    expect(buttonByText("Save segment")?.disabled).toBe(false);
  });

  it("does not save twice while the first request is running", async () => {
    const pending = deferred<{ id: string }>();
    const mock = clientMock({
      lists: { ...clientMock().lists, save: vi.fn(() => pending.promise) },
    });
    renderBuilder(mock);
    await flush();
    setFieldValue(fieldByLabel("Segment name"), "Turkish");
    setFieldValue(fieldByLabel("Language"), "tr");
    clickButton("Save segment");
    await flush();
    clickButton("Save segment");
    await flush();
    expect(mock.lists.save).toHaveBeenCalledTimes(1);
    expect(buttonByText("Cancel")?.disabled).toBe(true);
  });
});
