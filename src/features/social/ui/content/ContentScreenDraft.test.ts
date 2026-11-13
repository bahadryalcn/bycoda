// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SocialScreenProps } from "../shell/screens";
import type { ContentEditorProps } from "./ContentEditor";
import { ContentScreen } from "./ContentScreen";

// The editor has its own tests. Here it is a stub that exposes what the screen hands it.
const editor: { props?: ContentEditorProps } = {};
vi.mock("./ContentEditor", () => ({
  ContentEditor: (props: ContentEditorProps) => {
    editor.props = props;
    return createElement("div", { "data-testid": "editor" });
  },
}));
vi.mock("../../hooks/useSocialMediaEditor", () => ({
  useSocialMediaEditor: () => ({}),
}));

const confirmDiscard = vi.fn(async () => true);
vi.mock("../../../../shared/ui/ConfirmDialog", () => ({
  useConfirm: () => ({ confirm: confirmDiscard, dialog: null }),
}));
const refetch = vi.fn();
const state: { data: Record<string, unknown> } = { data: {} };
vi.mock("./useContentData", () => ({
  useContentData: () => state.data,
}));

let element: HTMLDivElement;
let root: Root;

const account = { id: "x1", platform: "x", name: "Studio", grants: { p1: ["draft"] } };
const campaign = {
  id: "c1",
  name: "Launch week",
  projectIds: ["p1"],
  revision: 3,
  paused: false,
  createdAt: 1,
  variants: [
    {
      accountId: "x1",
      text: "Hello",
      media: [],
      scheduledAt: Date.now() + 86_400_000,
      factIds: [],
    },
  ],
};
const job = {
  id: "j1",
  accountId: "x1",
  campaignId: "c1",
  kind: "publish",
  status: "queued",
  scheduledAt: Date.now() + 86_400_000,
  payload: { text: "Hello", media: [] },
};

function snapshot(jobs: unknown[] = []) {
  return {
    accounts: [account],
    campaigns: [campaign],
    jobs,
    profiles: [],
    capabilities: {},
    sendingEnabled: true,
  };
}

function props(patch: Partial<SocialScreenProps> = {}): SocialScreenProps {
  return {
    client: {} as SocialScreenProps["client"],
    machineId: "m1",
    projectId: "p1",
    shellState: { hostOnline: true, unreachable: false, aiStopped: false },
    active: true,
    onNavigate: vi.fn(),
    ...patch,
  } as SocialScreenProps;
}

function render(screen: SocialScreenProps = props()) {
  act(() => root.render(createElement(ContentScreen, screen)));
}

const text = () => element.textContent ?? "";
const buttonWith = (label: string) =>
  [...element.querySelectorAll("button")].find((item) => item.textContent?.trim() === label);
const editorOpen = () => element.querySelector('[data-testid="editor"]') !== null;
const draft = () => editor.props!.draft;

function typeInEditor(value: string) {
  act(() => editor.props!.onDraft({ ...editor.props!.draft, text: value }));
}

function openSavedPost() {
  act(() => buttonWith("List")!.click());
  act(() =>
    [...element.querySelectorAll<HTMLButtonElement>(".content-row")]
      .find((row) => row.textContent?.includes("Launch week"))!
      .click(),
  );
}

beforeEach(() => {
  element = document.createElement("div");
  document.body.append(element);
  root = createRoot(element);
  refetch.mockClear();
  state.data = { snapshot: snapshot(), programs: [], loading: false, refetch };
  editor.props = undefined;
});

afterEach(() => {
  act(() => root.unmount());
  element.remove();
});

describe("opening the editor", () => {
  it("starts New post with an empty draft that sends immediately", () => {
    render();
    expect(editorOpen()).toBe(false);
    act(() => buttonWith("New post")!.click());
    expect(editorOpen()).toBe(true);
    expect(draft()).toMatchObject({ text: "", accountIds: [], when: "now" });
    expect(draft().campaignId).toBeUndefined();
    expect(editor.props!.projectId).toBe("p1");
  });

  it("opens a calendar day as a later post at 09:00 on that day", () => {
    render();
    const day = element.querySelector<HTMLButtonElement>('button[aria-label^="New post on"]')!;
    act(() => day.click());
    expect(draft().when).toBe("later");
    expect(draft().scheduledAt).toMatch(/^\d{4}-\d{2}-\d{2}T09:00$/);
  });

  it("loads a saved post with its id and revision", () => {
    render();
    openSavedPost();
    expect(draft()).toMatchObject({
      campaignId: "c1",
      revision: 3,
      name: "Launch week",
      text: "Hello",
      accountIds: ["x1"],
    });
  });
});

