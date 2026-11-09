// @vitest-environment happy-dom
import { act, createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SocialPerson } from "../../model/audience";
import type { SequenceEnrollment } from "../../model/outreach";
import type { PersonDetail } from "../../model/socialActions";
import { PersonPanel } from "./PersonPanel";
import {
  asClient,
  bodyText,
  buttonByText,
  clientMock,
  clickButton,
  fieldByLabel,
  flush,
  mountHost,
  person,
  setFieldValue,
  type ClientMock,
  type MountedHost,
} from "./audienceTestKit";

// Merge and delete wait for a shared confirmation dialog; the test answers it directly.
const confirm = vi.fn(
  async (_request: { title: string; danger?: boolean; requireText?: unknown }) => true,
);
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

/** A client whose people.get returns one detail record; `people` replaces other people.* methods. */
function detailMock(
  patch: Partial<PersonDetail> = {},
  base: Partial<SocialPerson> = {},
  people: Record<string, unknown> = {},
): ClientMock {
  return clientMock({
    people: {
      ...clientMock().people,
      get: vi.fn(async () => ({
        person: person({ id: "p1", ...base }),
        interactions: [],
        enrollments: [],
        suppressed: false,
        ...patch,
      })),
      ...people,
    },
  });
}

function renderPanel(mock: ClientMock) {
  const props = {
    client: asClient(mock),
    personId: "p1",
    onClose: vi.fn(),
    onChanged: vi.fn(),
    onDeleted: vi.fn(),
    onMerged: vi.fn(),
  };
  host.render(createElement(PersonPanel, props));
  return props;
}

async function open(mock: ClientMock) {
  const props = renderPanel(mock);
  await flush();
  await flush();
  return props;
}

function blur(field: HTMLElement) {
  act(() => {
    field.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
  });
}

describe("PersonPanel consent", () => {
  it("shows the stored IYS status and saves a new one with the time it was checked", async () => {
    const mock = detailMock({}, { commercialConsent: { iys: "rejected", checkedAt: 5 } });
    const props = await open(mock);
    const field = fieldByLabel("IYS status") as HTMLSelectElement;
    expect(field.value).toBe("rejected");

    const before = Date.now();
    setFieldValue(field, "approved");
    await flush();
    expect(mock.people.update).toHaveBeenCalledWith({
      personId: "p1",
      patch: { commercialConsent: { iys: "approved", checkedAt: expect.any(Number) } },
    });
    const call = mock.people.update.mock.calls[0]![0] as {
      patch: { commercialConsent: { checkedAt: number } };
    };
    expect(call.patch.commercialConsent.checkedAt).toBeGreaterThanOrEqual(before);
    expect(props.onChanged).toHaveBeenCalled();
  });

  it("treats a person without a recorded IYS status as not checked", async () => {
    await open(detailMock());
    expect((fieldByLabel("IYS status") as HTMLSelectElement).value).toBe("unknown");
    expect(bodyText()).toContain("Commercial messages (Turkey)");
  });

  it("warns only when the person is on the do-not-contact list", async () => {
    await open(detailMock({ suppressed: false }));
    expect(bodyText()).not.toContain("do-not-contact");
  });
});

describe("PersonPanel edits", () => {
  it("does not save a stage that did not change", async () => {
    const mock = detailMock({}, { stage: "contacted" });
    await open(mock);
    setFieldValue(fieldByLabel("Change stage"), "contacted");
    await flush();
    expect(mock.people.update).not.toHaveBeenCalled();
  });

  it("saves a trimmed name on blur and puts the old name back when it is emptied", async () => {
    const mock = detailMock();
    await open(mock);
    const name = fieldByLabel("Name") as HTMLInputElement;

    setFieldValue(name, "  Ada Lovelace  ");
    blur(name);
    await flush();
    expect(mock.people.update).toHaveBeenCalledWith({
      personId: "p1",
      patch: { name: "Ada Lovelace" },
    });

    mock.people.update.mockClear();
    setFieldValue(name, "   ");
    blur(name);
    await flush();
    expect(mock.people.update).not.toHaveBeenCalled();
    expect(name.value).toBe("Ada Lovelace");
  });

  it("saves the notes on blur only when they changed", async () => {
    const mock = detailMock();
    await open(mock);
    const notes = fieldByLabel("Notes") as HTMLTextAreaElement;
    blur(notes);
    await flush();
    expect(mock.people.update).not.toHaveBeenCalled();

    setFieldValue(notes, "Asked about pricing");
    blur(notes);
    await flush();
    expect(mock.people.update).toHaveBeenCalledWith({
      personId: "p1",
      patch: { notes: "Asked about pricing" },
    });
  });

  it("saves the tag list when a tag is added", async () => {
    const mock = detailMock({}, { tags: ["vip"] });
    await open(mock);
    const input = document.querySelector<HTMLInputElement>('input[placeholder="Add a tag"]');
    expect(input).toBeTruthy();
    setFieldValue(input!, "lead");
    act(() => {
      input!.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }),
      );
    });
    await flush();
    expect(mock.people.update).toHaveBeenCalledWith({
      personId: "p1",
      patch: { tags: ["vip", "lead"] },
    });
  });

  it("shows the Host reason and does not report a change when saving fails", async () => {
    const mock = detailMock();
    mock.people.update.mockRejectedValueOnce(new Error("Person is locked."));
    const props = await open(mock);
    setFieldValue(fieldByLabel("Change stage"), "interested");
    await flush();
    expect(bodyText()).toContain("Person is locked.");
    expect(props.onChanged).not.toHaveBeenCalled();
  });

  it("shows the Host reason when the person cannot be loaded", async () => {
    const mock = clientMock({
      people: {
        ...clientMock().people,
        get: vi.fn(async () => {
          throw new Error("Person not found.");
        }),
      },
    });
    await open(mock);
    expect(bodyText()).toContain("Person not found.");
  });
});

