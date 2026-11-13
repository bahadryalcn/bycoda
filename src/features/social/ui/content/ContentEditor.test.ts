// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SocialAccount, SocialSnapshot } from "../../model/social";
import type { SocialClient } from "../../model/socialClient";
import type { SocialMediaEditor } from "../../model/socialMediaEditor";
import { ContentEditor, type ContentEditorProps } from "./ContentEditor";
import { emptyDraft, type ContentDraft } from "./contentDraft";
import type { ContentEditorFieldsProps } from "./ContentEditorFields";

// The fields and the TikTok creator lookup have their own tests; this file covers the save and publish flows.
const fields: { props?: ContentEditorFieldsProps } = {};
vi.mock("./ContentEditorFields", () => ({
  ContentEditorFields: (props: ContentEditorFieldsProps) => {
    fields.props = props;
    return createElement("div", { "data-testid": "fields" });
  },
}));
vi.mock("./useTikTokCreators", () => ({ useTikTokCreators: () => ({}) }));

let element: HTMLDivElement;
let root: Root;

const account = {
  id: "x1",
  platform: "x",
  platformId: "x1-platform",
  name: "Studio",
  accountType: "member",
  scopes: [],
  accessApproved: true,
  connected: true,
  connection: "oauth",
  paused: false,
  executorId: "exec",
  grants: { p1: ["read", "draft", "publish"] },
  createdAt: 1,
} as unknown as SocialAccount;

const available = {
  operation: "publish",
  status: "available",
  reason: "",
  reasonCode: "api.ready",
  scopes: [],
  source: "test",
};

function snapshot(patch: Record<string, unknown> = {}): SocialSnapshot {
  return {
    accounts: [account],
    campaigns: [],
    jobs: [],
    profiles: [],
    capabilities: { x1: [available] },
    policies: { global: {}, platforms: {} },
    sendingEnabled: true,
    ...patch,
  } as unknown as SocialSnapshot;
}

const saved = {
  id: "c1",
  revision: 2,
  name: "Hello",
  projectIds: ["p1"],
  variants: [],
  paused: false,
  createdAt: 1,
};
const okPreview = { campaign: saved, targets: [{ accountId: "x1", capability: available }] };

type Handlers = Partial<Record<string, (payload: unknown) => unknown>>;
let handlers: Handlers;
const request = vi.fn(async (action: string, payload?: unknown) => {
  const handler = handlers[action];
  return handler ? handler(payload) : {};
});
const onDone = vi.fn();
const onClose = vi.fn();
const onNavigate = vi.fn();
const onDraft = vi.fn();
const onSaved = vi.fn();

function draftOf(patch: Partial<ContentDraft> = {}): ContentDraft {
  return { ...emptyDraft(), text: "Hello", accountIds: ["x1"], ...patch };
}

function render(patch: Partial<ContentEditorProps> = {}) {
  act(() =>
    root.render(
      createElement(ContentEditor, {
        client: { request } as unknown as SocialClient,
        editor: {} as SocialMediaEditor,
        snapshot: snapshot(),
        projectId: "p1",
        shell: { hostOnline: true, unreachable: false, aiStopped: false },
        draft: draftOf(),
        onDraft,
        onSaved,
        onDone,
        onClose,
        onNavigate,
        ...patch,
      }),
    ),
  );
}

const body = () => document.body.textContent ?? "";
const button = (label: string) =>
  [...document.body.querySelectorAll("button")].find((item) => item.textContent?.trim() === label);
const reasonOf = (label: string) => {
  const id = button(label)?.getAttribute("aria-describedby");
  return id ? document.getElementById(id)?.textContent : undefined;
};
const actions = () => request.mock.calls.map(([action]) => action);

async function flush() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function click(label: string) {
  act(() => button(label)!.click());
  await flush();
}

beforeEach(() => {
  element = document.createElement("div");
  document.body.append(element);
  root = createRoot(element);
  handlers = {
    "campaigns.create": () => saved,
    "campaigns.preview": () => okPreview,
  };
  request.mockClear();
  onDone.mockClear();
  onClose.mockClear();
  onNavigate.mockClear();
  onDraft.mockClear();
  onSaved.mockClear();
});

afterEach(() => {
  act(() => root.unmount());
  element.remove();
});

