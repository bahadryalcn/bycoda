// @vitest-environment happy-dom
import { act, createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SocialPerson } from "../../model/audience";
import type { Sequence } from "../../model/outreach";
import type { SocialScreenProps } from "../shell/screens";
import { AudienceScreen } from "./AudienceScreen";
import {
  SEGMENT_LIST,
  STATIC_LIST,
  asClient,
  bodyText,
  buttonByText,
  clientMock,
  clickButton,
  clickMenuItem,
  deferred,
  fieldByLabel,
  flush,
  menuItem,
  mountHost,
  person,
  setFieldValue,
  type ClientMock,
  type MountedHost,
} from "./audienceTestKit";

// The opt-out confirmation is a shared dialog; the test answers it directly.
const confirm = vi.fn(async (_request: { title: string; danger?: boolean }) => true);
vi.mock("../../../../shared/ui/ConfirmDialog", () => ({
  useConfirm: () => ({ confirm, dialog: null }),
}));

let host: MountedHost;
let mock: ClientMock;

const ada = person({ id: "p1", name: "Ada", tags: ["vip"] });
const grace = person({ id: "p2", name: "Grace", tags: [] });

const springSequence = {
  id: "seq1",
  name: "Spring follow-up",
  listId: "l9",
  steps: [],
  status: "draft",
  stopOnReply: true,
  pacing: { perHour: 10, perDay: 50, warmupDays: 0 },
  createdAt: 1,
} as Sequence;

function render(overrides: Record<string, unknown> = {}) {
  mock = clientMock({
    lists: {
      ...clientMock().lists,
      list: vi.fn(async () => ({ items: [STATIC_LIST, SEGMENT_LIST] })),
    },
    people: {
      ...clientMock().people,
      list: vi.fn(async () => ({ items: [ada, grace] })),
    },
    ...overrides,
  });
  const props: SocialScreenProps = {
    client: asClient(mock),
    machineId: "m1",
    shellState: { hostOnline: true, unreachable: false, aiStopped: false },
    active: true,
    onNavigate: vi.fn(),
  };
  host.render(createElement(AudienceScreen, props));
}

async function loaded() {
  await flush();
  await flush();
}

function personBox(name: string): HTMLInputElement {
  const box = document.querySelector<HTMLInputElement>(`input[aria-label="Select ${name}"]`);
  if (!box) throw new Error(`No checkbox for ${name}`);
  return box;
}

function select(...names: string[]) {
  for (const name of names) act(() => personBox(name).click());
}

function openBulk(item: string) {
  clickButton("Actions");
  clickMenuItem(item);
}

beforeEach(() => {
  host = mountHost();
  confirm.mockClear();
  confirm.mockImplementation(async () => true);
});

afterEach(() => {
  host.unmount();
});

describe("AudienceScreen bulk selection", () => {
  it("shows the bulk menu only once someone is selected and clears the selection on request", async () => {
    render();
    await loaded();
    expect(buttonByText("Actions")).toBeUndefined();

    select("Ada", "Grace");
    expect(bodyText()).toContain("2 selected");
    expect(buttonByText("Actions")).toBeTruthy();

    clickButton("Clear selection");
    expect(bodyText()).not.toContain("2 selected");
    expect(buttonByText("Actions")).toBeUndefined();
  });

  it("drops the selection when another list is opened", async () => {
    render();
    await loaded();
    select("Ada");
    expect(bodyText()).toContain("1 selected");

    clickButton("Buyers");
    await loaded();
    expect(bodyText()).not.toContain("1 selected");
  });
});

