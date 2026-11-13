// @vitest-environment happy-dom
import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ListDialog } from "./ListDialog";
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

function renderDialog(mock: ClientMock) {
  const onClose = vi.fn();
  const onSaved = vi.fn();
  host.render(createElement(ListDialog, { client: asClient(mock), onClose, onSaved }));
  return { onClose, onSaved };
}

describe("ListDialog", () => {
  it("keeps Create disabled with the reason until the list has a name", async () => {
    renderDialog(clientMock());
    await flush();
    expect(buttonByText("Create list")?.disabled).toBe(true);
    expect(bodyText()).toContain("Enter a name for the list.");
    setFieldValue(fieldByLabel("List name"), "   ");
    expect(buttonByText("Create list")?.disabled).toBe(true);
  });

  it("saves a static list with the trimmed name, reports it and closes", async () => {
    const mock = clientMock();
    const { onClose, onSaved } = renderDialog(mock);
    await flush();
    setFieldValue(fieldByLabel("List name"), "  Buyers  ");
    clickButton("Create list");
    await flush();
    expect(mock.lists.save).toHaveBeenCalledWith({
      name: "Buyers",
      kind: "static",
      projectIds: [],
    });
    expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({ id: "l-new", name: "Buyers" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("stays open with the Host reason and the typed name when saving fails", async () => {
    const mock = clientMock({
      lists: {
        ...clientMock().lists,
        save: vi.fn(async () => {
          throw new Error("A list with this name exists.");
        }),
      },
    });
    const { onClose, onSaved } = renderDialog(mock);
    await flush();
    setFieldValue(fieldByLabel("List name"), "Buyers");
    clickButton("Create list");
    await flush();
    expect(bodyText()).toContain("A list with this name exists.");
    expect(onSaved).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(fieldByLabel("List name").value).toBe("Buyers");
  });

  it("does not save twice while the first request is running", async () => {
    const pending = deferred<{ id: string; name: string }>();
    const mock = clientMock({
      lists: { ...clientMock().lists, save: vi.fn(() => pending.promise) },
    });
    renderDialog(mock);
    await flush();
    setFieldValue(fieldByLabel("List name"), "Buyers");
    clickButton("Create list");
    await flush();
    clickButton("Create list");
    await flush();
    expect(mock.lists.save).toHaveBeenCalledTimes(1);
    expect(buttonByText("Cancel")?.disabled).toBe(true);
  });
});
