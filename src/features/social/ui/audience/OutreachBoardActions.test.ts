// @vitest-environment happy-dom
import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Sequence } from "../../model/outreach";
import type { SequenceStats } from "../../model/socialActions";
import { OutreachBoard, startBlockReason } from "./OutreachBoard";
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
  pickOption,
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

const base = {
  listId: "l1",
  stopOnReply: true,
  pacing: { perHour: 10, perDay: 50, warmupDays: 0 },
  createdAt: 1,
} as const;

const step = {
  id: "st1",
  channel: "dm",
  delayHours: 0,
  template: "Hi",
  personalize: true,
} as const;

const draft = {
  ...base,
  id: "s1",
  name: "Spring follow-up",
  steps: [step],
  status: "draft",
} as Sequence;
const running = {
  ...base,
  id: "s2",
  name: "Launch week",
  steps: [step],
  status: "active",
} as Sequence;
const finished = {
  ...base,
  id: "s3",
  name: "Old campaign",
  steps: [step],
  status: "done",
} as Sequence;
const empty = { ...base, id: "s4", name: "Empty", steps: [], status: "draft" } as Sequence;

const ZERO: SequenceStats = { sent: 0, replied: 0, positive: 0, optedOut: 0, failed: 0 };

/** A client whose sequences behave like a Host: start, pause and save change what list returns next. */
function boardClient(initial: Sequence[], extra: Record<string, unknown> = {}): ClientMock {
  let rows = [...initial];
  const change = (id: string, status: Sequence["status"]) => {
    rows = rows.map((row) => (row.id === id ? { ...row, status } : row));
    return rows.find((row) => row.id === id)!;
  };
  return clientMock({
    sequences: {
      list: vi.fn(async () => ({ items: rows })),
      save: vi.fn(async (input: Record<string, unknown>) => {
        const row = {
          id: "s-new",
          status: "draft",
          stopOnReply: true,
          createdAt: 1,
          ...input,
        } as unknown as Sequence;
        rows = [...rows.filter((item) => item.id !== row.id), row];
        return row;
      }),
      start: vi.fn(async (id: string) => change(id, "active")),
      pause: vi.fn(async (id: string) => change(id, "paused")),
      stats: vi.fn(async (_id?: string) => ZERO),
      ...extra,
    },
  });
}

async function open(mock: ClientMock, onChanged = vi.fn()) {
  host.render(
    createElement(OutreachBoard, { client: asClient(mock), lists: [STATIC_LIST], onChanged }),
  );
  await flush();
  await flush();
  return onChanged;
}

describe("startBlockReason", () => {
  it("explains each reason a sequence cannot start and returns nothing for a ready one", () => {
    expect(startBlockReason(finished)).toBe("This sequence has finished.");
    expect(startBlockReason(running)).toBe("This sequence is already running.");
    expect(startBlockReason(empty)).toBe("Add at least one step first.");
    expect(startBlockReason({ ...draft, listId: "" })).toBe("Choose the list of people first.");
    expect(startBlockReason(draft)).toBeUndefined();
    expect(startBlockReason({ ...draft, status: "paused" })).toBeUndefined();
  });
});

