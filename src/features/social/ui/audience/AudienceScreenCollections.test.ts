// @vitest-environment happy-dom
import { act, createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CaptureRule, SocialList } from "../../model/audience";
import type { Sequence } from "../../model/outreach";
import type { SocialScreenProps } from "../shell/screens";
import { AudienceScreen } from "./AudienceScreen";
import {
  asClient,
  bodyText,
  buttonByText,
  clickButton,
  clientMock,
  fieldByLabel,
  flush,
  mountHost,
  person,
  setFieldValue,
  type ClientMock,
  type MountedHost,
} from "./audienceTestKit";

type ConfirmRequest = {
  title: string;
  message?: unknown;
  consequences?: unknown[];
  confirmDisabled?: boolean;
  danger?: boolean;
  onConfirm?: () => Promise<void>;
};
// The delete confirmation is a shared dialog; the test answers it the way it would: run onConfirm, then resolve.
const confirm = vi.fn(async (request: ConfirmRequest) => {
  if (request.confirmDisabled) return false;
  await request.onConfirm?.();
  return true;
});
vi.mock("../../../../shared/ui/ConfirmDialog", () => ({
  useConfirm: () => ({ confirm, dialog: null }),
}));

let host: MountedHost;
let rows: SocialList[];

const buyers = {
  id: "l1",
  name: "Buyers",
  kind: "static",
  projectIds: ["project-9"],
  createdAt: 11,
} as SocialList;
const turkish = {
  id: "s1",
  name: "Turkish",
  kind: "dynamic",
  filter: { language: "tr", stages: ["new"] },
  projectIds: ["project-9"],
  createdAt: 12,
} as SocialList;
const commenters = {
  id: "lc",
  name: "Commenters",
  kind: "static",
  projectIds: [],
  system: "commenters",
  createdAt: 1,
} as SocialList;

const ada = person({ id: "p1", name: "Ada" });
const grace = person({ id: "p2", name: "Grace" });

const rule = {
  id: "r1",
  name: "Launch hashtag",
  enabled: true,
  source: { kind: "hashtag", accountId: "acc1", query: "launch" },
  filter: {},
  targetListId: "l1",
  createdAt: 1,
} as CaptureRule;

const sequence = {
  id: "seq1",
  name: "Spring follow-up",
  listId: "l1",
  steps: [],
  status: "active",
  stopOnReply: true,
  pacing: { perHour: 10, perDay: 50, warmupDays: 0 },
  createdAt: 1,
} as Sequence;

