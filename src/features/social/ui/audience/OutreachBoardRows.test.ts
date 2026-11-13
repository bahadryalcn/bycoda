// @vitest-environment happy-dom
import { act, createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SocialList } from "../../model/audience";
import type { Sequence } from "../../model/outreach";
import { OutreachBoard } from "./OutreachBoard";
import {
  STATIC_LIST,
  asClient,
  bodyText,
  buttonByText,
  buttonsByText,
  clickButton,
  clientMock,
  fieldByLabel,
  flush,
  mountHost,
  setFieldValue,
  type MountedHost,
} from "./audienceTestKit";

let host: MountedHost;

beforeEach(() => {
  host = mountHost();
});

afterEach(() => {
  host.unmount();
});

const base = {
  id: "a",
  name: "Welcome",
  listId: "l1",
  steps: [
    { id: "st1", channel: "dm", delayHours: 0, template: "Hi", personalize: true },
    { id: "st2", channel: "whatsapp", delayHours: 24, template: "Hello", personalize: true },
  ],
  status: "draft",
  stopOnReply: true,
  pacing: { perHour: 10, perDay: 50, warmupDays: 0 },
  createdAt: 1,
} as unknown as Sequence;
const second = { ...base, id: "b", name: "Second", steps: [] } as Sequence;

function board(items: Sequence[], lists: SocialList[] = [STATIC_LIST]) {
  const mock = clientMock({
    sequences: {
      ...clientMock().sequences,
      list: vi.fn(async () => ({ items: [...items] })),
    },
  });
  host.render(createElement(OutreachBoard, { client: asClient(mock), lists, onChanged: vi.fn() }));
  return mock;
}

async function loaded() {
  await flush();
  await flush();
}

describe("OutreachBoard rows", () => {
  it("shows the list name, the step count and one channel mark per step", async () => {
    board([base]);
    await loaded();
    expect(bodyText()).toContain("Runs for Buyers, 2 steps");
    const steps = document.querySelector('ol[aria-label="Steps"]')!;
    expect(Array.from(steps.querySelectorAll("li")).map((item) => item.textContent)).toEqual([
      "Direct message",
      "WhatsApp",
    ]);
    expect(steps.querySelectorAll("svg").length).toBe(2);
  });

  it("says when the list of a sequence no longer exists", async () => {
    board([base], []);
    await loaded();
    expect(bodyText()).toContain("Its list no longer exists, 2 steps");
  });

  it("links the reason a sequence cannot start to its disabled Start button", async () => {
    board([second]);
    await loaded();
    const start = buttonByText("Start")!;
    expect(start.disabled).toBe(true);
    const reason = document.getElementById(start.getAttribute("aria-describedby")!);
    expect(reason?.textContent).toBe("Add at least one step first.");
  });
});

describe("OutreachBoard header", () => {
  it("shows no results strip before the first sequence and a single create action", async () => {
    board([]);
    await loaded();
    expect(bodyText()).not.toContain("Opt-out rate");
    expect(buttonsByText("New sequence")).toHaveLength(1);
  });

  it("keeps a single create action and shows the results once a sequence exists", async () => {
    board([base]);
    await loaded();
    expect(bodyText()).toContain("Opt-out rate");
    expect(buttonsByText("New sequence")).toHaveLength(1);
  });

  it("returns to the results of all sequences from the chosen one", async () => {
    const mock = board([base, second]);
    await loaded();
    clickButton("Second");
    await loaded();
    expect(mock.sequences.stats).toHaveBeenLastCalledWith("b");
    clickButton("Show all sequences");
    await loaded();
    expect(mock.sequences.stats).toHaveBeenLastCalledWith(undefined);
    expect(bodyText()).toContain("Results for all sequences");
    expect(buttonByText("Show all sequences")).toBeUndefined();
  });

  it("keeps the order of the list when a sequence is edited", async () => {
    // The Host answers the next list call with the saved sequence, in its old position.
    const rows = [base, second];
    const mock = board(rows);
    mock.sequences.save.mockImplementation(async (input: Record<string, unknown>) => {
      const saved = { ...base, ...input } as Sequence;
      rows[0] = saved;
      return saved;
    });
    await loaded();
    act(() => buttonsByText("Edit")[0]!.click());
    await flush();
    setFieldValue(fieldByLabel("Sequence name"), "Welcome again");
    clickButton("Save sequence");
    await loaded();
    const names = Array.from(document.querySelectorAll(".audience-seq-head button")).map(
      (item) => item.textContent,
    );
    expect(names).toEqual(["Welcome again", "Second"]);
  });
});