describe("OutreachBoard start and pause", () => {
  it("starts a draft, shows it as running and tells the screen", async () => {
    const mock = boardClient([draft]);
    const onChanged = await open(mock);
    expect(bodyText()).toContain("Draft");

    clickButton("Start");
    await flush();
    await flush();
    expect(mock.sequences.start).toHaveBeenCalledWith("s1");
    expect(bodyText()).toContain("Running");
    expect(buttonByText("Pause")).toBeTruthy();
    expect(buttonByText("Start")).toBeUndefined();
    expect(onChanged).toHaveBeenCalledTimes(1);
  });

  it("keeps the sequence a draft and shows the Host reason when starting is refused", async () => {
    const mock = boardClient([draft], {
      start: vi.fn(async () => {
        throw new Error("Starting needs the owner's approval.");
      }),
    });
    const onChanged = await open(mock);
    clickButton("Start");
    await flush();
    expect(bodyText()).toContain("Starting needs the owner's approval.");
    expect(bodyText()).toContain("Draft");
    expect(buttonByText("Start")?.disabled).toBe(false);
    expect(onChanged).not.toHaveBeenCalled();
  });

  it("pauses a running sequence and offers Start again", async () => {
    const mock = boardClient([running]);
    const onChanged = await open(mock);
    expect(buttonByText("Start")).toBeUndefined();

    clickButton("Pause");
    await flush();
    await flush();
    expect(mock.sequences.pause).toHaveBeenCalledWith("s2");
    expect(bodyText()).toContain("Paused");
    expect(buttonByText("Start")?.disabled).toBe(false);
    expect(onChanged).toHaveBeenCalledTimes(1);
  });

  it("does not start a finished sequence and says why", async () => {
    const mock = boardClient([finished]);
    await open(mock);
    expect(bodyText()).toContain("Finished");
    expect(buttonByText("Start")?.disabled).toBe(true);
    expect(bodyText()).toContain("This sequence has finished.");
    expect(mock.sequences.start).not.toHaveBeenCalled();
  });

  it("keeps every sequence's own state when several are listed", async () => {
    await open(boardClient([draft, running, empty]));
    const starts = buttonsByText("Start");
    expect(starts).toHaveLength(2);
    expect(starts[0]!.disabled).toBe(false);
    expect(starts[1]!.disabled).toBe(true);
    expect(buttonByText("Pause")).toBeTruthy();
    expect(bodyText()).toContain("1 steps");
    expect(bodyText()).toContain("0 steps");
  });
});

describe("OutreachBoard results", () => {
  it("starts with the results of all sequences and switches to one sequence on click", async () => {
    const mock = boardClient([draft, running], {
      stats: vi.fn(async (id?: string) =>
        id === "s2" ? { sent: 20, replied: 4, positive: 2, optedOut: 1, failed: 0 } : ZERO,
      ),
    });
    await open(mock);
    expect(bodyText()).toContain("Results for all sequences");
    expect(mock.sequences.stats).toHaveBeenCalledWith(undefined);

    clickButton("Launch week");
    await flush();
    await flush();
    expect(mock.sequences.stats).toHaveBeenLastCalledWith("s2");
    expect(bodyText()).toContain("Results for Launch week");
    expect(bodyText()).toContain("Sent");
    expect(bodyText()).toContain("20");
    expect(bodyText()).toContain("Positive replies");
    // One opt-out in twenty sent.
    expect(bodyText()).toContain("5%");
  });

  it("shows a dash instead of 0% before anything is sent and the failed count when there is one", async () => {
    await open(
      boardClient([draft], {
        stats: vi.fn(async () => ({ ...ZERO, failed: 3 })),
      }),
    );
    expect(bodyText()).toContain("–");
    expect(bodyText()).not.toContain("0%");
    expect(bodyText()).toContain("3 could not be sent.");
  });

  it("shows the Host reason when the sequences cannot be loaded", async () => {
    await open(
      boardClient([], {
        list: vi.fn(async () => {
          throw new Error("Outreach is unavailable.");
        }),
      }),
    );
    expect(bodyText()).toContain("Outreach is unavailable.");
    expect(bodyText()).not.toContain("Loading sequences");
  });
});

describe("OutreachBoard editor", () => {
  it("offers a first sequence from the empty state", async () => {
    await open(boardClient([]));
    expect(bodyText()).toContain("No sequences yet.");
    const buttons = buttonsByText("New sequence");
    expect(buttons.length).toBeGreaterThan(0);
  });

  it("creates a sequence, lists it and selects it for the results", async () => {
    const mock = boardClient([]);
    const onChanged = await open(mock);
    clickButton("New sequence");
    await flush();
    expect(bodyText()).toContain("A reply always ends the sequence for that person.");

    setFieldValue(fieldByLabel("Sequence name"), "Welcome");
    pickOption("People", "Buyers");
    setFieldValue(fieldByLabel("Message"), "Welcome aboard");
    clickButton("Save sequence");
    await flush();
    await flush();

    expect(mock.sequences.save).toHaveBeenCalledTimes(1);
    expect(bodyText()).toContain("Results for Welcome");
    expect(bodyText()).toContain("Draft");
    expect(onChanged).toHaveBeenCalled();
    expect(buttonByText("Save sequence")).toBeUndefined();
  });

  it("opens an existing sequence for editing with its saved name", async () => {
    await open(boardClient([draft]));
    clickButton("Edit");
    await flush();
    expect(bodyText()).toContain("Edit sequence");
    expect(fieldByLabel("Sequence name").value).toBe("Spring follow-up");
  });
});