describe("AudienceScreen bulk tag", () => {
  it("adds the tag to each selected person and keeps the tags they already have", async () => {
    render();
    await loaded();
    select("Ada", "Grace");
    openBulk("Add a tag…");

    expect(buttonByText("Add a tag")?.disabled).toBe(true);
    expect(bodyText()).toContain("Enter the tag to add.");
    setFieldValue(fieldByLabel("Tag"), "lead");
    clickButton("Add a tag");
    await loaded();

    expect(mock.people.update).toHaveBeenCalledWith({
      personId: "p1",
      patch: { tags: ["vip", "lead"] },
    });
    expect(mock.people.update).toHaveBeenCalledWith({ personId: "p2", patch: { tags: ["lead"] } });
    expect(bodyText()).toContain("2 updated, 0 could not be updated");
    // The table reloads after the action.
    expect(mock.people.list.mock.calls.length).toBeGreaterThan(1);
  });

  it("names the people who could not be updated and the Host reason, without hiding the ones that worked", async () => {
    render({
      people: {
        ...clientMock().people,
        list: vi.fn(async () => ({ items: [ada, grace] })),
        update: vi.fn(async (input: { personId: string; patch: Partial<SocialPerson> }) => {
          if (input.personId === "p2") throw new Error("Rate limit reached.");
          return person({ id: input.personId, ...input.patch });
        }),
      },
    });
    await loaded();
    select("Ada", "Grace");
    openBulk("Add a tag…");
    setFieldValue(fieldByLabel("Tag"), "lead");
    clickButton("Add a tag");
    await loaded();

    expect(bodyText()).toContain("1 updated, 1 could not be updated");
    expect(bodyText()).toContain("Rate limit reached.");
    // After a result the action cannot run a second time; the footer offers Done.
    expect(buttonByText("Done")).toBeTruthy();
    expect(buttonByText("Add a tag")).toBeUndefined();
  });
});

describe("AudienceScreen bulk list and sequence", () => {
  it("adds the selected people to a static list and never offers a segment as a target", async () => {
    render();
    await loaded();
    select("Ada");
    openBulk("Add to list…");

    const listField = fieldByLabel("List") as HTMLSelectElement;
    const optionLabels = Array.from(listField.options).map((option) => option.textContent);
    expect(optionLabels).toContain("Buyers");
    expect(optionLabels).not.toContain("Turkish");

    clickButton("Add to list");
    await loaded();
    expect(mock.lists.addMembers).toHaveBeenCalledWith({ listId: "l1", personIds: ["p1"] });
    expect(bodyText()).toContain("1 updated, 0 could not be updated");
  });

  it("puts people into a sequence by adding them to the sequence's own list", async () => {
    render({
      sequences: {
        ...clientMock().sequences,
        list: vi.fn(async () => ({ items: [springSequence] })),
      },
    });
    await loaded();
    select("Ada", "Grace");
    openBulk("Add to sequence…");
    await flush();

    expect(buttonByText("Add to sequence")?.disabled).toBe(true);
    expect(bodyText()).toContain("Choose a sequence.");
    setFieldValue(fieldByLabel("Sequence"), "seq1");
    expect(buttonByText("Add to sequence")?.disabled).toBe(false);
    clickButton("Add to sequence");
    await loaded();

    expect(mock.lists.addMembers).toHaveBeenCalledWith({ listId: "l9", personIds: ["p1", "p2"] });
  });

  it("offers Remove from this list only inside a static list and removes just the selected people", async () => {
    render();
    await loaded();
    select("Ada");
    clickButton("Actions");
    expect(menuItem("Remove from this list")).toBeUndefined();

    // Opening a list clears the selection, which also closes the menu.
    clickButton("Buyers");
    await loaded();
    expect(mock.people.list).toHaveBeenLastCalledWith({ listId: "l1", limit: 100 });
    select("Ada");
    clickButton("Actions");
    clickMenuItem("Remove from this list");
    await loaded();

    expect(mock.lists.removeMembers).toHaveBeenCalledWith({ listId: "l1", personIds: ["p1"] });
    expect(bodyText()).toContain("1 removed from Buyers");
  });
});

