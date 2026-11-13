// @vitest-environment happy-dom
import { act, createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SocialList, SocialPerson } from "../../model/audience";
import type { SocialScreenProps } from "../shell/screens";
import { AudienceScreen } from "./AudienceScreen";
import {
  STATIC_LIST,
  asClient,
  bodyText,
  buttonByText,
  buttonsByText,
  clickButton,
  clickMenuItem,
  clientMock,
  deferred,
  fieldByLabel,
  flush,
  mountHost,
  person,
  pickOption,
  setFieldValue,
  tabByText,
  type MountedHost,
} from "./audienceTestKit";

// Deleting a person waits for a shared confirmation dialog; the test answers it directly.
const confirm = vi.fn(async (_request: { title: string }) => true);
vi.mock("../../../../shared/ui/ConfirmDialog", () => ({
  useConfirm: () => ({ confirm, dialog: null }),
}));

let host: MountedHost;
const onNavigate = vi.fn();

const ada = person({ id: "p1", name: "Ada", stage: "new" });
const grace = person({ id: "p2", name: "Grace" });

/** Lists behave like the Host: a saved list shows up in the next lists.list answer. */
function statefulLists(initial: SocialList[] = [STATIC_LIST]) {
  const rows = [...initial];
  return {
    ...clientMock().lists,
    list: vi.fn(async () => ({ items: [...rows] })),
    save: vi.fn(async (input: Record<string, unknown>) => {
      const row = { id: "l-new", createdAt: 1, ...input } as unknown as SocialList;
      rows.push(row);
      return row;
    }),
  };
}

function render(overrides: Record<string, unknown> = {}, projectId?: string) {
  const mock = clientMock({
    lists: statefulLists(),
    people: {
      ...clientMock().people,
      list: vi.fn(async () => ({ items: [ada, grace] })),
    },
    ...overrides,
  });
  const props: SocialScreenProps = {
    client: asClient(mock),
    machineId: "m1",
    projectId,
    shellState: { hostOnline: true, unreachable: false, aiStopped: false },
    active: true,
    onNavigate,
  };
  host.render(createElement(AudienceScreen, props));
  return mock;
}

async function loaded() {
  await flush();
  await flush();
}

function openMore(item: string) {
  const more = document.querySelector<HTMLButtonElement>('button[aria-label="More actions"]');
  if (!more) throw new Error("No More actions button");
  act(() => more.click());
  clickMenuItem(item);
}

beforeEach(() => {
  host = mountHost();
  onNavigate.mockClear();
  confirm.mockClear();
  confirm.mockImplementation(async () => true);
});

afterEach(() => {
  host.unmount();
});

describe("AudienceScreen creating lists", () => {
  it("creates a list from the menu and opens it", async () => {
    const mock = render();
    await loaded();
    openMore("New list…");
    setFieldValue(fieldByLabel("List name"), "Team");
    clickButton("Create list");
    await loaded();

    expect(mock.lists.save).toHaveBeenCalledWith({ name: "Team", kind: "static", projectIds: [] });
    expect(buttonByText("Team")?.getAttribute("aria-current")).toBe("true");
    expect(mock.people.list).toHaveBeenLastCalledWith({ listId: "l-new", limit: 100 });
  });

  it("creates a segment from the menu and shows the people who match its filter", async () => {
    const mock = render();
    await loaded();
    openMore("New segment…");
    setFieldValue(fieldByLabel("Segment name"), "X people");
    const platform = Array.from(document.querySelectorAll("label")).find(
      (item) => item.textContent?.trim() === "X",
    );
    act(() => platform!.querySelector<HTMLInputElement>("input")!.click());
    clickButton("Save segment");
    await loaded();

    expect(mock.lists.save).toHaveBeenCalledWith({
      name: "X people",
      kind: "dynamic",
      filter: { platforms: ["x"] },
      projectIds: [],
    });
    expect(mock.people.list).toHaveBeenLastCalledWith({ filter: { platforms: ["x"] }, limit: 100 });
  });

  it("opens the import dialog from the menu", async () => {
    render();
    await loaded();
    openMore("Import people…");
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain("Import people");
    expect(bodyText()).toContain("Choose a file first.");
  });
});

describe("AudienceScreen finding people", () => {
  it("collects people, reports how many were added and reloads the table", async () => {
    const mock = render();
    await loaded();
    const loadsBefore = mock.people.list.mock.calls.length;
    clickButton("Find people");
    await flush();
    act(() => buttonsByText("Find people").at(-1)!.click());
    await loaded();

    expect(mock.audience.collect).toHaveBeenCalledTimes(1);
    expect(bodyText()).toContain("2 people added, 1 skipped");
    expect(mock.people.list.mock.calls.length).toBeGreaterThan(loadsBefore);
  });

  it("shows no added-people notice when the source is not available for the account", async () => {
    render({
      audience: {
        ...clientMock().audience,
        collect: vi.fn(async () => ({ collected: 0, skipped: 0, unsupported: "followers.list" })),
      },
    });
    await loaded();
    clickButton("Find people");
    await flush();
    act(() => buttonsByText("Find people").at(-1)!.click());
    await loaded();
    expect(bodyText()).not.toContain("people added");
    expect(bodyText()).toContain("This search is not available for this account yet.");
  });
});