describe("PersonPanel activity", () => {
  it("shows the sequence steps the person is in and marks the activity you sent", async () => {
    const enrollments = [
      { id: "e1", sequenceId: "s1", personId: "p1", stepIndex: 0, status: "active", updatedAt: 1 },
      { id: "e2", sequenceId: "s2", personId: "p1", stepIndex: 1, status: "active", updatedAt: 1 },
    ] as SequenceEnrollment[];
    await open(
      detailMock({
        enrollments,
        interactions: [
          {
            id: "i1",
            personId: "p1",
            accountId: "acc1",
            platform: "x",
            kind: "dm",
            at: Date.now() - 60_000,
            direction: "outbound",
            text: "Hello there",
          },
        ],
      }),
    );
    expect(bodyText()).toContain("In 2 sequence steps");
    expect(bodyText()).toContain("You: Direct message");
  });

  it("says so when nothing has happened yet and shows the email address state", async () => {
    await open(
      detailMock(
        {},
        {
          handles: [],
          emails: [{ address: "ada@example.test", source: "import", verified: false }],
        },
      ),
    );
    expect(bodyText()).toContain("No activity recorded yet.");
    expect(bodyText()).toContain("No linked accounts yet.");
    expect(bodyText()).toContain("ada@example.test");
    expect(bodyText()).toContain("Not verified");
  });
});

describe("PersonPanel duplicates", () => {
  const suggestion = { personIds: ["p1", "p3"], reason: "Same email address", score: 0.9 };
  const withSuggestion = {
    matchSuggestions: vi.fn(async () => ({ suggestions: [suggestion] })),
  };

  it("lists the possible duplicates without the open person and merges only after confirmation", async () => {
    const mock = detailMock({}, {}, withSuggestion);
    const props = await open(mock);

    clickButton("Find possible duplicates");
    await flush();
    expect(withSuggestion.matchSuggestions).toHaveBeenCalledWith("p1");
    expect(bodyText()).toContain("1 possible match: Same email address");

    clickButton("Merge into this person");
    await flush();
    expect(confirm).toHaveBeenCalledWith(expect.objectContaining({ title: "Merge these people?" }));
    expect(mock.people.merge).toHaveBeenCalledWith({ targetId: "p1", sourceIds: ["p3"] });
    expect(props.onMerged).toHaveBeenCalledWith(expect.objectContaining({ id: "p1" }), ["p3"]);
    expect(bodyText()).not.toContain("possible match");
  });

  it("merges nothing when the owner declines", async () => {
    confirm.mockImplementation(async () => false);
    const mock = detailMock({}, {}, withSuggestion);
    const props = await open(mock);
    clickButton("Find possible duplicates");
    await flush();
    clickButton("Merge into this person");
    await flush();
    expect(mock.people.merge).not.toHaveBeenCalled();
    expect(props.onMerged).not.toHaveBeenCalled();
  });

  it("says when there are no possible duplicates", async () => {
    await open(detailMock());
    clickButton("Find possible duplicates");
    await flush();
    expect(bodyText()).toContain("No possible duplicates found.");
  });
});

describe("PersonPanel their data", () => {
  it("exports the person's data as text the owner can copy", async () => {
    const mock = detailMock({}, {}, { export: vi.fn(async () => ({ json: '{"name":"Ada"}' })) });
    await open(mock);
    clickButton("Export");
    await flush();
    expect(mock.people.export).toHaveBeenCalledWith({ personId: "p1" });
    const text = document.querySelector<HTMLTextAreaElement>("textarea[readonly]");
    expect(text?.value).toBe('{"name":"Ada"}');
  });

  it("deletes only after a typed DELETE_PERSON confirmation and then reports the person gone", async () => {
    const mock = detailMock();
    const props = await open(mock);
    clickButton("Delete person data");
    await flush();
    expect(confirm).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Delete this person's data?",
        danger: true,
        requireText: expect.objectContaining({ text: "DELETE_PERSON" }),
      }),
    );
    expect(mock.people.delete).toHaveBeenCalledWith("p1");
    expect(props.onDeleted).toHaveBeenCalledWith("p1");
  });

  it("keeps the person when the owner does not confirm the deletion", async () => {
    confirm.mockImplementation(async () => false);
    const mock = detailMock();
    const props = await open(mock);
    clickButton("Delete person data");
    await flush();
    expect(mock.people.delete).not.toHaveBeenCalled();
    expect(props.onDeleted).not.toHaveBeenCalled();
    expect(buttonByText("Delete person data")).toBeTruthy();
  });

  it("shows the Host reason when the deletion is refused and does not report the person gone", async () => {
    const mock = detailMock();
    mock.people.delete.mockRejectedValueOnce(new Error("Deletion needs the owner."));
    const props = await open(mock);
    clickButton("Delete person data");
    await flush();
    expect(bodyText()).toContain("Deletion needs the owner.");
    expect(props.onDeleted).not.toHaveBeenCalled();
  });
});
