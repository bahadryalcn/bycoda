// @vitest-environment happy-dom
import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Sequence } from "../../model/outreach";
import { OutreachBoard } from "./OutreachBoard";
import {
  asClient,
  bodyText,
  buttonsByText,
  clientMock,
  flush,
  mountHost,
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

const emptySequence = {
  id: "s-empty",
  name: "Empty draft",
  listId: "l1",
  steps: [],
  status: "draft",
  stopOnReply: true,
  pacing: { perHour: 10, perDay: 50, warmupDays: 0 },
  createdAt: 1,
} as Sequence;

const readySequence = {
  ...emptySequence,
  id: "s-ready",
  name: "Ready draft",
  steps: [{ id: "st1", channel: "dm", delayHours: 0, template: "Hi", personalize: true }],
} as unknown as Sequence;

describe("OutreachBoard", () => {
  it("shows the results cards, with the opt-out rate as a share of what was sent", async () => {
    const mock: ClientMock = clientMock({
      sequences: {
        ...clientMock().sequences,
        list: vi.fn(async () => ({ items: [readySequence] })),
        stats: vi.fn(async () => ({ sent: 10, replied: 2, positive: 1, optedOut: 1, failed: 0 })),
      },
    });
    host.render(
      createElement(OutreachBoard, { client: asClient(mock), lists: [], onChanged: vi.fn() }),
    );
    await flush();
    await flush();
    expect(bodyText()).toContain("Opt-out rate");
    expect(bodyText()).toContain("10%");
  });

  it("explains why an empty sequence cannot start and starts a ready one", async () => {
    const mock: ClientMock = clientMock({
      sequences: {
        ...clientMock().sequences,
        list: vi.fn(async () => ({ items: [emptySequence, readySequence] })),
      },
    });
    host.render(
      createElement(OutreachBoard, { client: asClient(mock), lists: [], onChanged: vi.fn() }),
    );
    await flush();
    await flush();

    expect(bodyText()).toContain("Add at least one step first.");
    const starts = buttonsByText("Start");
    expect(starts).toHaveLength(2);
    expect(starts[0]!.disabled).toBe(true);
    starts[1]!.click();
    await flush();
    expect(mock.sequences.start).toHaveBeenCalledWith("s-ready");
  });
});