describe("AudienceScreen opt-out", () => {
  it("asks first, then records a manual opt-out on every channel for each selected person", async () => {
    render();
    await loaded();
    select("Ada", "Grace");
    openBulk("Stop contacting…");
    await loaded();

    expect(confirm).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Stop contacting these people?", danger: true }),
    );
    expect(mock.suppressions.add).toHaveBeenCalledTimes(2);
    expect(mock.suppressions.add).toHaveBeenCalledWith({
      personId: "p1",
      channel: "all",
      reason: "manual",
    });
    expect(mock.suppressions.add).toHaveBeenCalledWith({
      personId: "p2",
      channel: "all",
      reason: "manual",
    });
    expect(bodyText()).toContain("2 people opted out, 0 could not be updated");
  });

  it("sends nothing when the owner declines the confirmation", async () => {
    confirm.mockImplementation(async () => false);
    render();
    await loaded();
    select("Ada");
    openBulk("Stop contacting…");
    await loaded();

    expect(confirm).toHaveBeenCalledTimes(1);
    expect(mock.suppressions.add).not.toHaveBeenCalled();
    expect(bodyText()).not.toContain("opted out");
  });

  it("counts a refused opt-out as not updated instead of reporting success", async () => {
    render({
      suppressions: {
        add: vi.fn(async (input: Record<string, unknown>) => {
          if (input.personId === "p2") throw new Error("Host refused.");
          return { id: "x", ...input };
        }),
      },
    });
    await loaded();
    select("Ada", "Grace");
    openBulk("Stop contacting…");
    await loaded();
    expect(bodyText()).toContain("1 people opted out, 1 could not be updated");
  });
});

describe("AudienceScreen list scope", () => {
  it("evaluates a segment from its own filter and keeps a search inside it", async () => {
    render();
    await loaded();
    clickButton("Turkish");
    await loaded();
    expect(mock.people.list).toHaveBeenLastCalledWith({ filter: { language: "tr" }, limit: 100 });

    const search = document.querySelector<HTMLInputElement>('input[aria-label="Search people"]');
    expect(search).toBeTruthy();
    setFieldValue(search!, "ada");
    // The search waits for a pause in typing before it asks the Host.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 400));
    });
    await flush();
    expect(mock.people.list).toHaveBeenLastCalledWith({
      filter: { language: "tr", query: "ada" },
      limit: 100,
    });
  });

  it("drops an answer for a list that is no longer open", async () => {
    const slow = deferred<{ items: SocialPerson[] }>();
    let allCalls = 0;
    render({
      people: {
        ...clientMock().people,
        list: vi.fn(async (input: { listId?: string }) => {
          if (input.listId === "l1") return slow.promise;
          allCalls += 1;
          return { items: [allCalls === 1 ? ada : grace] };
        }),
      },
    });
    await loaded();
    expect(bodyText()).toContain("Ada");

    clickButton("Buyers");
    await flush();
    clickButton("All people");
    await loaded();
    expect(bodyText()).toContain("Grace");

    slow.resolve({ items: [person({ id: "p9", name: "Zed" })] });
    await loaded();
    expect(bodyText()).toContain("Grace");
    expect(bodyText()).not.toContain("Zed");
  });

  it("loads the next page with the cursor and the same scope", async () => {
    const list = vi
      .fn()
      .mockResolvedValueOnce({ items: [ada], next: "cursor-2" })
      .mockResolvedValueOnce({ items: [grace] });
    render({ people: { ...clientMock().people, list } });
    await loaded();
    expect(bodyText()).not.toContain("Grace");

    clickButton("Load more people");
    await loaded();
    expect(list).toHaveBeenLastCalledWith({ cursor: "cursor-2", limit: 100 });
    expect(bodyText()).toContain("Ada");
    expect(bodyText()).toContain("Grace");
    expect(buttonByText("Load more people")).toBeUndefined();
  });

  it("shows the Host error with a retry that asks again", async () => {
    const list = vi
      .fn()
      .mockRejectedValueOnce(new Error("Host is busy."))
      .mockResolvedValueOnce({ items: [ada] });
    render({ people: { ...clientMock().people, list } });
    await loaded();
    expect(bodyText()).toContain("Host is busy.");

    clickButton("Try again");
    await loaded();
    expect(bodyText()).toContain("Ada");
    expect(bodyText()).not.toContain("Host is busy.");
  });
});
