// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import type { Window } from "happy-dom";
import { InlineVisual } from "./InlineVisual";

const { invoke, convertFileSrc } = vi.hoisted(() => ({
  invoke: vi.fn(),
  convertFileSrc: vi.fn(
    (path: string, protocol: string) => `http://${protocol}.localhost/${encodeURIComponent(path)}`,
  ),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke, convertFileSrc }));

// Full view renders in place so the real preview, its toolbar target and its close path stay
// observable; everything else of Modal (constants the Sheet reads) stays real.
vi.mock("../../../shared/ui/Modal", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../shared/ui/Modal")>()),
  Modal: ({
    title,
    toolbar,
    children,
    onClose,
  }: {
    title: string;
    toolbar?: React.ReactNode;
    children: React.ReactNode;
    onClose: () => void;
  }) =>
    createElement(
      "div",
      { role: "dialog", "aria-label": title },
      createElement("div", { "data-modal-toolbar": "" }, toolbar),
      children,
      createElement("button", { "data-modal-close": "", onClick: onClose }, "Close"),
    ),
}));

const SANDBOX = "allow-scripts allow-forms";
const FRAME_PERMISSIONS = "microphone 'none'; camera 'none'; display-capture 'none'";
const SNAPSHOT_PATH = "remote://inline-visual/snapshot.html";
const HOST = "[data-inline-visual-host]";

type Preview = { token: string; path: string; content: string };

/**
 * Mounts one card with a native preview double: every token open right now, every token ever
 * closed, every command sent, and how many were ever open together.
 */
