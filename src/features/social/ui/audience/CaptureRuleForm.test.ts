// @vitest-environment happy-dom
import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Sequence } from "../../model/outreach";
import { CaptureRuleForm, type CaptureRuleFormProps } from "./CaptureRuleForm";
import {
  ACCOUNT,
  SEGMENT_LIST,
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

let host: MountedHost;

beforeEach(() => {
  host = mountHost();
});

afterEach(() => {
  host.unmount();
});

const welcome = {
  id: "seq1",
  name: "Welcome",
  listId: "l1",
  steps: [],
  status: "draft",
  stopOnReply: true,
  pacing: { perHour: 10, perDay: 50, warmupDays: 0 },
  createdAt: 1,
} as Sequence;

function renderForm(mock: ClientMock, overrides: Partial<CaptureRuleFormProps> = {}) {
  const props: CaptureRuleFormProps = {
    client: asClient(mock),
    accounts: [ACCOUNT],
    lists: [STATIC_LIST, SEGMENT_LIST],
    sequences: [welcome],
    onClose: vi.fn(),
    onSaved: vi.fn(),
    ...overrides,
  };
  host.render(createElement(CaptureRuleForm, props));
  return props;
}

/** Fills the two things every rule needs: a name and a target list. */
async function fillRequired() {
  setFieldValue(fieldByLabel("Rule name"), "  Launch commenters  ");
  setFieldValue(fieldByLabel("Add them to"), "l1");
  await flush();
}

describe("CaptureRuleForm requirements", () => {
  it("names the next missing piece in the order name, source, list", async () => {
    renderForm(clientMock(), { accounts: [] });
    await flush();
    expect(buttonByText("Save rule")?.disabled).toBe(true);
    expect(bodyText()).toContain("Enter a name for the rule.");

    setFieldValue(fieldByLabel("Rule name"), "Launch");
    expect(bodyText()).toContain("Choose an account.");
  });

  it("asks for the target list after the name and the source are right", async () => {
    renderForm(clientMock());
    await flush();
    setFieldValue(fieldByLabel("Rule name"), "Launch");
    expect(buttonByText("Save rule")?.disabled).toBe(true);
    expect(bodyText()).toContain("Choose the list the people are added to.");
    setFieldValue(fieldByLabel("Add them to"), "l1");
    expect(buttonByText("Save rule")?.disabled).toBe(false);
  });

  it("offers only static lists as the target", async () => {
    renderForm(clientMock());
    await flush();
    const target = fieldByLabel("Add them to") as HTMLSelectElement;
    const labels = Array.from(target.options).map((option) => option.textContent);
    expect(labels).toContain("Buyers");
    expect(labels).not.toContain("Turkish");
  });

  it("needs the keyword of a keyword source", async () => {
    renderForm(clientMock());
    await flush();
    await fillRequired();
    setFieldValue(fieldByLabel("Where to look"), "keyword");
    await flush();
    expect(buttonByText("Save rule")?.disabled).toBe(true);
    expect(bodyText()).toContain("Enter a keyword or hashtag.");
    setFieldValue(fieldByLabel("Keyword or hashtag"), "pricing");
    expect(buttonByText("Save rule")?.disabled).toBe(false);
  });

  it("refuses a minimum follower count that is not a whole number", async () => {
    renderForm(clientMock());
    await flush();
    await fillRequired();
    setFieldValue(fieldByLabel("Minimum followers (optional)"), "1.5");
    expect(buttonByText("Save rule")?.disabled).toBe(true);
    expect(bodyText()).toContain("Enter a whole number of followers.");
    setFieldValue(fieldByLabel("Minimum followers (optional)"), "");
    expect(buttonByText("Save rule")?.disabled).toBe(false);
  });
});

describe("CaptureRuleForm actions", () => {
  it("needs the tag text when the rule tags people", async () => {
    renderForm(clientMock());
    await flush();
    await fillRequired();
    setFieldValue(fieldByLabel("Then"), "tag");
    await flush();
    expect(buttonByText("Save rule")?.disabled).toBe(true);
    expect(bodyText()).toContain("Enter the tag to add.");
  });

  it("needs a sequence when the rule starts one", async () => {
    renderForm(clientMock());
    await flush();
    await fillRequired();
    setFieldValue(fieldByLabel("Then"), "enroll");
    await flush();
    expect(buttonByText("Save rule")?.disabled).toBe(true);
    expect(bodyText()).toContain("Choose a sequence.");
    setFieldValue(fieldByLabel("Sequence"), "seq1");
    expect(buttonByText("Save rule")?.disabled).toBe(false);
  });
});

describe("CaptureRuleForm save", () => {
  it("saves the rule turned off, with no action and an empty filter by default", async () => {
    const mock = clientMock();
    const props = renderForm(mock);
    await flush();
    await fillRequired();
    clickButton("Save rule");
    await flush();

    expect(mock.captureRules.save).toHaveBeenCalledTimes(1);
    const sent = mock.captureRules.save.mock.calls[0]![0] as Record<string, unknown>;
    expect(sent).toEqual({
      name: "Launch commenters",
      source: { kind: "own_post_comments", accountId: "acc1" },
      filter: {},
      targetListId: "l1",
      enabled: false,
    });
    expect("action" in sent).toBe(false);
    expect(props.onSaved).toHaveBeenCalledWith(
      expect.objectContaining({ id: "r-new", enabled: false }),
    );
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });

  it("saves the filter, the tag action and a hashtag without its leading hash", async () => {
    const mock = clientMock();
    renderForm(mock);
    await flush();
    await fillRequired();
    setFieldValue(fieldByLabel("Where to look"), "hashtag");
    await flush();
    setFieldValue(fieldByLabel("Keyword or hashtag"), "#launch");
    setFieldValue(fieldByLabel("Language (optional)"), "  tr ");
    setFieldValue(fieldByLabel("Minimum followers (optional)"), "100");
    setFieldValue(fieldByLabel("Tone (optional)"), "positive");
    setFieldValue(fieldByLabel("Then"), "tag");
    await flush();
    setFieldValue(fieldByLabel("Tag"), " hot ");
    clickButton("Save rule");
    await flush();

    expect(mock.captureRules.save).toHaveBeenCalledWith({
      name: "Launch commenters",
      source: { kind: "hashtag", accountId: "acc1", query: "launch" },
      filter: { language: "tr", minFollowers: 100, sentiment: "positive" },
      targetListId: "l1",
      enabled: false,
      action: { kind: "tag", tag: "hot" },
    });
  });

  it("saves a rule that starts a sequence", async () => {
    const mock = clientMock();
    renderForm(mock);
    await flush();
    await fillRequired();
    setFieldValue(fieldByLabel("Then"), "enroll");
    await flush();
    setFieldValue(fieldByLabel("Sequence"), "seq1");
    clickButton("Save rule");
    await flush();
    expect(mock.captureRules.save).toHaveBeenCalledWith(
      expect.objectContaining({ action: { kind: "enroll", sequenceId: "seq1" }, enabled: false }),
    );
  });

  it("stays open with the Host reason and does not report a saved rule when saving fails", async () => {
    const mock = clientMock({
      captureRules: {
        ...clientMock().captureRules,
        save: vi.fn(async () => {
          throw new Error("Too many rules.");
        }),
      },
    });
    const props = renderForm(mock);
    await flush();
    await fillRequired();
    clickButton("Save rule");
    await flush();
    expect(bodyText()).toContain("Too many rules.");
    expect(props.onSaved).not.toHaveBeenCalled();
    expect(props.onClose).not.toHaveBeenCalled();
    expect(buttonByText("Save rule")?.disabled).toBe(false);
  });
});
