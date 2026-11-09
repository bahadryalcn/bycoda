// @vitest-environment happy-dom
import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CaptureRule, SocialList } from "../../model/audience";
import { CaptureRules } from "./CaptureRules";
import {
  asClient,
  bodyText,
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

const commentersList = {
  id: "list-commenters",
  name: "Commenters",
  kind: "static",
  projectIds: [],
  system: "commenters",
  createdAt: 1,
} as SocialList;

const commentersRule = {
  id: "rule-commenters",
  name: "Commenters",
  enabled: false,
  source: { kind: "own_post_comments", accountId: "acc1" },
  filter: {},
  targetListId: "list-commenters",
  system: "commenters",
  createdAt: 1,
} as CaptureRule;

describe("CaptureRules", () => {
  it("turns the ready-made commenters rule on with one switch", async () => {
    const mock: ClientMock = clientMock({
      captureRules: {
        ...clientMock().captureRules,
        list: vi.fn(async () => ({ items: [commentersRule] })),
        // The Host saves the rule and echoes the whole record back.
        setEnabled: vi.fn(async (input: { id: string; enabled: boolean }) => ({
          ...commentersRule,
          enabled: input.enabled,
        })),
      },
    });
    host.render(
      createElement(CaptureRules, {
        client: asClient(mock),
        accounts: [],
        lists: [commentersList],
        onChanged: vi.fn(),
      }),
    );
    await flush();
    await flush();

    expect(bodyText()).toContain("Add the people who comment on my posts to the Commenters list.");
    const toggle = document.querySelector<HTMLButtonElement>('button[role="switch"]');
    expect(toggle).toBeTruthy();
    toggle!.click();
    await flush();

    expect(mock.captureRules.setEnabled).toHaveBeenCalledWith({
      id: "rule-commenters",
      enabled: true,
    });
    expect(bodyText()).toContain("Add the people who comment on my posts to the Commenters list.");
  });

  it("keeps the ready-made rule out of the custom list when the switch echoes only id and state", async () => {
    const mock: ClientMock = clientMock({
      captureRules: {
        ...clientMock().captureRules,
        list: vi.fn(async () => ({ items: [commentersRule] })),
      },
    });
    host.render(
      createElement(CaptureRules, {
        client: asClient(mock),
        accounts: [],
        lists: [commentersList],
        onChanged: vi.fn(),
      }),
    );
    await flush();
    await flush();

    document.querySelector<HTMLButtonElement>('button[role="switch"]')!.click();
    await flush();

    expect(bodyText()).toContain("Add the people who comment on my posts to the Commenters list.");
    expect(bodyText()).not.toContain("People who commented on my posts");
  });

  it("says the rule is not set up when the Host has not created it", async () => {
    const mock: ClientMock = clientMock();
    host.render(
      createElement(CaptureRules, {
        client: asClient(mock),
        accounts: [],
        lists: [commentersList],
        onChanged: vi.fn(),
      }),
    );
    await flush();
    await flush();
    expect(bodyText()).toContain("This rule is not set up on this computer yet.");
  });
});