describe("publishing", () => {
  it("saves, checks, approves and schedules, then reports the post as published", async () => {
    render();
    await click("Publish");
    expect(actions()).toEqual([
      "campaigns.create",
      "campaigns.preview",
      "campaigns.approveReviewed",
      "campaigns.schedule",
    ]);
    expect(onDone).toHaveBeenCalledWith("published");
  });

  it("calls a later post 'Schedule' and reports it as scheduled", async () => {
    render({ draft: draftOf({ when: "later", scheduledAt: "2099-01-05T14:30" }) });
    expect(button("Publish")).toBeUndefined();
    await click("Schedule");
    expect(onDone).toHaveBeenCalledWith("scheduled");
    const variants = (request.mock.calls[0]![1] as { variants: { scheduledAt: number }[] })
      .variants;
    expect(variants[0]!.scheduledAt).toBe(new Date(2099, 0, 5, 14, 30).getTime());
  });

  it("sends the project, the account and the trimmed text of the draft", async () => {
    render({ draft: draftOf({ text: "  Hello  " }) });
    await click("Publish");
    expect(request.mock.calls[0]![1]).toMatchObject({
      name: "Hello",
      projectIds: ["p1"],
      variants: [{ accountId: "x1", text: "Hello" }],
    });
  });

  it("sends the revision when a saved post is edited", async () => {
    render({ draft: draftOf({ campaignId: "c1", revision: 4 }) });
    expect(body()).toContain("Edit post");
    await click("Save draft");
    expect(request.mock.calls[0]![1]).toMatchObject({ id: "c1", expectedRevision: 4 });
  });

  it("runs one publish even when the button is pressed twice", async () => {
    render();
    act(() => {
      button("Publish")!.click();
      button("Publish")!.click();
    });
    await flush();
    expect(actions().filter((action) => action === "campaigns.create")).toHaveLength(1);
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it("lists every refused account, schedules nothing and keeps the editor open", async () => {
    handlers["campaigns.preview"] = () => ({
      campaign: saved,
      targets: [{ accountId: "x1", contentError: "This text is too long.", capability: available }],
    });
    render();
    await click("Publish");
    expect(body()).toContain("X · Studio: This text is too long.");
    expect(actions()).toEqual(["campaigns.create", "campaigns.preview"]);
    expect(onDone).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(button("Publish")?.disabled).toBe(false);
  });

  it("explains a refused account with the connection reason when there is no content error", async () => {
    handlers["campaigns.preview"] = () => ({
      campaign: saved,
      targets: [
        {
          accountId: "x1",
          capability: { status: "expired", reason: "", reasonCode: "api.token_expired" },
        },
      ],
    });
    render();
    await click("Publish");
    expect(body()).toContain("X · Studio: Connection needed");
    expect(actions()).not.toContain("campaigns.approveReviewed");
  });

  it("clears the refusal list on the next attempt", async () => {
    handlers["campaigns.preview"] = () => ({
      campaign: saved,
      targets: [{ accountId: "x1", contentError: "This text is too long.", capability: available }],
    });
    render();
    await click("Publish");
    expect(body()).toContain("This text is too long.");
    handlers["campaigns.preview"] = () => okPreview;
    await click("Publish");
    expect(body()).not.toContain("This text is too long.");
    expect(onDone).toHaveBeenCalledWith("published");
  });

  it("reports the saved post before a refused preview, so a retry revises it instead of copying it", async () => {
    handlers["campaigns.preview"] = () => ({
      campaign: saved,
      targets: [{ accountId: "x1", contentError: "This text is too long.", capability: available }],
    });
    render();
    await click("Publish");
    expect(onSaved).toHaveBeenCalledWith({ campaignId: "c1", revision: 2 });
    // The screen keeps that identity on the draft; the next publish sends it.
    render({ draft: draftOf({ campaignId: "c1", revision: 2 }) });
    handlers["campaigns.preview"] = () => okPreview;
    await click("Publish");
    const creates = request.mock.calls.filter(([action]) => action === "campaigns.create");
    expect(creates.at(-1)![1]).toMatchObject({ id: "c1", expectedRevision: 2 });
    expect(onDone).toHaveBeenCalledWith("published");
  });

  it("reports the saved post when scheduling fails after the save, and does not report success", async () => {
    handlers["campaigns.schedule"] = () => {
      throw new Error("Scheduling is offline.");
    };
    render();
    await click("Publish");
    expect(onSaved).toHaveBeenCalledWith({ campaignId: "c1", revision: 2 });
    expect(onDone).not.toHaveBeenCalled();
  });

  it("shows a failed schedule as an error and does not report success", async () => {
    handlers["campaigns.schedule"] = () => {
      throw new Error("Scheduling is offline.");
    };
    render();
    await click("Publish");
    expect(body()).toContain("Scheduling is offline.");
    expect(onDone).not.toHaveBeenCalled();
    expect(button("Publish")?.disabled).toBe(false);
  });
});

describe("saving a draft", () => {
  it("only saves, then reports a draft", async () => {
    render();
    await click("Save draft");
    expect(actions()).toEqual(["campaigns.create"]);
    expect(onDone).toHaveBeenCalledWith("draft");
  });

  it("keeps the editor and the draft when the save fails, and allows another try", async () => {
    handlers["campaigns.create"] = () => {
      throw new Error("The campaign was changed by someone else.");
    };
    render();
    await click("Save draft");
    expect(body()).toContain("The campaign was changed by someone else.");
    expect(onDone).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(onDraft).not.toHaveBeenCalled();
    expect(button("Save draft")?.disabled).toBe(false);
  });

  it("saves a draft that is over the character limit, because nothing is sent", async () => {
    render({
      snapshot: snapshot({ policies: { global: { maxContentCharacters: 3 }, platforms: {} } }),
    });
    expect(button("Publish")?.disabled).toBe(true);
    await click("Save draft");
    expect(onDone).toHaveBeenCalledWith("draft");
  });
});

describe("closed gates", () => {
  it("shows the first problem as the reason next to Publish", () => {
    render({
      snapshot: snapshot({ policies: { global: { maxContentCharacters: 3 }, platforms: {} } }),
    });
    expect(button("Publish")?.disabled).toBe(true);
    expect(reasonOf("Publish")).toBe(
      "X · Studio: Content for this account can be at most 3 characters.",
    );
  });

  it("says sending is off, links to Accounts & Settings, and still allows a draft", async () => {
    render({ snapshot: snapshot({ sendingEnabled: false }) });
    expect(button("Publish")?.disabled).toBe(true);
    expect(reasonOf("Publish")).toBe("Sending is off. Turn it on in Accounts & Settings.");
    act(() => button("Open Accounts & Settings")!.click());
    expect(onNavigate).toHaveBeenCalledWith("accounts");
    await click("Save draft");
    expect(onDone).toHaveBeenCalledWith("draft");
  });

  it("blocks both actions while the Host is offline and sends nothing", async () => {
    render({ shell: { hostOnline: false, unreachable: false, aiStopped: false } });
    expect(button("Publish")?.disabled).toBe(true);
    expect(button("Save draft")?.disabled).toBe(true);
    expect(reasonOf("Publish")).toContain("Scheduling is offline");
    await click("Publish");
    expect(request).not.toHaveBeenCalled();
  });

  it("blocks both actions when the last read of the Host failed", () => {
    render({ shell: { hostOnline: true, unreachable: true, aiStopped: false } });
    expect(button("Publish")?.disabled).toBe(true);
    expect(button("Save draft")?.disabled).toBe(true);
  });

  it("states that a post that was already scheduled or sent cannot be changed", () => {
    render({ locked: "This post was already scheduled or sent, so it can't be edited here." });
    expect(body()).toContain("This post was already scheduled or sent");
    expect(button("Publish")?.disabled).toBe(true);
    expect(button("Save draft")?.disabled).toBe(true);
    expect(reasonOf("Save draft")).toBe(
      "This post was already scheduled or sent, so it can't be edited here.",
    );
  });

  it("asks for an account or content before a draft can be saved", () => {
    render({ draft: draftOf({ accountIds: [] }) });
    expect(reasonOf("Save draft")).toBe("Choose at least one account.");
    render({ draft: draftOf({ text: "" }) });
    expect(reasonOf("Save draft")).toBe("Write the post or attach media.");
  });

  it("blocks publishing when a chosen account is gone, and names the reason", () => {
    render({ draft: draftOf({ accountIds: ["x1", "gone"] }) });
    expect(button("Publish")?.disabled).toBe(true);
    expect(reasonOf("Publish")).toBe(
      "This account is no longer available. Uncheck it to continue.",
    );
  });

  it("waits for the accounts to load", () => {
    render({ snapshot: undefined });
    expect(reasonOf("Publish")).toBe("Loading accounts…");
  });
});

describe("repeating posts", () => {
  const repeat = { enabled: true, minMinutes: 60, maxMinutes: 120, totalPosts: 5 };

  it("saves a paused program instead of publishing, and never creates a campaign", async () => {
    render({ draft: draftOf({ repeat }) });
    expect(button("Publish")).toBeUndefined();
    await click("Save as paused program");
    expect(actions()).toEqual(["programs.configure"]);
    expect(onDone).toHaveBeenCalledWith("program");
  });

  it("blocks an invalid repeat with the reason", () => {
    render({ draft: draftOf({ repeat: { ...repeat, maxMinutes: 30 } }) });
    expect(button("Save as paused program")?.disabled).toBe(true);
    expect(reasonOf("Save as paused program")).toBe(
      "Repeat: the longest interval must be at least the shortest.",
    );
  });

  it("keeps the editor open when the program cannot be saved", async () => {
    handlers["programs.configure"] = () => {
      throw new Error("Program limit reached.");
    };
    render({ draft: draftOf({ repeat }) });
    await click("Save as paused program");
    expect(body()).toContain("Program limit reached.");
    expect(onDone).not.toHaveBeenCalled();
  });
});

it.each(["Save draft", "Publish"])(
  "freezes submitted fields and stale change callbacks during %s",
  async (label) => {
    let resolve!: (value: typeof saved) => void;
    handlers["campaigns.create"] = () =>
      new Promise((done) => {
        resolve = done;
      });
    const onBusyChange = vi.fn();
    render({ onBusyChange });
    const changeBeforeSubmit = fields.props!.onDraft;
    await click(label);
    expect(fields.props!.locked).toBe("Wait for the current action to finish.");
    expect(onBusyChange).toHaveBeenLastCalledWith(true);
    act(() => changeBeforeSubmit(draftOf({ text: "Late media or text callback" })));
    expect(onDraft).not.toHaveBeenCalled();
    const close = document.body.querySelector<HTMLButtonElement>('button[aria-label="Close"]');
    act(() => close?.click());
    expect(onClose).not.toHaveBeenCalled();
    await act(async () => resolve(saved));
    await flush();
    expect(onDone).toHaveBeenCalledOnce();
    expect(onBusyChange).toHaveBeenLastCalledWith(false);
  },
);

it("unfreezes failed saves and reports retained-scope recovery feedback", async () => {
  let reject!: (error: Error) => void;
  handlers["campaigns.create"] = () =>
    new Promise((_done, no) => {
      reject = no;
    });
  const onBusyChange = vi.fn();
  const onOperationError = vi.fn();
  render({ onBusyChange, onOperationError });
  await click("Save draft");
  await act(async () => reject(new Error("Revision conflict")));
  expect(fields.props!.locked).toBeUndefined();
  expect(onDone).not.toHaveBeenCalled();
  expect(onBusyChange).toHaveBeenLastCalledWith(false);
  expect(onOperationError).toHaveBeenCalledWith("Revision conflict");
  act(() => fields.props!.onDraft(draftOf({ text: "Keep editing" })));
  expect(onDraft).toHaveBeenCalledWith(expect.objectContaining({ text: "Keep editing" }));
});

it("keeps a remounted editor frozen while its original scope has a pending operation", () => {
  render({ operationPending: true });
  expect(fields.props!.locked).toBe("Wait for the current action to finish.");
  expect(button("Publish")?.disabled).toBe(true);
  act(() => fields.props!.onDraft(draftOf({ text: "Rejected" })));
  expect(onDraft).not.toHaveBeenCalled();
});

it("holds publishing while an attachment is in flight, then accepts its completion", async () => {
  render();
  act(() => fields.props!.onMediaBusyChange?.(true));
  expect(button("Publish")?.disabled).toBe(true);
  expect(button("Save draft")?.disabled).toBe(true);
  act(() =>
    fields.props!.onDraft(
      draftOf({
        media: [
          { localId: "upload", name: "photo.png", media: { kind: "image", uploadId: "upload" } },
        ],
      }),
    ),
  );
  expect(onDraft).toHaveBeenCalledWith(
    expect.objectContaining({ media: [expect.objectContaining({ localId: "upload" })] }),
  );
  act(() => fields.props!.onMediaBusyChange?.(false));
  expect(button("Publish")?.disabled).toBe(false);
  expect(request).not.toHaveBeenCalled();
});