describe("unsaved drafts are not lost", () => {
  it("keeps words typed into a new post when the editor is closed and opened again", () => {
    render();
    act(() => buttonWith("New post")!.click());
    typeInEditor("Half-written idea");
    act(() => editor.props!.onClose());
    expect(editorOpen()).toBe(false);
    act(() => buttonWith("New post")!.click());
    expect(draft().text).toBe("Half-written idea");
  });

  it("keeps the draft when a calendar day is picked while it exists", () => {
    render();
    act(() => buttonWith("New post")!.click());
    typeInEditor("Half-written idea");
    act(() => editor.props!.onClose());
    act(() =>
      element.querySelector<HTMLButtonElement>('button[aria-label^="New post on"]')!.click(),
    );
    expect(draft().text).toBe("Half-written idea");
    expect(draft().when).toBe("now");
  });

  it("does not replace the unsaved draft with a saved post, and says why", () => {
    render();
    act(() => buttonWith("New post")!.click());
    typeInEditor("Half-written idea");
    act(() => editor.props!.onClose());
    openSavedPost();
    expect(text()).toContain("Finish the post you are writing first, or discard it.");
    expect(editorOpen()).toBe(false);
    act(() => buttonWith("New post")!.click());
    expect(draft().text).toBe("Half-written idea");
  });

  it("forgets a saved post when it is closed, so the next New post is empty", () => {
    render();
    openSavedPost();
    act(() => editor.props!.onClose());
    act(() => buttonWith("New post")!.click());
    expect(draft().text).toBe("");
    expect(draft().campaignId).toBeUndefined();
  });
});

describe("posts that were already scheduled", () => {
  it("locks a post that has jobs and says why", () => {
    state.data = { snapshot: snapshot([job]), programs: [], loading: false, refetch };
    render();
    openSavedPost();
    expect(editor.props!.locked).toBe(
      "This post was already scheduled or sent, so it can't be edited here.",
    );
  });

  it("leaves a draft with no jobs editable", () => {
    render();
    openSavedPost();
    expect(editor.props!.locked).toBeUndefined();
  });

  it("does not lock a new post because some other post has jobs", () => {
    state.data = { snapshot: snapshot([job]), programs: [], loading: false, refetch };
    render();
    act(() => buttonWith("New post")!.click());
    expect(editor.props!.locked).toBeUndefined();
  });
});

describe("after the editor finishes", () => {
  it.each([
    ["published", "Posts are being published. Follow the results in this calendar."],
    ["scheduled", "Posts scheduled. Follow the results in this calendar."],
    ["draft", "Draft saved."],
    ["program", "Repeating program saved as paused. Review it before it starts."],
  ] as const)(
    "closes the editor, clears the draft, reloads and says what happened (%s)",
    (outcome, message) => {
      render();
      act(() => buttonWith("New post")!.click());
      typeInEditor("Done");
      act(() => editor.props!.onDone(outcome));
      expect(editorOpen()).toBe(false);
      expect(text()).toContain(message);
      expect(refetch).toHaveBeenCalledTimes(1);
      act(() => buttonWith("New post")!.click());
      expect(draft().text).toBe("");
      expect(text()).not.toContain(message);
    },
  );
});

it("exposes the hidden draft for recovery and explicit discard", () => {
  render();
  act(() => buttonWith("New post")!.click());
  typeInEditor("Keep my draft");
  act(() => editor.props!.onClose());
  expect(buttonWith("Resume draft")).toBeDefined();
  act(() => buttonWith("Resume draft")!.click());
  expect(draft().text).toBe("Keep my draft");
  act(() => editor.props!.onClose());
  expect(buttonWith("Discard draft")).toBeDefined();
});

