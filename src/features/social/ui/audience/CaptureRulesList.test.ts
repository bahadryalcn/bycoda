// @vitest-environment happy-dom
import { act, createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CaptureRule } from "../../model/audience";
import { CaptureRules, type CaptureRulesProps } from "./CaptureRules";
import {
  ACCOUNT,
  STATIC_LIST,
  asClient,
  bodyText,
  buttonByText,
  clientMock,
  clickButton,
  fieldByLabel,
  flush,
  mountHost,
  setFieldValue,
  type ClientMock,
  type MountedHost,
} from "./audienceTestKit";

// Deleting a rule waits for a shared confirmation dialog; the test answers it directly.
const confirm = vi.fn(async (_request: { title: string; danger?: boolean }) => true);
vi.mock("../../../../shared/ui/ConfirmDialog", () => ({
  useConfirm: () => ({ confirm, dialog: null }),
}));

let host: MountedHost;

beforeEach(() => {
  host = mountHost();
  confirm.mockClear();
  confirm.mockImplementation(async () => true);
});

afterEach(() => {
  host.unmount();
});

const launch = {
  id: "r1",
  name: "Launch hashtag",
  enabled: false,
  source: { kind: "hashtag", accountId: "acc1", query: "launch" },
  filter: {},
  targetListId: "l1",
  createdAt: 1,
} as CaptureRule;

function withRules(items: CaptureRule[], overrides: Record<string, unknown> = {}): ClientMock {
  return clientMock({
    captureRules: {
      ...clientMock().captureRules,
      list: vi.fn(async () => ({ items })),
      ...overrides,
    },
  });
}

async function open(mock: ClientMock, overrides: Partial<CaptureRulesProps> = {}) {
  const props: CaptureRulesProps = {
    client: asClient(mock),
    accounts: [ACCOUNT],
    lists: [STATIC_LIST],
    onChanged: vi.fn(),
    ...overrides,
  };
  host.render(createElement(CaptureRules, props));
  await flush();
  await flush();
  return props;
}

function switches(): HTMLButtonElement[] {
  return Array.from(document.querySelectorAll<HTMLButtonElement>('button[role="switch"]'));
}

describe("CaptureRules list", () => {
  it("says there are no rules yet and where the ready-made list is missing", async () => {
    await open(withRules([]), { lists: [] });
    expect(bodyText()).toContain("No rules yet. A rule adds people to a list as they interact.");
    expect(bodyText()).toContain("The Commenters list is not set up on this computer yet.");
  });

  it("shows where each rule looks and which list it fills", async () => {
    await open(withRules([launch, { ...launch, id: "r2", name: "Orphan", targetListId: "gone" }]));
    expect(bodyText()).toContain("Launch hashtag");
    expect(bodyText()).toContain("Hashtag → Buyers");
    expect(bodyText()).toContain("Hashtag → No list");
  });

  it("shows the Host reason when the rules cannot be loaded", async () => {
    const mock = clientMock({
      captureRules: {
        ...clientMock().captureRules,
        list: vi.fn(async () => {
          throw new Error("Rules are unavailable.");
        }),
      },
    });
    await open(mock);
    expect(bodyText()).toContain("Rules are unavailable.");
    expect(bodyText()).not.toContain("Loading rules");
  });
});

describe("CaptureRules switch", () => {
  it("turns a rule on and tells the screen so it can reload", async () => {
    const mock = withRules([launch], {
      setEnabled: vi.fn(async (input: { id: string; enabled: boolean }) => ({
        ...launch,
        enabled: input.enabled,
      })),
    });
    const props = await open(mock);
    expect(switches()).toHaveLength(1);
    expect(switches()[0]!.getAttribute("aria-checked")).toBe("false");

    act(() => switches()[0]!.click());
    await flush();
    expect(mock.captureRules.setEnabled).toHaveBeenCalledWith({ id: "r1", enabled: true });
    expect(switches()[0]!.getAttribute("aria-checked")).toBe("true");
    expect(props.onChanged).toHaveBeenCalledTimes(1);
  });

  it("keeps the rule off and shows the Host reason when turning it on is refused", async () => {
    const mock = withRules([launch], {
      setEnabled: vi.fn(async () => {
        throw new Error("Turning this on needs the owner's approval.");
      }),
    });
    const props = await open(mock);
    act(() => switches()[0]!.click());
    await flush();
    expect(bodyText()).toContain("Turning this on needs the owner's approval.");
    expect(switches()[0]!.getAttribute("aria-checked")).toBe("false");
    expect(props.onChanged).not.toHaveBeenCalled();
  });
});

describe("CaptureRules delete", () => {
  it("deletes a rule only after the owner confirms and leaves the collected people alone", async () => {
    const mock = withRules([launch]);
    await open(mock);
    clickButton("Delete rule");
    await flush();
    expect(confirm).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Delete this rule?", danger: true }),
    );
    expect(mock.captureRules.delete).toHaveBeenCalledWith("r1");
    expect(bodyText()).not.toContain("Launch hashtag");
    expect(mock.people.delete).not.toHaveBeenCalled();
  });

  it("keeps the rule when the owner declines", async () => {
    confirm.mockImplementation(async () => false);
    const mock = withRules([launch]);
    await open(mock);
    clickButton("Delete rule");
    await flush();
    expect(mock.captureRules.delete).not.toHaveBeenCalled();
    expect(bodyText()).toContain("Launch hashtag");
  });

  it("keeps the rule and shows the Host reason when the deletion fails", async () => {
    const mock = withRules([launch], {
      delete: vi.fn(async () => {
        throw new Error("Rule is in use.");
      }),
    });
    await open(mock);
    clickButton("Delete rule");
    await flush();
    expect(bodyText()).toContain("Rule is in use.");
    expect(bodyText()).toContain("Launch hashtag");
  });
});

describe("CaptureRules new rule", () => {
  it("adds a saved rule to the list switched off and tells the screen", async () => {
    const mock = withRules([]);
    const props = await open(mock);
    clickButton("New rule");
    await flush();
    expect(bodyText()).toContain("The rule is saved turned off.");

    setFieldValue(fieldByLabel("Rule name"), "Launch hashtag");
    setFieldValue(fieldByLabel("Add them to"), "l1");
    clickButton("Save rule");
    await flush();

    expect(mock.captureRules.save).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Launch hashtag", enabled: false, targetListId: "l1" }),
    );
    expect(bodyText()).toContain("Launch hashtag");
    expect(props.onChanged).toHaveBeenCalledTimes(1);
    expect(buttonByText("Save rule")).toBeUndefined();
    expect(switches()[0]!.getAttribute("aria-checked")).toBe("false");
  });
});