async function mountCard(
  snapshot: { version: 1; title: string; html: string; height: number },
  run: (card: {
    host: HTMLElement;
    root: ReturnType<typeof createRoot>;
    live: Set<string>;
    created: Preview[];
    closed: string[];
    commands: Set<string>;
    peak: () => number;
    frames: () => HTMLIFrameElement[];
    panel: () => HTMLElement | null;
    dialog: () => HTMLElement | null;
    inlineAction: (action: "panel" | "expanded") => HTMLButtonElement | null;
    row: () => HTMLElement | null;
    press: (button: Element | null | undefined) => Promise<void>;
    labelled: (scope: ParentNode | null, label: string) => HTMLButtonElement | null | undefined;
  }) => Promise<void>,
) {
  const settings = (window as unknown as Window).happyDOM.settings;
  settings.navigation.disableChildFrameNavigation = true;
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const live = new Set<string>();
  const created: Preview[] = [];
  const closed: string[] = [];
  const commands = new Set<string>();
  let peak = 0;
  invoke.mockReset().mockImplementation(async (command: string, args?: Record<string, string>) => {
    commands.add(command);
    if (command === "create_html_preview") {
      live.add(args!.token);
      peak = Math.max(peak, live.size);
      created.push({ token: args!.token, path: args!.path, content: args!.content });
      return args!.token;
    }
    if (command === "close_html_preview") {
      live.delete(args!.token);
      closed.push(args!.token);
    }
    return undefined;
  });
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () => root.render(createElement(InlineVisual, { snapshot })));
    await run({
      host,
      root,
      live,
      created,
      closed,
      commands,
      peak: () => peak,
      frames: () => Array.from(document.querySelectorAll("iframe")),
      panel: () => document.querySelector('[role="dialog"][data-sheet-side="end"]'),
      dialog: () => host.querySelector('[role="dialog"]:not([data-sheet-side])'),
      inlineAction: (action) =>
        host.querySelector<HTMLButtonElement>(`button[data-visual-action="${action}"]`),
      // The row left behind in the conversation while a view is open dismisses it too.
      row: () => host.querySelector("[data-inline-visual-row]"),
      press: async (button) => {
        expect(button).toBeTruthy();
        await act(async () => (button as HTMLButtonElement).click());
      },
      labelled: (scope, label) =>
        scope?.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`),
    });
  } finally {
    if (host.childNodes.length) await act(async () => root.unmount());
    host.remove();
    invoke.mockReset();
    settings.navigation.disableChildFrameNavigation = false;
    vi.unstubAllGlobals();
  }
}

const escape = () =>
  act(async () =>
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })),
  );

it("keeps one live sandboxed frame and token across inline, panel, full view, navigation and dismissal", async () => {
  const snapshot = {
    version: 1 as const,
    title: "Counter",
    html: "<button>Count</button>",
    height: 360,
  };
  await mountCard(snapshot, async (card) => {
    const { host, live, created, closed, frames, panel, dialog, inlineAction, row, press } = card;
    const { labelled } = card;
    expect(created).toHaveLength(1);
    const token = created[0].token;
    const frame = frames()[0];
    const section = host.querySelector("section")!;
    // The card keeps one slot of the snapshot's height in every view, so a panel or dialog never
    // shifts the transcript around it.
    const slot = section.firstElementChild as HTMLElement;
    expect(slot.getAttribute("style")).toContain("360px");

    // One transition changes where the same frame sits: no preview is created or closed, the
    // card and its slot are the same elements, and the host holds the frame in the owner.
    const settled = (where: "inline" | "panel" | "dialog") => {
      expect(created).toHaveLength(1);
      expect(closed).toEqual([]);
      expect(Array.from(live)).toEqual([token]);
      expect(card.peak()).toBe(1);
      expect(frames()).toHaveLength(1);
      expect(frames()[0]).toBe(frame);
      const owner = where === "inline" ? slot : where === "panel" ? panel() : dialog();
      expect(owner!.querySelector(HOST)).toBe(frame.closest(HOST));
      expect(owner!.querySelector("iframe")).toBe(frame);
      expect(host.querySelector("section")).toBe(section);
      expect(section.firstElementChild).toBe(slot);
      expect(slot.getAttribute("style")).toContain("360px");
      // The row stands in for the frame exactly while another view shows it.
      if (where === "inline") expect(row()).toBeNull();
      else expect(row()!.textContent).toContain(snapshot.title);
    };
    settled("inline");

    // Inline -> panel: the frame moves into the panel and is not left beside it.
    await press(inlineAction("panel"));
    settled("panel");
    expect(panel()!.getAttribute("aria-modal")).not.toBe("true");

    // Escape is a dismissal; focus goes back to the control that opened the panel.
    await escape();
    expect(panel()).toBeNull();
    settled("inline");
    expect(document.activeElement).toBe(inlineAction("panel"));

    // The panel's own Close and the row's Close both bring the frame back inline.
    await press(inlineAction("panel"));
    settled("panel");
    await press(labelled(panel(), "Close"));
    expect(panel()).toBeNull();
    settled("inline");
    await press(inlineAction("panel"));
    settled("panel");
    await press(labelled(row(), "Close"));
    expect(panel()).toBeNull();
    settled("inline");

    // Inline -> full view: the toolbar moves into the dialog's own toolbar around the same
    // frame, and Close returns focus to Expand.
    await press(inlineAction("expanded"));
    settled("dialog");
    expect(
      labelled(dialog()!.querySelector("[data-modal-toolbar]"), "Reload preview"),
    ).toBeTruthy();
    expect(labelled(dialog(), "Close")).toBeNull();
    await press(dialog()!.querySelector("[data-modal-close]"));
    expect(dialog()).toBeNull();
    settled("inline");
    expect(document.activeElement).toBe(inlineAction("expanded"));

    // Full view <-> panel navigation moves the one frame between the two views.
    await press(inlineAction("expanded"));
    settled("dialog");
    await press(labelled(dialog(), "Open in panel"));
    expect(dialog()).toBeNull();
    settled("panel");
    await press(labelled(panel(), "Expand"));
    expect(panel()).toBeNull();
    settled("dialog");
    await press(labelled(row(), "Close"));
    expect(dialog()).toBeNull();
    settled("inline");

    // Source disclosure in a view keeps the mounted frame as well.
    await press(inlineAction("panel"));
    await press(labelled(panel(), "Source"));
    settled("panel");
    await press(labelled(panel(), "Source"));
    await escape();
    settled("inline");

    // The one preview kept the same sandbox, content and authority the whole time.
    expect(created[0].path).toBe(SNAPSHOT_PATH);
    expect(created[0].content).toContain(snapshot.html);
    expect(created[0].content).toContain("connect-src 'none'");
    expect(frame.getAttribute("sandbox")).toBe(SANDBOX);
    expect(frame.getAttribute("allow")).toBe(FRAME_PERMISSIONS);
    expect(frame.getAttribute("referrerpolicy")).toBe("no-referrer");
    expect(card.commands).toEqual(new Set(["create_html_preview"]));

    // Unmounting the card closes the one token, once.
    await act(async () => card.root.unmount());
    expect(live.size).toBe(0);
    expect(closed).toEqual([token]);
    expect(frames()).toHaveLength(0);
    expect(card.commands).toEqual(new Set(["create_html_preview", "close_html_preview"]));
  });
});

it("keeps the sandbox attributes of the frame in every view", async () => {
  const snapshot = { version: 1 as const, title: "Chart", html: "<p>Data</p>", height: 200 };
  await mountCard(snapshot, async ({ frames, inlineAction, press, dialog }) => {
    const seen: { sandbox: string | null; allow: string | null }[] = [];
    const record = () => {
      for (const frame of frames())
        seen.push({ sandbox: frame.getAttribute("sandbox"), allow: frame.getAttribute("allow") });
    };
    record();
    for (const action of ["panel", "expanded"] as const) {
      await press(inlineAction(action));
      record();
      await escape();
      if (action === "expanded") await press(dialog()!.querySelector("[data-modal-close]"));
    }
    expect(seen).toHaveLength(3);
    for (const frame of seen) {
      expect(frame.sandbox).toBe(SANDBOX);
      expect(frame.sandbox).not.toContain("allow-same-origin");
      expect(frame.sandbox).not.toContain("allow-top-navigation");
      expect(frame.allow).toBe(FRAME_PERMISSIONS);
    }
  });
});

it.each([
  ["supports", false],
  ["refuses", true],
])(
  "moves the frame host with the state-keeping move when the platform %s it",
  async (_name, refuse) => {
    const moves: Element[] = [];
    Object.defineProperty(HTMLElement.prototype, "moveBefore", {
      configurable: true,
      writable: true,
      value(this: HTMLElement, node: Node, child: Node | null) {
        moves.push(node as Element);
        if (refuse) throw new DOMException("refused", "HierarchyRequestError");
        this.insertBefore(node, child);
      },
    });
    const snapshot = { version: 1 as const, title: "Counter", html: "<p>Count</p>", height: 240 };
    try {
      await mountCard(snapshot, async (card) => {
        const frame = card.frames()[0];
        await card.press(card.inlineAction("panel"));
        expect(card.panel()!.querySelector("iframe")).toBe(frame);
        await card.press(card.labelled(card.panel(), "Expand"));
        expect(card.dialog()!.querySelector("iframe")).toBe(frame);
        await card.press(card.labelled(card.row(), "Close"));
        expect(card.host.querySelector("iframe")).toBe(frame);
        // Supported or refused, the move never gives up the one frame, token or preview.
        expect(moves.length).toBeGreaterThan(0);
        for (const node of moves) expect(node.matches(HOST)).toBe(true);
        expect(card.frames()).toHaveLength(1);
        expect(card.created).toHaveLength(1);
        expect(card.closed).toEqual([]);
        expect(card.live.size).toBe(1);
      });
    } finally {
      Reflect.deleteProperty(HTMLElement.prototype, "moveBefore");
    }
  },
);
