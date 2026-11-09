// @vitest-environment happy-dom
import { act, createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EmailAccount, Sequence } from "../../model/outreach";
import { SequenceEditor, type SequenceEditorProps } from "./SequenceEditor";
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

const STEP_REASON = "Each step needs a message, a wait time and, for email, an account.";
const PACING_REASON =
  "Pacing needs whole numbers: at least 1 per hour and per day, 0 or more warm-up days.";

const ops = {
  id: "e1",
  kind: "smtp",
  from: "ops@example.test",
  name: "Ops",
  unsubscribeUrl: "https://example.test/unsubscribe",
  createdAt: 1,
} as EmailAccount;

function withEmail(items: EmailAccount[]): ClientMock {
  return clientMock({
    email: { accounts: { list: vi.fn(async () => ({ items })) } },
  });
}

async function renderEditor(mock: ClientMock, overrides: Partial<SequenceEditorProps> = {}) {
  const props: SequenceEditorProps = {
    client: asClient(mock),
    lists: [STATIC_LIST, SEGMENT_LIST],
    onClose: vi.fn(),
    onSaved: vi.fn(),
    ...overrides,
  };
  host.render(createElement(SequenceEditor, props));
  await flush();
  await flush();
  return props;
}

/** Name, list and one message: the smallest sequence the editor lets the owner save. */
function fillMinimum() {
  setFieldValue(fieldByLabel("Sequence name"), "  Spring follow-up  ");
  setFieldValue(fieldByLabel("People"), "l1");
  setFieldValue(fieldByLabel("Message"), "  Hello again  ");
}

function saved(mock: ClientMock): Record<string, unknown> {
  const first = mock.sequences.save.mock.calls[0] as unknown[] | undefined;
  return first?.[0] as Record<string, unknown>;
}

describe("SequenceEditor requirements", () => {
  it("names the first missing piece in the order name, list, steps, step content, pacing", async () => {
    await renderEditor(clientMock());
    expect(buttonByText("Save sequence")?.disabled).toBe(true);
    expect(bodyText()).toContain("Enter a name for the sequence.");

    setFieldValue(fieldByLabel("Sequence name"), "Spring");
    expect(bodyText()).toContain("Choose the list of people it runs for.");

    setFieldValue(fieldByLabel("People"), "l1");
    expect(bodyText()).toContain(STEP_REASON);

    setFieldValue(fieldByLabel("Message"), "Hello");
    expect(buttonByText("Save sequence")?.disabled).toBe(false);

    setFieldValue(fieldByLabel("Most messages per hour"), "0");
    expect(buttonByText("Save sequence")?.disabled).toBe(true);
    expect(bodyText()).toContain(PACING_REASON);
  });

  it("offers only static lists, since a sequence runs over a fixed list", async () => {
    await renderEditor(clientMock());
    const people = fieldByLabel("People") as HTMLSelectElement;
    const labels = Array.from(people.options).map((option) => option.textContent);
    expect(labels).toContain("Buyers");
    expect(labels).not.toContain("Turkish");
  });

  it("states that a reply ends the sequence for that person", async () => {
    await renderEditor(clientMock());
    expect(bodyText()).toContain("A reply always ends the sequence for that person.");
  });

  it("refuses pacing that is not a whole number and accepts zero warm-up days", async () => {
    await renderEditor(clientMock());
    fillMinimum();
    for (const [label, value] of [
      ["Most messages per hour", "1.5"],
      ["Most messages per day", "0"],
      ["Warm-up days", "-1"],
    ] as const) {
      const field = fieldByLabel(label);
      const before = field.value;
      setFieldValue(field, value);
      expect(buttonByText("Save sequence")?.disabled).toBe(true);
      expect(bodyText()).toContain(PACING_REASON);
      setFieldValue(field, before);
      expect(buttonByText("Save sequence")?.disabled).toBe(false);
    }
    setFieldValue(fieldByLabel("Warm-up days"), "0");
    expect(buttonByText("Save sequence")?.disabled).toBe(false);
  });

  it("refuses a negative wait before a step", async () => {
    await renderEditor(clientMock());
    fillMinimum();
    setFieldValue(fieldByLabel("Wait before this step (hours)"), "-1");
    expect(buttonByText("Save sequence")?.disabled).toBe(true);
    expect(bodyText()).toContain(STEP_REASON);
  });
});