it("discards only after confirmation and leaves a fresh post available", async () => {
  render();
  act(() => buttonWith("New post")!.click());
  typeInEditor("Keep unless confirmed");
  act(() => editor.props!.onClose());
  confirmDiscard.mockResolvedValueOnce(false);
  await act(async () => buttonWith("Discard draft")!.click());
  expect(buttonWith("Resume draft")).toBeDefined();
  await act(async () => buttonWith("Discard draft")!.click());
  expect(buttonWith("Resume draft")).toBeUndefined();
  act(() => buttonWith("New post")!.click());
  expect(draft().text).toBe("");
});

it("preserves edited saved posts after closing, including non-text changes", () => {
  render();
  openSavedPost();
  act(() => editor.props!.onDraft({ ...draft(), link: "https://example.com/changed" }));
  act(() => editor.props!.onClose());
  expect(buttonWith("Resume draft")).toBeDefined();
  act(() => buttonWith("Resume draft")!.click());
  expect(draft()).toMatchObject({ campaignId: "c1", link: "https://example.com/changed" });
});

it("retains separate project drafts and binds delayed completion to its original project", () => {
  const client = {} as SocialScreenProps["client"];
  render(props({ client }));
  act(() => buttonWith("New post")!.click());
  typeInEditor("Project one");
  const original = editor.props!;
  render(props({ client, projectId: "p2" }));
  expect(editorOpen()).toBe(false);
  act(() => buttonWith("New post")!.click());
  typeInEditor("Project two");
  act(() => original.onSaved({ campaignId: "saved-p1", revision: 1 }));
  expect(draft().text).toBe("Project two");
  act(() => original.onDone("draft"));
  expect(editorOpen()).toBe(true);
  expect(draft().text).toBe("Project two");
  render(props({ client }));
  act(() => buttonWith("New post")!.click());
  expect(draft().text).toBe("");
});

it("restores local work when returning to its Host and project", () => {
  const client = {} as SocialScreenProps["client"];
  render(props({ client }));
  act(() => buttonWith("New post")!.click());
  typeInEditor("Project one");
  render(props({ client, projectId: "p2" }));
  act(() => buttonWith("New post")!.click());
  typeInEditor("Project two");
  render(props({ client }));
  expect(draft().text).toBe("Project one");
  expect(editor.props!.projectId).toBe("p1");
  render(props({ client: {} as SocialScreenProps["client"] }));
  expect(editorOpen()).toBe(false);
});

it("retains busy state and errors on their original project while its editor is unmounted", () => {
  const client = {} as SocialScreenProps["client"];
  render(props({ client }));
  act(() => buttonWith("New post")!.click());
  typeInEditor("Project one");
  const original = editor.props!;
  act(() => original.onBusyChange?.(true));
  render(props({ client, projectId: "p2" }));
  act(() => buttonWith("New post")!.click());
  typeInEditor("Project two");
  render(props({ client }));
  expect(editor.props!.operationPending).toBe(true);
  expect(draft().text).toBe("Project one");
  render(props({ client, projectId: "p2" }));
  act(() => original.onOperationError?.("Original project failed"));
  act(() => original.onBusyChange?.(false));
  expect(text()).not.toContain("Original project failed");
  expect(draft().text).toBe("Project two");
  render(props({ client }));
  expect(editor.props!.operationPending).toBe(false);
  expect(text()).toContain("Original project failed");
});

it("exposes bounded content continuation and warns that the calendar/list is partial", () => {
  const loadMore = vi.fn();
  state.data = {
    snapshot: snapshot(),
    programs: [],
    loading: false,
    refetch,
    hasMore: true,
    loadMore,
  };
  render();
  expect(text()).toContain(
    "More posts are available. Load more to include older posts in this view.",
  );
  act(() => buttonWith("Load more")!.click());
  expect(loadMore).toHaveBeenCalledOnce();
});

it("treats a saved edit restored to its loaded values as clean", () => {
  render();
  openSavedPost();
  typeInEditor("Changed");
  typeInEditor("Hello");
  act(() => editor.props!.onClose());
  expect(buttonWith("Resume draft")).toBeUndefined();
  act(() => buttonWith("New post")!.click());
  expect(draft().text).toBe("");
});
