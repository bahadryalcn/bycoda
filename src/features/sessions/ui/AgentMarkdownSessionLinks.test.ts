// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AgentMarkdown } from "./AgentMarkdown";
import {
  LocalSessionReferenceProvider,
  type LocalSessionReferenceNavigation,
} from "./LocalSessionReferenceContext";
import { buildLocalSessionLink, type LocalSessionReference } from "../model/localSessionReference";
import { NoteEditablePreview } from "../../notes/ui/NoteEditablePreview";

const openWeb = vi.hoisted(() => vi.fn(async () => {}));
vi.mock("../../connections/model/workspaceUrls", () => ({ openWorkspaceUrl: openWeb }));
vi.mock("../../notes/ui/NoteMarkdownEditor", async () => {
  const { createElement } = await import("react");
  return { NoteMarkdownEditor: () => createElement("textarea") };
});

describe("local references in the actual Markdown pipeline", () => {
  let root: Root;
  let host: HTMLDivElement;
  const reference: LocalSessionReference = {
    locator: { kind: "host", environmentId: "environment", sessionId: "stable-session" },
    turnId: "turn-2",
  };
  const href = buildLocalSessionLink(reference);
  let navigation: LocalSessionReferenceNavigation;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    navigation = {
      open: vi.fn(async () => {}),
      resolve: vi.fn(async () => ({
        title: "Current title",
        project: "/repo",
        origin: "Local Host",
        status: "idle",
      })),
    };
    openWeb.mockClear();
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  });

  async function render(text: string, extra = {}) {
    await act(async () =>
      root.render(
        createElement(LocalSessionReferenceProvider, {
          value: navigation,
          children: createElement(AgentMarkdown, { text, ...extra }),
        }),
      ),
    );
  }

  it.each([{}, { allowRemoteMedia: true }, { documentPath: "/repo/note.md" }])(
    "routes validated references through all sanitizer variants %j",
    async (extra) => {
      await render(`[Historic title](${href})`, extra);
      const link = host.querySelector<HTMLAnchorElement>("a")!;
      expect(link?.getAttribute("href")).toBe(href);
      expect(link.textContent).toBe("Historic title");
      expect(navigation.resolve).not.toHaveBeenCalled();
      await act(async () => link.click());
      expect(navigation.open).toHaveBeenCalledWith(reference, { beside: false });
      expect(openWeb).not.toHaveBeenCalled();
    },
  );

  it("accepts a valid raw HTML reference but removes unsupported versions and unsafe schemes", async () => {
    await render(
      `<a href="${href}">Raw</a> [Invalid](bycoda://session/v2/host/environment/stable-session) [Unsafe](javascript:alert%281%29)`,
    );
    expect(host.querySelectorAll("[data-local-session-reference]")).toHaveLength(1);
    const links = [...host.querySelectorAll<HTMLAnchorElement>("a")];
    expect(links.find((link) => link.textContent === "Invalid")?.getAttribute("href")).toBeFalsy();
    expect(links.find((link) => link.textContent === "Unsafe")?.getAttribute("href")).toBeFalsy();
    expect(host.textContent).toContain("Invalid");
    expect(host.textContent).toContain("Unsafe");
  });

  it("retains completed references and selection as a partial streaming target becomes complete", async () => {
    const complete = `[Source](${href})`;
    await render(`${complete}\n\n[Target](bycoda://session/v1/host/`, { streaming: true });
    const link = host.querySelector("a")!;
    const range = document.createRange();
    range.selectNodeContents(link);
    document.getSelection()!.removeAllRanges();
    document.getSelection()!.addRange(range);
    await render(`${complete}\n\n[Target](${href})`, { streaming: false });
    expect(host.querySelector("a")).toBe(link);
    expect(document.getSelection()?.toString()).toBe("Source");
    expect(host.querySelectorAll("[data-local-session-reference]")).toHaveLength(2);
    expect(navigation.resolve).not.toHaveBeenCalled();
  });

  it("leaves literal code intact and keeps web links on their existing route", async () => {
    await render(`\`${href}\`\n\n[Web](https://example.com/path)`);
    expect(host.querySelectorAll("[data-local-session-reference]")).toHaveLength(0);
    expect(host.querySelector("code")?.textContent).toBe(href);
    await act(async () => host.querySelector<HTMLAnchorElement>("a")!.click());
    expect(openWeb).toHaveBeenCalledWith(undefined, "https://example.com/path");
    expect(navigation.open).not.toHaveBeenCalled();
  });

  it("makes copied plain URIs actionable while retaining invalid targets and code as text", async () => {
    await render(
      `${href}\n\nRead ${href}.\n\n\`${href}\`\n\nbycoda://session/v2/host/environment/stable-session`,
    );
    const links = host.querySelectorAll<HTMLAnchorElement>("[data-local-session-reference] a");
    expect(links).toHaveLength(2);
    expect(links[0].getAttribute("href")).toBe(href);
    expect(links[1].getAttribute("href")).toBe(href);
    expect(host.querySelector("code")?.textContent).toBe(href);
    await act(async () => links[0].click());
    expect(navigation.open).toHaveBeenCalledWith(reference, { beside: false });
  });

  it("retains opaque punctuation in copied identities and trims only prose delimiters", async () => {
    const opaque: LocalSessionReference = {
      locator: {
        kind: "native",
        sourceStoreId: "store",
        sourceProfileId: "profile",
        sessionId: "literal.~",
      },
    };
    const opaqueLink = buildLocalSessionLink(opaque);
    await render(`(${opaqueLink}).\n\n\`\`\`text\n${opaqueLink}\n\`\`\``);
    const links = host.querySelectorAll<HTMLAnchorElement>("[data-local-session-reference] a");
    expect(links).toHaveLength(1);
    expect(links[0].getAttribute("href")).toBe(opaqueLink);
    expect(host.querySelector("pre")?.textContent).toContain(opaqueLink);
    await act(async () => links[0].click());
    expect(navigation.open).toHaveBeenCalledWith(opaque, { beside: false });
  });

  it("loads authorized details only on intent and passes cited turns to open beside", async () => {
    await render(`[Historic title](${href})`);
    expect(navigation.resolve).not.toHaveBeenCalled();
    await act(async () =>
      host.querySelector<HTMLButtonElement>('[aria-label="Session details"]')!.click(),
    );
    const dialog = document.querySelector('[role="dialog"][aria-label="Session details"]')!;
    expect(dialog.textContent).toContain("Current title");
    expect(host.querySelector("a")!.textContent).toBe("Historic title");
    expect(navigation.resolve).toHaveBeenCalledTimes(1);
    await act(async () =>
      [...dialog.querySelectorAll("button")]
        .find((button) => button.textContent === "Open beside")!
        .click(),
    );
    expect(navigation.open).toHaveBeenCalledWith(reference, { beside: true });
  });

  it("reports opening errors at the reference and permits retry", async () => {
    vi.mocked(navigation.open).mockRejectedValueOnce(new Error("Wrong local profile"));
    await render(`[Target](${href})`);
    await act(async () => host.querySelector<HTMLAnchorElement>("a")!.click());
    expect(host.textContent).toContain("Wrong local profile");
    await act(async () =>
      [...host.querySelectorAll("button")]
        .find((button) => button.textContent === "Retry")!
        .click(),
    );
    expect(navigation.open).toHaveBeenCalledTimes(2);
    expect(host.textContent).not.toContain("Wrong local profile");
  });

  it("can recover from a missing cited turn by opening the authorized conversation", async () => {
    vi.mocked(navigation.open).mockRejectedValueOnce(new Error("The cited turn is unavailable"));
    await render(`[Target](${href})`);
    await act(async () => host.querySelector<HTMLAnchorElement>("a")!.click());
    await act(async () =>
      [...host.querySelectorAll("button")]
        .find((button) => button.textContent === "Open conversation")!
        .click(),
    );
    expect(navigation.open).toHaveBeenLastCalledWith(
      { locator: reference.locator },
      { beside: false },
    );
  });

  it("drops resolved metadata immediately when authority changes", async () => {
    await render(`[Target](${href})`);
    await act(async () =>
      host.querySelector<HTMLButtonElement>('[aria-label="Session details"]')!.click(),
    );
    expect(document.body.textContent).toContain("Current title");
    navigation = {
      open: vi.fn(async () => {
        throw new Error("Unavailable");
      }),
      resolve: vi.fn(async () => {
        throw new Error("Unavailable");
      }),
    };
    await render(`[Target](${href})`);
    expect(document.body.textContent).not.toContain("Current title");
  });

  it("deduplicates concurrent details reads by canonical session without retaining completed authorization", async () => {
    let finish!: (metadata: { title: string }) => void;
    vi.mocked(navigation.resolve).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    await render(`[First](${href}) [Second](${href})`);
    const buttons = host.querySelectorAll<HTMLButtonElement>('[aria-label="Session details"]');
    await act(async () => {
      buttons[0].click();
      buttons[1].click();
    });
    expect(navigation.resolve).toHaveBeenCalledTimes(1);
    await act(async () => finish({ title: "Resolved" }));
    // The already-open duplicate shares only the in-flight request. A later
    // intent must reread visibility instead of reusing an old access decision.
    await act(async () => {
      buttons[1].click();
    });
    await act(async () => {
      buttons[1].click();
    });
    expect(navigation.resolve).toHaveBeenCalledTimes(2);
  });

  it("exposes local errors and retry when preview resolution fails", async () => {
    vi.mocked(navigation.resolve).mockRejectedValueOnce(new Error("Session is unavailable"));
    await render(`[Target](${href})`);
    await act(async () =>
      host.querySelector<HTMLButtonElement>('[aria-label="Session details"]')!.click(),
    );
    const dialog = document.querySelector('[role="dialog"][aria-label="Session details"]')!;
    expect(dialog.textContent).toContain("Session is unavailable");
    await act(async () =>
      [...dialog.querySelectorAll("button")]
        .find((button) => button.textContent === "Retry")!
        .click(),
    );
    expect(dialog.textContent).toContain("Current title");
    expect(navigation.resolve).toHaveBeenCalledTimes(2);
  });

  it("uses references inside Notes without entering block editing or changing the draft", async () => {
    const value = `Preserved draft\n\n[Target](${href})`;
    const change = vi.fn(),
      save = vi.fn(),
      editing = vi.fn();
    await act(async () =>
      root.render(
        createElement(LocalSessionReferenceProvider, {
          value: navigation,
          children: createElement(NoteEditablePreview, {
            value,
            viewRef: { current: null },
            rangeRef: { current: null },
            onChange: change,
            onSave: save,
            onPasteImages: vi.fn(),
            onEditingChange: editing,
            onFocus: vi.fn(),
          }),
        }),
      ),
    );
    await act(async () => host.querySelector<HTMLAnchorElement>("a")!.click());
    expect(navigation.open).toHaveBeenCalledWith(reference, { beside: false });
    expect(host.querySelector("textarea")).toBeNull();
    expect(change).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
    expect(editing).not.toHaveBeenCalledWith(true);
  });
});
