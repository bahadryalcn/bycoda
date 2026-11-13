// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Capability, SocialAccount } from "../../model/social";
import { ContentEditorFields, type ContentEditorFieldsProps } from "./ContentEditorFields";
import { useContentDraft } from "./useContentDraft";
import { emptyDraft, type ContentDraft } from "./contentDraft";
import type { ContentMediaFieldProps } from "./ContentMediaField";

// The AI box, the media picker and the autosizing textarea have their own tests; the picker is
// replaced by a marker so this file can read the state the editor hands it.
vi.mock("./ContentEditorAi", () => ({ ContentEditorAi: () => null }));
const mediaField: { props?: ContentMediaFieldProps } = {};
vi.mock("./ContentMediaField", () => ({
  ContentMediaField: (props: ContentMediaFieldProps) => {
    mediaField.props = props;
    return createElement("div", {
      "data-testid": "media",
      "data-disabled": String(props.disabled),
      "data-reason": props.disabledReason ?? "",
    });
  },
}));
vi.mock("../../../../shared/ui/TextareaField", () => ({
  TextareaField: (props: { label: string; value: string; disabled?: boolean }) =>
    createElement("textarea", {
      "aria-label": props.label,
      value: props.value,
      disabled: props.disabled,
      readOnly: true,
    }),
}));

let element: HTMLDivElement;
let root: Root;
const onDraft = vi.fn();
const onNavigate = vi.fn();

function account(
  id: string,
  platform: SocialAccount["platform"],
  name: string,
  grants: SocialAccount["grants"] = { p1: ["draft"] },
) {
  return { id, platform, name, grants } as SocialAccount;
}

function capability(operation: Capability["operation"], status: Capability["status"]): Capability {
  return {
    operation,
    status,
    reason: "",
    reasonCode: status === "available" ? "api.ready" : "unsupported.not_yet",
    scopes: [],
    source: "test",
  };
}

const x = account("x1", "x", "Studio X");
const facebook = account("fb1", "facebook", "Studio FB");
const tiktok = account("tt1", "tiktok", "Studio TikTok");

function snapshotOf(accounts: SocialAccount[], media: Record<string, Capability["status"]> = {}) {
  return {
    accounts,
    capabilities: Object.fromEntries(
      accounts.map((item) => [
        item.id,
        [capability("publish", "available"), capability("media", media[item.id] ?? "available")],
      ]),
    ),
  } as unknown as ContentEditorFieldsProps["snapshot"];
}

function render(draft: Partial<ContentDraft>, patch: Partial<ContentEditorFieldsProps> = {}) {
  act(() =>
    root.render(
      createElement(ContentEditorFields, {
        client: {} as never,
        editor: {} as never,
        snapshot: snapshotOf([x, facebook, tiktok]),
        projectId: "p1",
        draft: { ...emptyDraft(), ...draft },
        onDraft,
        aiStopped: false,
        creators: {},
        onNavigate,
        ...patch,
      }),
    ),
  );
}

function media() {
  const node = element.querySelector<HTMLElement>('[data-testid="media"]')!;
  return { disabled: node.dataset.disabled, reason: node.dataset.reason };
}

function accountBox(name: string): HTMLInputElement | undefined {
  const row = [...element.querySelectorAll("label.content-account")].find((item) =>
    item.textContent?.includes(name),
  );
  return row?.querySelector<HTMLInputElement>('input[type="checkbox"]') ?? undefined;
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  element = document.createElement("div");
  document.body.append(element);
  root = createRoot(element);
  onDraft.mockReset();
  onNavigate.mockReset();
});

afterEach(() => {
  act(() => root.unmount());
  element.remove();
  vi.unstubAllGlobals();
});

describe("ContentEditorFields media gate", () => {
  it("leaves the picker on when no account is chosen yet", () => {
    render({});
    expect(media()).toEqual({ disabled: "false", reason: "" });
  });

  it("turns the picker off with the account's reason when no chosen account can upload media", () => {
    render(
      { accountIds: ["x1"] },
      { snapshot: snapshotOf([x, facebook, tiktok], { x1: "unsupported" }) },
    );
    expect(media()).toEqual({ disabled: "true", reason: "Not available yet" });
  });

  it("keeps the picker on when at least one chosen account can upload media", () => {
    render(
      { accountIds: ["x1", "fb1"] },
      { snapshot: snapshotOf([x, facebook, tiktok], { x1: "unsupported" }) },
    );
    expect(media().disabled).toBe("false");
  });

  it("turns the picker off with the lock reason when the post is already scheduled", () => {
    render({ accountIds: ["x1"] }, { locked: "Already scheduled." });
    expect(media()).toEqual({ disabled: "true", reason: "Already scheduled." });
    expect(element.querySelector<HTMLFieldSetElement>("fieldset.content-accounts")?.disabled).toBe(
      true,
    );
    expect(element.querySelector<HTMLFieldSetElement>("fieldset.content-when")?.disabled).toBe(
      true,
    );
    expect(element.querySelector<HTMLTextAreaElement>("textarea")?.disabled).toBe(true);
  });
});