describe("AudienceScreen Fill with AI", () => {
  const emptyPeople = {
    ...clientMock().people,
    list: vi.fn(async () => ({ items: [] as SocialPerson[] })),
  };

  it("asks the assistant for a plan and sends the owner to Command to review it", async () => {
    const mock = render(
      {
        people: emptyPeople,
        ai: { command: vi.fn(async () => ({ planId: "plan-1", steps: [{}, {}] })) },
      },
      "proj1",
    );
    await loaded();
    clickButton("Fill with AI");
    await loaded();

    expect(mock.ai.command).toHaveBeenCalledWith({
      text: "Find people who commented on my recent posts and add them to Commenters",
      projectId: "proj1",
    });
    expect(bodyText()).toContain(
      "AI prepared 2 steps. Review them in Command before anything runs.",
    );
    clickButton("Open Command");
    expect(onNavigate).toHaveBeenCalledWith("command");
  });

  it("shows the Host reason when the assistant fails and prepares no steps", async () => {
    render({
      people: emptyPeople,
      ai: {
        command: vi.fn(async () => {
          throw new Error("AI is stopped.");
        }),
      },
    });
    await loaded();
    clickButton("Fill with AI");
    await loaded();
    expect(bodyText()).toContain("AI is stopped.");
    expect(bodyText()).not.toContain("AI prepared");
  });

  it("is blocked, with the reason, while no account is connected", async () => {
    render({ people: emptyPeople, snapshot: vi.fn(async () => ({ accounts: [] })) });
    await loaded();
    expect(buttonByText("Fill with AI")?.disabled).toBe(true);
    expect(bodyText()).toContain("Connect an account in Accounts & Settings first.");
  });

  it("says why Fill with AI is blocked while a plan is being prepared", async () => {
    const pending = deferred<{ planId: string; steps: unknown[] }>();
    render({ people: emptyPeople, ai: { command: vi.fn(() => pending.promise) } });
    await loaded();
    clickButton("Fill with AI");
    await loaded();

    expect(buttonByText("Fill with AI")?.disabled).toBe(true);
    expect(bodyText()).toContain("Wait for the current operation to finish");
    pending.resolve({ planId: "plan-1", steps: [] });
    await loaded();
  });
});

describe("AudienceScreen sections", () => {
  it("switches to the capture rules and the outreach board", async () => {
    const mock = render();
    await loaded();
    expect(tabByText("People")?.getAttribute("aria-selected")).toBe("true");

    act(() => tabByText("Capture rules")!.click());
    await loaded();
    expect(tabByText("Capture rules")?.getAttribute("aria-selected")).toBe("true");
    expect(mock.captureRules.list).toHaveBeenCalled();
    expect(bodyText()).toContain("Ready-made rule");

    act(() => tabByText("Outreach")!.click());
    await loaded();
    expect(tabByText("Outreach")?.getAttribute("aria-selected")).toBe("true");
    expect(mock.sequences.list).toHaveBeenCalled();
    expect(bodyText()).toContain("Results for all sequences");
  });
});

describe("AudienceScreen person panel", () => {
  it("opens a person from the table and updates the row when the stage changes", async () => {
    const mock = render();
    await loaded();
    act(() => buttonByText("Ada")!.click());
    await loaded();
    expect(mock.people.get).toHaveBeenCalledWith("p1");

    pickOption("Change stage", "Contacted");
    await flush();
    const row = document.querySelector("tbody tr");
    expect(row?.textContent).toContain("Contacted");
  });

  it("removes the row and closes the panel after the person's data is deleted", async () => {
    const mock = render();
    await loaded();
    act(() => buttonByText("Ada")!.click());
    await loaded();
    clickButton("Delete person data");
    await loaded();

    expect(confirm).toHaveBeenCalledTimes(1);
    expect(mock.people.delete).toHaveBeenCalledWith("p1");
    expect(bodyText()).not.toContain("Ada");
    expect(bodyText()).toContain("Grace");
  });
});

describe("AudienceScreen empty results", () => {
  it("tells the owner that nobody matches a search instead of showing the first-run state", async () => {
    const list = vi
      .fn()
      .mockResolvedValueOnce({ items: [ada] })
      .mockResolvedValue({ items: [] });
    render({ people: { ...clientMock().people, list } });
    await loaded();

    const search = document.querySelector<HTMLInputElement>('input[aria-label="Search people"]');
    setFieldValue(search!, "zzz");
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 400));
    });
    await flush();
    expect(bodyText()).toContain("No one matches this search.");
    expect(buttonByText("Clear search")).toBeDefined();
    expect(bodyText()).not.toContain("No people yet.");
  });
});
