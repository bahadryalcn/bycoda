// @vitest-environment happy-dom
import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Sequence } from "../../model/outreach";
import { BulkDialog, type BulkDialogProps } from "./BulkDialogs";
import {
  SEGMENT_LIST,
  STATIC_LIST,
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

const people = [
  { id: "p1", tags: ["vip"] },
  { id: "p2", tags: [] },
];

const sequence = {
  id: "seq1",
  name: "Spring follow-up",
  listId: "l9",
  steps: [],
  status: "draft",
  stopOnReply: true,
  pacing: { perHour: 10, perDay: 50, warmupDays: 0 },
  createdAt: 1,
} as Sequence;

function renderDialog(mock: ClientMock, overrides: Partial<BulkDialogProps> = {}) {
  const props: BulkDialogProps = {
    client: asClient(mock),
    action: "list",
    people,
    lists: [STATIC_LIST, SEGMENT_LIST],
    onClose: vi.fn(),
    onDone: vi.fn(),
    ...overrides,
  };
  host.render(createElement(BulkDialog, props));
  return props;
}

describe("BulkDialog list", () => {
  it("states how many people are selected and starts on the first static list", async () => {
    renderDialog(clientMock());
    await flush();
    expect(bodyText()).toContain("2 selected");
    expect(fieldByLabel("List").value).toBe("l1");
    expect(buttonByText("Add to list")?.disabled).toBe(false);
  });

  it("explains that a list must be chosen when no static list exists", async () => {
    renderDialog(clientMock(), { lists: [SEGMENT_LIST] });
    await flush();
    expect(buttonByText("Add to list")?.disabled).toBe(true);
    expect(bodyText()).toContain("Choose a list.");
  });

  it("calls onDone after the action so the table can reload, and switches the footer to Done", async () => {
    const mock = clientMock();
    const props = renderDialog(mock);
    await flush();
    clickButton("Add to list");
    await flush();
    expect(mock.lists.addMembers).toHaveBeenCalledWith({ listId: "l1", personIds: ["p1", "p2"] });
    expect(props.onDone).toHaveBeenCalledTimes(1);
    clickButton("Done");
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });

  it("shows the Host error and stays open when the list cannot be updated", async () => {
    const mock = clientMock({
      lists: {
        ...clientMock().lists,
        addMembers: vi.fn(async () => {
          throw new Error("List is read only.");
        }),
      },
    });
    const props = renderDialog(mock);
    await flush();
    clickButton("Add to list");
    await flush();
    expect(bodyText()).toContain("List is read only.");
    expect(props.onDone).not.toHaveBeenCalled();
    expect(buttonByText("Add to list")).toBeTruthy();
  });

  it("blocks a second press while the first one is still running", async () => {
    const pending = deferred<{ changed: number }>();
    const mock = clientMock({
      lists: { ...clientMock().lists, addMembers: vi.fn(() => pending.promise) },
    });
    renderDialog(mock);
    await flush();
    clickButton("Add to list");
    await flush();
    // A running button stays focusable but is aria-disabled and ignores clicks.
    expect(buttonByText("Add to list")?.getAttribute("aria-disabled")).toBe("true");
    expect(buttonByText("Cancel")?.disabled).toBe(true);
    clickButton("Add to list");
    await flush();
    expect(mock.lists.addMembers).toHaveBeenCalledTimes(1);
    pending.resolve({ changed: 2 });
    await flush();
    expect(bodyText()).toContain("2 updated, 0 could not be updated");
  });
});

describe("BulkDialog tag", () => {
  it("trims the tag and keeps each person's other tags", async () => {
    const mock = clientMock();
    renderDialog(mock, { action: "tag" });
    await flush();
    expect(buttonByText("Add a tag")?.disabled).toBe(true);
    setFieldValue(fieldByLabel("Tag"), "  lead  ");
    clickButton("Add a tag");
    await flush();
    expect(mock.people.update).toHaveBeenCalledWith({
      personId: "p1",
      patch: { tags: ["vip", "lead"] },
    });
    expect(mock.people.update).toHaveBeenCalledWith({ personId: "p2", patch: { tags: ["lead"] } });
  });

  it("does not add a tag the person already has twice", async () => {
    const mock = clientMock();
    renderDialog(mock, { action: "tag", people: [{ id: "p1", tags: ["vip"] }] });
    await flush();
    setFieldValue(fieldByLabel("Tag"), "vip");
    clickButton("Add a tag");
    await flush();
    expect(mock.people.update).toHaveBeenCalledWith({ personId: "p1", patch: { tags: ["vip"] } });
  });
});

describe("BulkDialog sequence", () => {
  it("says the sequence runs for its own list and adds the people to that list", async () => {
    const mock = clientMock({
      sequences: { ...clientMock().sequences, list: vi.fn(async () => ({ items: [sequence] })) },
    });
    renderDialog(mock, { action: "sequence" });
    await flush();
    expect(bodyText()).toContain("so the selected people are added to that list");
    setFieldValue(fieldByLabel("Sequence"), "seq1");
    clickButton("Add to sequence");
    await flush();
    expect(mock.lists.addMembers).toHaveBeenCalledWith({ listId: "l9", personIds: ["p1", "p2"] });
  });

  it("shows the Host error when the sequences cannot be loaded", async () => {
    const mock = clientMock({
      sequences: {
        ...clientMock().sequences,
        list: vi.fn(async () => {
          throw new Error("Sequences are unavailable.");
        }),
      },
    });
    renderDialog(mock, { action: "sequence" });
    await flush();
    expect(bodyText()).toContain("Sequences are unavailable.");
    expect(buttonByText("Add to sequence")?.disabled).toBe(true);
  });
});