describe("ContentEditorFields accounts", () => {
  it("disables an account without draft access and says why, but never traps a chosen one", () => {
    const noAccess = account("li1", "linkedin", "Studio LinkedIn", {});
    const snapshot = snapshotOf([x, noAccess]);
    render({}, { snapshot });
    expect(accountBox("Studio LinkedIn")?.disabled).toBe(true);
    expect(element.textContent).toContain(
      "No access to this project. Grant it in Accounts & Settings.",
    );
    expect(accountBox("Studio X")?.disabled).toBe(false);
    render({ accountIds: ["li1"] }, { snapshot });
    expect(accountBox("Studio LinkedIn")?.disabled).toBe(false);
    expect(accountBox("Studio LinkedIn")?.checked).toBe(true);
  });

  it("adds and removes an account from the draft", () => {
    render({});
    act(() => accountBox("Studio X")?.click());
    expect(onDraft).toHaveBeenLastCalledWith(expect.objectContaining({ accountIds: ["x1"] }));
    render({ accountIds: ["x1", "fb1"] });
    act(() => accountBox("Studio X")?.click());
    expect(onDraft).toHaveBeenLastCalledWith(expect.objectContaining({ accountIds: ["fb1"] }));
  });

  it("shows a chosen account that is gone as checked, and unchecking it removes it from the draft", () => {
    render({ accountIds: ["x1", "gone"] });
    const gone = [...element.querySelectorAll("label.content-account")].find((item) =>
      item.textContent?.includes("Account no longer available"),
    );
    expect(gone?.querySelector<HTMLInputElement>('input[type="checkbox"]')?.checked).toBe(true);
    act(() => gone?.querySelector<HTMLInputElement>('input[type="checkbox"]')?.click());
    expect(onDraft).toHaveBeenLastCalledWith(expect.objectContaining({ accountIds: ["x1"] }));
  });

  it("sends the owner to Accounts & Settings when there is no account", () => {
    render({}, { snapshot: snapshotOf([]) });
    expect(element.textContent).toContain("No accounts yet. Connect one in Accounts & Settings.");
    const button = [...element.querySelectorAll("button")].find(
      (item) => item.textContent?.trim() === "Accounts & Settings",
    );
    act(() => button?.click());
    expect(onNavigate).toHaveBeenCalledWith("accounts");
  });
});

describe("ContentEditorFields platform options", () => {
  it("shows one options section per chosen account in the chosen order", () => {
    render({ accountIds: ["tt1", "fb1"] });
    const sections = [...element.querySelectorAll("section.content-platform-section")].map((item) =>
      item.getAttribute("aria-label"),
    );
    expect(sections).toEqual(["Studio TikTok", "Studio FB"]);
  });

  it("writes a platform change under that account only and keeps the other accounts' options", () => {
    render({
      accountIds: ["fb1", "tt1"],
      platform: { tt1: { tiktok: { consent: true } } },
    });
    const destination = element.querySelector<HTMLSelectElement>(
      'section[aria-label="Studio FB"] select',
    )!;
    act(() => {
      destination.value = "reel";
      destination.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(onDraft).toHaveBeenLastCalledWith(
      expect.objectContaining({
        platform: {
          tt1: { tiktok: { consent: true } },
          fb1: { facebook: { target: "reel", frameRate: undefined } },
        },
      }),
    );
  });
});

it("merges delayed media completion into the current text revision", () => {
  render({ text: "Before upload" });
  const completeUpload = mediaField.props!.onChange;
  render({ text: "Typed during upload" });
  act(() =>
    completeUpload([
      { localId: "upload", name: "photo.png", media: { kind: "image", uploadId: "upload" } },
    ]),
  );
  const update = onDraft.mock.lastCall![0];
  expect(update({ ...emptyDraft(), text: "Typed during upload" })).toMatchObject({
    text: "Typed during upload",
    media: [expect.objectContaining({ localId: "upload" })],
  });
});

it("keeps delayed media in its original workspace without replacing edits after A/B/A remount", () => {
  const client = {} as ContentEditorFieldsProps["client"];
  let workspace!: ReturnType<typeof useContentDraft>;
  function Harness({ projectId }: { projectId: string }) {
    workspace = useContentDraft(client, projectId);
    return createElement(ContentEditorFields, {
      key: workspace.key,
      client,
      editor: {} as never,
      projectId,
      draft: workspace.draft,
      onDraft: workspace.setDraft,
      aiStopped: false,
      creators: {},
      onNavigate,
    });
  }
  const show = (projectId: string) => act(() => root.render(createElement(Harness, { projectId })));
  show("A");
  act(() => workspace.setDraft((draft) => ({ ...draft, text: "Before upload" })));
  const completeUpload = mediaField.props!.onChange;
  show("B");
  act(() => workspace.setDraft((draft) => ({ ...draft, text: "Project B" })));
  show("A");
  act(() =>
    workspace.setDraft((draft) => ({
      ...draft,
      text: "New text after return",
      link: "https://example.com/new",
      platform: { tt1: { tiktok: { consent: true } } },
    })),
  );
  const newer = workspace.draft;
  act(() =>
    completeUpload([
      { localId: "upload", name: "photo.png", media: { kind: "image", uploadId: "upload" } },
    ]),
  );
  expect(workspace.draft).toEqual({
    ...newer,
    media: [expect.objectContaining({ localId: "upload" })],
  });
  show("B");
  expect(workspace.draft.text).toBe("Project B");
  expect(workspace.draft.media).toEqual([]);
});