describe("SequenceEditor save", () => {
  it("saves a one-step direct message sequence with trimmed text and the default pace", async () => {
    const mock = clientMock();
    const props = await renderEditor(mock);
    fillMinimum();
    clickButton("Save sequence");
    await flush();

    expect(saved(mock)).toEqual({
      name: "Spring follow-up",
      listId: "l1",
      steps: [
        {
          id: expect.stringMatching(/^step-/),
          channel: "dm",
          delayHours: 0,
          template: "Hello again",
          personalize: true,
        },
      ],
      pacing: { perHour: 10, perDay: 50, warmupDays: 3 },
    });
    expect(props.onSaved).toHaveBeenCalledWith(expect.objectContaining({ id: "s-new" }));
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });

  it("saves the wait, the personalisation switch and the pace the owner chose", async () => {
    const mock = clientMock();
    await renderEditor(mock);
    fillMinimum();
    setFieldValue(fieldByLabel("Wait before this step (hours)"), "24");
    setFieldValue(fieldByLabel("Most messages per hour"), "5");
    setFieldValue(fieldByLabel("Most messages per day"), "20");
    setFieldValue(fieldByLabel("Warm-up days"), "0");
    act(() => document.querySelector<HTMLButtonElement>('button[role="switch"]')!.click());
    clickButton("Save sequence");
    await flush();

    const sent = saved(mock) as { steps: Record<string, unknown>[]; pacing: unknown };
    expect(sent.steps[0]).toEqual(expect.objectContaining({ delayHours: 24, personalize: false }));
    expect(sent.pacing).toEqual({ perHour: 5, perDay: 20, warmupDays: 0 });
  });

  it("saves several steps in order, and removing a step drops it from the payload", async () => {
    const mock = clientMock();
    await renderEditor(mock);
    fillMinimum();
    clickButton("Add step");
    clickButton("Add step");
    expect(bodyText()).toContain("Step 3");
    expect(buttonByText("Save sequence")?.disabled).toBe(true);
    expect(bodyText()).toContain(STEP_REASON);

    const messages = Array.from(document.querySelectorAll<HTMLTextAreaElement>("textarea"));
    expect(messages).toHaveLength(3);
    setFieldValue(messages[1]!, "Second");
    setFieldValue(messages[2]!, "Third");
    // Remove the middle step.
    act(() => buttonsNamed("Remove step")[1]!.click());
    clickButton("Save sequence");
    await flush();

    const sent = saved(mock) as { steps: { template: string }[] };
    expect(sent.steps.map((step) => step.template)).toEqual(["Hello again", "Third"]);
  });

  it("cannot save without a step and stops adding at ten steps", async () => {
    await renderEditor(clientMock());
    fillMinimum();
    act(() => buttonsNamed("Remove step")[0]!.click());
    expect(buttonByText("Save sequence")?.disabled).toBe(true);
    expect(bodyText()).toContain("Add at least one step.");

    for (let count = 0; count < 10; count += 1) {
      if (!buttonByText("Add step")?.disabled) clickButton("Add step");
    }
    expect(buttonByText("Add step")?.disabled).toBe(true);
    expect(bodyText()).toContain("Step 10");
    expect(bodyText()).not.toContain("Step 11");
  });

  it("keeps variants that have text, drops empty ones and stops at four", async () => {
    const mock = clientMock();
    await renderEditor(mock);
    fillMinimum();
    clickButton("Add variant");
    clickButton("Add variant");
    expect(bodyText()).toContain("Variant B");
    expect(bodyText()).toContain("Variant C");
    setFieldValue(fieldByLabel("Variant B"), "Hi there");
    clickButton("Save sequence");
    await flush();

    const sent = saved(mock) as { steps: { variants?: { id: string; text: string }[] }[] };
    expect(sent.steps[0]!.variants).toEqual([{ id: expect.any(String), text: "Hi there" }]);
  });

  it("limits a step to four variants", async () => {
    await renderEditor(clientMock());
    for (let count = 0; count < 4; count += 1) clickButton("Add variant");
    expect(buttonByText("Add variant")?.disabled).toBe(true);
    clickButton("Remove variant");
    expect(buttonByText("Add variant")?.disabled).toBe(false);
  });

  it("stays open with the Host reason and the typed text when saving fails", async () => {
    const mock = clientMock({
      sequences: {
        ...clientMock().sequences,
        save: vi.fn(async () => {
          throw new Error("The list changed.");
        }),
      },
    });
    const props = await renderEditor(mock);
    fillMinimum();
    clickButton("Save sequence");
    await flush();
    expect(bodyText()).toContain("The list changed.");
    expect(props.onSaved).not.toHaveBeenCalled();
    expect(props.onClose).not.toHaveBeenCalled();
    expect(fieldByLabel("Message").value).toBe("  Hello again  ");
    expect(buttonByText("Save sequence")?.disabled).toBe(false);
  });

  it("does not save twice while the first request is running", async () => {
    const pending = deferred<Sequence>();
    const mock = clientMock({
      sequences: { ...clientMock().sequences, save: vi.fn(() => pending.promise) },
    });
    await renderEditor(mock);
    fillMinimum();
    clickButton("Save sequence");
    await flush();
    clickButton("Save sequence");
    await flush();
    expect(mock.sequences.save).toHaveBeenCalledTimes(1);
    expect(buttonByText("Cancel")?.disabled).toBe(true);
  });
});