/** Lists behave like the Host: saving replaces a row with the same id, deleting drops it. */
function render(overrides: Record<string, unknown> = {}): ClientMock {
  const base = clientMock();
  const mock = clientMock({
    lists: {
      ...base.lists,
      list: vi.fn(async () => ({ items: [...rows] })),
      save: vi.fn(async (input: Record<string, unknown>) => {
        const row = { createdAt: 1, ...input } as unknown as SocialList;
        const at = rows.findIndex((item) => item.id === row.id);
        if (at >= 0) rows[at] = { ...rows[at]!, ...row };
        else rows.push(row);
        return row;
      }),
      delete: vi.fn(async (id: string) => {
        rows = rows.filter((item) => item.id !== id);
        return { deleted: true };
      }),
    },
    people: { ...base.people, list: vi.fn(async () => ({ items: [ada, grace] })) },
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
  return mock;
}

async function loaded() {
  await flush();
  await flush();
}

function open(name: string) {
  act(() => buttonByText(name)!.click());
}

beforeEach(() => {
  host = mountHost();
  rows = [buyers, turkish, commenters];
  confirm.mockClear();
});

afterEach(() => {
  host.unmount();
});

describe("AudienceScreen collection header", () => {
  it("names the open segment, its kind and its conditions in plain words", async () => {
    render();
    await loaded();
    open("Turkish");
    await loaded();
    const heading = document.querySelector("h2")!;
    expect(heading.textContent).toBe("Turkish");
    expect(bodyText()).toContain("Segment");
    expect(bodyText()).toContain("Language tr; Stage New");
    expect(buttonByText("Edit segment")).toBeDefined();
    expect(buttonByText("Delete")).toBeDefined();
  });

  it("protects the Commenters list: no rename or delete, and the page says why", async () => {
    render();
    await loaded();
    open("CommentersAutomatic");
    await loaded();
    expect(bodyText()).toContain("Filled by the Commenters rule. It cannot be renamed or deleted.");
    expect(buttonByText("Rename")).toBeUndefined();
    expect(buttonByText("Delete")).toBeUndefined();
  });

  it("shows no people count, because the Host answers in pages without a total", async () => {
    render();
    await loaded();
    open("Buyers");
    await loaded();
    expect(document.querySelector("header")?.textContent ?? "").not.toMatch(/\d+ people/);
  });
});

describe("AudienceScreen renaming a list", () => {
  it("saves under the same id, keeps the hidden project scope and keeps the list open", async () => {
    const mock = render();
    await loaded();
    open("Buyers");
    await loaded();
    clickButton("Rename");
    expect(fieldByLabel("List name").value).toBe("Buyers");

    setFieldValue(fieldByLabel("List name"), "  Customers ");
    clickButton("Save name");
    await loaded();

    expect(mock.lists.save).toHaveBeenCalledWith({
      id: "l1",
      name: "Customers",
      kind: "static",
      projectIds: ["project-9"],
    });
    expect(buttonByText("Customers")?.getAttribute("aria-current")).toBe("true");
    expect(buttonByText("Buyers")).toBeUndefined();
  });

  it("keeps the dialog and the typed name when the Host refuses", async () => {
    const mock = render();
    mock.lists.save.mockRejectedValueOnce(new Error("A list with this name exists."));
    await loaded();
    open("Buyers");
    await loaded();
    clickButton("Rename");
    setFieldValue(fieldByLabel("List name"), "Customers");
    clickButton("Save name");
    await loaded();
    expect(bodyText()).toContain("A list with this name exists.");
    expect(fieldByLabel("List name").value).toBe("Customers");
    expect(buttonByText("Buyers")).toBeDefined();
  });
});

describe("AudienceScreen editing a segment", () => {
  it("changes the conditions and keeps id, kind and project scope", async () => {
    const mock = render();
    await loaded();
    open("Turkish");
    await loaded();
    clickButton("Edit segment");
    expect(fieldByLabel("Segment name").value).toBe("Turkish");
    expect(fieldByLabel("Language").value).toBe("tr");

    setFieldValue(fieldByLabel("Language"), "de");
    clickButton("Save segment");
    await loaded();

    expect(mock.lists.save).toHaveBeenCalledWith({
      id: "s1",
      name: "Turkish",
      kind: "dynamic",
      filter: { language: "de", stages: ["new"] },
      projectIds: ["project-9"],
    });
    expect(mock.people.list).toHaveBeenLastCalledWith({
      filter: { language: "de", stages: ["new"] },
      limit: 100,
    });
  });

  it("does not save a segment whose conditions were all removed", async () => {
    const mock = render();
    await loaded();
    open("Turkish");
    await loaded();
    clickButton("Edit segment");
    setFieldValue(fieldByLabel("Language"), "");
    act(() => {
      for (const box of document.querySelectorAll<HTMLInputElement>("input[type=checkbox]"))
        if (box.checked) box.click();
    });
    expect(buttonByText("Save segment")?.disabled).toBe(true);
    expect(bodyText()).toContain("Add at least one condition.");
    expect(mock.lists.save).not.toHaveBeenCalled();
  });
});

describe("AudienceScreen deleting a list", () => {
  it("says people are kept, deletes through the Host and returns to everyone", async () => {
    const mock = render();
    await loaded();
    open("Buyers");
    await loaded();
    clickButton("Delete");
    await loaded();

    const request = confirm.mock.calls[0]![0];
    expect(request.title).toBe("Delete this list?");
    expect(JSON.stringify(request.consequences)).toContain("The people in it are not deleted");
    expect(mock.lists.delete).toHaveBeenCalledWith("l1");
    expect(mock.people.delete).not.toHaveBeenCalled();
    expect(buttonByText("Buyers")).toBeUndefined();
    expect(buttonByText("All people")?.getAttribute("aria-current")).toBe("true");
    expect(bodyText()).toContain("Deleted Buyers.");
  });

  it("says a segment delete removes only the saved conditions", async () => {
    render();
    await loaded();
    open("Turkish");
    await loaded();
    clickButton("Delete");
    await loaded();
    expect(confirm.mock.calls[0]![0].title).toBe("Delete this segment?");
    expect(JSON.stringify(confirm.mock.calls[0]![0].consequences)).toContain(
      "No person is deleted",
    );
  });

  it("refuses while a capture rule fills the list and names the rule", async () => {
    const mock = render({
      captureRules: { ...clientMock().captureRules, list: vi.fn(async () => ({ items: [rule] })) },
    });
    await loaded();
    open("Buyers");
    await loaded();
    clickButton("Delete");
    await loaded();

    const request = confirm.mock.calls[0]![0];
    expect(request.title).toBe("Buyers is still in use");
    expect(request.confirmDisabled).toBe(true);
    expect(JSON.stringify(request.consequences)).toContain(
      "Capture rule Launch hashtag adds people",
    );
    expect(mock.lists.delete).not.toHaveBeenCalled();
    expect(buttonByText("Buyers")).toBeDefined();
  });

  it("refuses while an unfinished sequence runs for the list, but not a finished one", async () => {
    const mock = render({
      sequences: {
        ...clientMock().sequences,
        list: vi.fn(async () => ({ items: [sequence] })),
      },
    });
    await loaded();
    open("Buyers");
    await loaded();
    clickButton("Delete");
    await loaded();
    expect(confirm.mock.calls[0]![0].title).toBe("Buyers is still in use");
    expect(JSON.stringify(confirm.mock.calls[0]![0].consequences)).toContain(
      "Sequence Spring follow-up sends to this list.",
    );
    expect(mock.lists.delete).not.toHaveBeenCalled();

    host.unmount();
    host = mountHost();
    confirm.mockClear();
    const second = render({
      sequences: {
        ...clientMock().sequences,
        list: vi.fn(async () => ({ items: [{ ...sequence, status: "done" }] })),
      },
    });
    await loaded();
    open("Buyers");
    await loaded();
    clickButton("Delete");
    await loaded();
    expect(second.lists.delete).toHaveBeenCalledWith("l1");
  });

  it("does not delete when the rules and sequences cannot be read", async () => {
    const mock = render({
      captureRules: {
        ...clientMock().captureRules,
        list: vi.fn(async () => {
          throw new Error("Rules are unavailable.");
        }),
      },
    });
    await loaded();
    open("Buyers");
    await loaded();
    clickButton("Delete");
    await loaded();
    expect(bodyText()).toContain("Rules are unavailable.");
    expect(confirm).not.toHaveBeenCalled();
    expect(mock.lists.delete).not.toHaveBeenCalled();
    expect(buttonByText("Buyers")).toBeDefined();
  });

  it("keeps the list and shows the Host reason when the Host refuses the delete", async () => {
    const mock = render();
    mock.lists.delete.mockRejectedValueOnce(
      new Error('The capture rule "X" adds people to this list.'),
    );
    await loaded();
    open("Buyers");
    await loaded();
    clickButton("Delete");
    await loaded();
    expect(bodyText()).toContain('The capture rule "X" adds people to this list.');
    expect(buttonByText("Buyers")).toBeDefined();
    expect(bodyText()).not.toContain("Deleted Buyers.");
  });
});

describe("AudienceScreen empty results", () => {
  it("tells an empty list apart from a search without matches and offers a way out", async () => {
    render({ people: { ...clientMock().people, list: vi.fn(async () => ({ items: [] })) } });
    await loaded();
    open("Buyers");
    await loaded();
    expect(bodyText()).toContain("This list is empty.");
    expect(bodyText()).not.toContain("No one matches");
    clickButton("Show all people");
    await loaded();
    expect(buttonByText("All people")?.getAttribute("aria-current")).toBe("true");
  });

  it("offers to edit the conditions when a segment matches nobody", async () => {
    render({ people: { ...clientMock().people, list: vi.fn(async () => ({ items: [] })) } });
    await loaded();
    open("Turkish");
    await loaded();
    expect(bodyText()).toContain("No one matches this segment yet.");
    const edits = Array.from(document.querySelectorAll("button")).filter(
      (button) => button.textContent?.trim() === "Edit segment",
    );
    expect(edits.length).toBe(2);
  });
});

describe("AudienceScreen selection", () => {
  it("says so when a search clears the selected people", async () => {
    render();
    await loaded();
    act(() => document.querySelector<HTMLInputElement>('input[aria-label="Select Ada"]')!.click());
    expect(bodyText()).toContain("1 selected");

    const search = document.querySelector<HTMLInputElement>('input[aria-label="Search people"]')!;
    setFieldValue(search, "gra");
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 400));
    });
    await flush();
    expect(bodyText()).toContain("Selection cleared because the search changed.");
    expect(bodyText()).not.toContain("1 selected");
  });

  it("says so when opening another list drops the selection", async () => {
    render();
    await loaded();
    act(() => document.querySelector<HTMLInputElement>('input[aria-label="Select Ada"]')!.click());
    open("Buyers");
    await loaded();
    expect(bodyText()).toContain("Selection cleared because you opened another list.");
  });

  it("does not announce anything when nothing was selected", async () => {
    render();
    await loaded();
    open("Buyers");
    await loaded();
    expect(bodyText()).not.toContain("Selection cleared");
  });
});