describe("SequenceEditor email steps", () => {
  it("needs an email account for an email step and saves the chosen one", async () => {
    const mock = withEmail([ops]);
    await renderEditor(mock);
    fillMinimum();
    setFieldValue(fieldByLabel("Channel"), "email");
    await flush();

    expect(buttonByText("Save sequence")?.disabled).toBe(true);
    expect(bodyText()).toContain(STEP_REASON);
    const sendFrom = fieldByLabel("Send from") as HTMLSelectElement;
    expect(Array.from(sendFrom.options).map((option) => option.textContent)).toContain(
      "Ops <ops@example.test>",
    );
    setFieldValue(sendFrom, "e1");
    expect(buttonByText("Save sequence")?.disabled).toBe(false);
    expect(bodyText()).not.toContain("Email steps need an unsubscribe link.");

    clickButton("Save sequence");
    await flush();
    const sent = saved(mock) as { steps: Record<string, unknown>[] };
    expect(sent.steps[0]).toEqual(
      expect.objectContaining({ channel: "email", accountId: "e1", template: "Hello again" }),
    );
  });

  it("blocks saving an email step whose account has no unsubscribe link, and says why", async () => {
    const noLink = { ...ops, id: "e2", unsubscribeUrl: undefined } as EmailAccount;
    const mock = withEmail([noLink]);
    await renderEditor(mock);
    fillMinimum();
    setFieldValue(fieldByLabel("Channel"), "email");
    await flush();
    setFieldValue(fieldByLabel("Send from"), "e2");
    await flush();

    expect(buttonByText("Save sequence")?.disabled).toBe(true);
    expect(bodyText()).toContain(
      "Email steps need an unsubscribe link. Add one to this email account first.",
    );
    expect(mock.sequences.save).not.toHaveBeenCalled();
  });

  it("saves a variant without the spaces around its text", async () => {
    const mock = clientMock();
    await renderEditor(mock);
    fillMinimum();
    clickButton("Add variant");
    setFieldValue(fieldByLabel("Variant B"), "  Hey there  ");
    clickButton("Save sequence");
    await flush();

    const sent = saved(mock) as { steps: { variants?: { text: string }[] }[] };
    expect(sent.steps[0]!.variants?.map((variant) => variant.text)).toEqual(["Hey there"]);
  });

  it("forgets the email account again when the step moves to another channel", async () => {
    const mock = withEmail([ops]);
    await renderEditor(mock);
    fillMinimum();
    setFieldValue(fieldByLabel("Channel"), "email");
    await flush();
    setFieldValue(fieldByLabel("Send from"), "e1");
    setFieldValue(fieldByLabel("Channel"), "comment");
    await flush();
    clickButton("Save sequence");
    await flush();
    const sent = saved(mock) as { steps: Record<string, unknown>[] };
    expect(sent.steps[0]).toEqual(expect.objectContaining({ channel: "comment" }));
    expect("accountId" in sent.steps[0]!).toBe(false);
  });

  it("shows the Host reason when the email accounts cannot be loaded", async () => {
    const mock = clientMock({
      email: {
        accounts: {
          list: vi.fn(async () => {
            throw new Error("Email is unavailable.");
          }),
        },
      },
    });
    await renderEditor(mock);
    expect(bodyText()).toContain("Email is unavailable.");
  });
});

describe("SequenceEditor editing", () => {
  const existing = {
    id: "seq1",
    name: "Spring follow-up",
    listId: "l1",
    steps: [
      {
        id: "st1",
        channel: "comment",
        delayHours: 12,
        template: "Thanks for the comment",
        variants: [{ id: "st1-v1", text: "Thank you" }],
        personalize: false,
      },
    ],
    status: "paused",
    stopOnReply: true,
    pacing: { perHour: 4, perDay: 8, warmupDays: 1 },
    createdAt: 1,
  } as Sequence;

  it("opens with the saved values and saves under the same id without changing the status", async () => {
    const mock = clientMock();
    await renderEditor(mock, { sequence: existing });
    expect(bodyText()).toContain("Edit sequence");
    expect(fieldByLabel("Sequence name").value).toBe("Spring follow-up");
    expect(fieldByLabel("People").value).toBe("l1");
    expect(fieldByLabel("Message").value).toBe("Thanks for the comment");
    expect(fieldByLabel("Wait before this step (hours)").value).toBe("12");
    expect(fieldByLabel("Variant B").value).toBe("Thank you");
    expect(fieldByLabel("Most messages per hour").value).toBe("4");

    setFieldValue(fieldByLabel("Sequence name"), "Spring follow-up v2");
    clickButton("Save sequence");
    await flush();
    expect(saved(mock)).toEqual({
      id: "seq1",
      status: "paused",
      name: "Spring follow-up v2",
      listId: "l1",
      steps: [
        {
          id: "st1",
          channel: "comment",
          delayHours: 12,
          template: "Thanks for the comment",
          variants: [{ id: "st1-v1", text: "Thank you" }],
          personalize: false,
        },
      ],
      pacing: { perHour: 4, perDay: 8, warmupDays: 1 },
    });
  });
});

function buttonsNamed(text: string): HTMLButtonElement[] {
  return Array.from(document.querySelectorAll("button")).filter(
    (button) => button.textContent?.trim() === text,
  );
}
