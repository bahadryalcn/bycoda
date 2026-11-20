// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { previewFromTool } from "../../../integrations/harness/providers/claude/claudeProtocol";
import { setLanguagePreference } from "../../../shared/i18n";
import { ToolDiffPreview } from "./ToolDiffPreview";
import { AgentTranscript } from "./AgentTranscript";
import type { Block } from "../model/session";

let container: HTMLDivElement;
let root: Root;
const preview = previewFromTool("Edit", {
  file_path: "/Users/me/Documents/notes.md",
  old_string: "  before\nkeep",
  new_string: "  after\nkeep",
})!;

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function renderPreview() {
  const onOpen = vi.fn();
  const onOpenFile = vi.fn();
  act(() =>
    root.render(
      createElement(ToolDiffPreview, {
        preview,
        label: "notes.md",
        status: "accepted",
        onOpen,
        onOpenFile,
        children: "notes.md",
      }),
    ),
  );
  return { trigger: container.querySelector("button")!, onOpen, onOpenFile };
}

function pointer(element: Element, type: "pointerover" | "pointerout", relatedTarget?: Element) {
  act(() =>
    element.dispatchEvent(
      new PointerEvent(type, {
        bubbles: true,
        pointerType: "mouse",
        relatedTarget,
      }),
    ),
  );
}

function advance(ms: number) {
  act(() => vi.advanceTimersByTime(ms));
}

const dialog = () => document.querySelector<HTMLElement>('[role="dialog"]');

describe("tool diff popovers", () => {
  it("opens on click when there is no file navigation callback", () => {
    act(() =>
      root.render(
        createElement(ToolDiffPreview, {
          preview,
          label: "notes.md",
          status: "accepted",
          children: "notes.md",
        }),
      ),
    );
    act(() => container.querySelector<HTMLButtonElement>("button")!.click());
    expect(dialog()?.textContent).toContain("before");
    expect(dialog()?.textContent).toContain("after");
  });

  it("labels Write previews accurately, including empty files and failed tools", () => {
    for (const status of ["accepted", "pending", "rejected"] as const) {
      act(() =>
        root.render(
          createElement(ToolDiffPreview, {
            preview: previewFromTool("Write", {
              file_path: "notes.md",
              content: "",
            })!,
            label: "notes.md",
            status,
            children: "notes.md",
          }),
        ),
      );
      act(() => container.querySelector<HTMLButtonElement>("button")!.click());
      expect(dialog()?.textContent).toContain("Empty file");
      expect(dialog()?.textContent).toContain(
        status === "accepted"
          ? "Written content"
          : status === "pending"
            ? "Proposed changes"
            : "Attempted changes",
      );
      act(() => root.render(null));
    }
  });

  it("waits for hover, stays open across the gap and closes after leaving", () => {
    const { trigger } = renderPreview();
    expect(dialog()).toBeNull();
    pointer(trigger, "pointerover");
    advance(299);
    expect(dialog()).toBeNull();
    advance(1);
    expect(dialog()?.textContent).toContain("before");
    expect(dialog()?.textContent).toContain("after");
    expect(dialog()?.textContent).toContain("+1");
    expect(dialog()?.textContent).toContain("−1");
    pointer(trigger, "pointerout");
    advance(100);
    pointer(dialog()!, "pointerover");
    advance(500);
    expect(dialog()).not.toBeNull();
    pointer(dialog()!, "pointerout");
    advance(200);
    expect(dialog()).toBeNull();
  });

  it("does not flash for a passing pointer and cancels pending work on unmount", () => {
    const { trigger } = renderPreview();
    pointer(trigger, "pointerover");
    advance(100);
    pointer(trigger, "pointerout");
    advance(500);
    expect(dialog()).toBeNull();
    pointer(trigger, "pointerover");
    act(() => root.render(null));
    advance(500);
    expect(dialog()).toBeNull();
  });

  it("preserves the link action, dismisses outside and opens files from the preview", () => {
    const { trigger, onOpen, onOpenFile } = renderPreview();
    pointer(trigger, "pointerover");
    act(() => trigger.click());
    expect(onOpen).toHaveBeenCalledOnce();
    advance(1000);
    expect(dialog()).toBeNull();
    expect(onOpenFile).not.toHaveBeenCalled();
    pointer(trigger, "pointerout");
    pointer(trigger, "pointerover");
    advance(300);
    expect(dialog()).not.toBeNull();
    act(() => document.body.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true })));
    expect(dialog()).toBeNull();
    pointer(trigger, "pointerout");
    pointer(trigger, "pointerover");
    advance(300);
    const fileButton = [...dialog()!.querySelectorAll<HTMLButtonElement>("button")].find((button) =>
      button.textContent?.trim().endsWith("notes.md"),
    )!;
    act(() => fileButton.click());
    expect(onOpenFile).toHaveBeenCalledWith("/Users/me/Documents/notes.md");
    expect(dialog()).toBeNull();
  });

  function key(element: Element, name: string) {
    const event = new KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true });
    act(() => element.dispatchEvent(event));
    return event;
  }

  it("never opens the dialog when the chip merely receives focus", () => {
    const { trigger, onOpen } = renderPreview();
    act(() => trigger.focus());
    expect(document.activeElement).toBe(trigger);
    expect(dialog()).toBeNull();
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(trigger.hasAttribute("aria-controls")).toBe(false);
    advance(1000);
    expect(dialog()).toBeNull();
    act(() => trigger.blur());
    act(() => trigger.focus());
    advance(1000);
    expect(dialog()).toBeNull();
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("keeps focus on the chip while tabbing through a row of chips without opening any", () => {
    const first = renderPreview().trigger;
    const sibling = document.createElement("button");
    container.append(sibling);
    act(() => first.focus());
    act(() => sibling.focus());
    act(() => first.focus());
    advance(1000);
    expect(dialog()).toBeNull();
    // Tab is not intercepted while the dialog is closed, so native focus order is untouched.
    expect(key(first, "Tab").defaultPrevented).toBe(false);
    expect(dialog()).toBeNull();
  });

  it("leaves Enter and Space to native button activation and never opens a dialog for them", () => {
    const { trigger, onOpen } = renderPreview();
    act(() => trigger.focus());
    expect(key(trigger, "Enter").defaultPrevented).toBe(false);
    expect(key(trigger, " ").defaultPrevented).toBe(false);
    expect(dialog()).toBeNull();
    // Native Enter/Space activation arrives as a click and keeps the file action.
    act(() => trigger.click());
    expect(onOpen).toHaveBeenCalledOnce();
    expect(dialog()).toBeNull();
  });

  it("previews on keyboard activation when the chip has no file action", () => {
    act(() =>
      root.render(
        createElement(ToolDiffPreview, {
          preview,
          label: "notes.md",
          status: "accepted",
          children: "notes.md",
        }),
      ),
    );
    const trigger = container.querySelector<HTMLButtonElement>("button")!;
    act(() => trigger.focus());
    expect(dialog()).toBeNull();
    expect(key(trigger, "Enter").defaultPrevented).toBe(false);
    act(() => trigger.click());
    expect(dialog()?.textContent).toContain("after");
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
  });

  it("opens from the keyboard with ArrowDown, then moves into the dialog", () => {
    const { trigger } = renderPreview();
    act(() => trigger.focus());
    expect(dialog()).toBeNull();
    expect(key(trigger, "ArrowDown").defaultPrevented).toBe(true);
    expect(dialog()?.textContent).toContain("after");
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    expect(document.activeElement).toBe(trigger);
    key(trigger, "ArrowDown");
    expect(document.activeElement).toBe(dialog());
  });

  it("keeps a hover-opened dialog while the chip keeps focus, and still closes it on leave", () => {
    const { trigger } = renderPreview();
    pointer(trigger, "pointerover");
    advance(300);
    expect(dialog()).not.toBeNull();
    // Focus arriving on the chip while the pointer preview is open must not close or reopen it.
    act(() => trigger.focus());
    advance(1000);
    expect(dialog()).not.toBeNull();
    act(() => trigger.blur());
    pointer(trigger, "pointerout");
    advance(200);
    expect(dialog()).toBeNull();
  });

  it("opens by hover, supports entering the preview, and restores focus on Escape", () => {
    const { trigger } = renderPreview();
    act(() => trigger.focus());
    expect(dialog()).toBeNull();
    pointer(trigger, "pointerover");
    advance(300);
    expect(dialog()).not.toBeNull();
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    act(() =>
      trigger.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Tab",
          bubbles: true,
          cancelable: true,
        }),
      ),
    );
    expect(dialog()?.contains(document.activeElement)).toBe(true);
    act(() =>
      document.activeElement!.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      ),
    );
    expect(dialog()).toBeNull();
    expect(document.activeElement).toBe(trigger);
    advance(1000);
    expect(dialog()).toBeNull();
  });

  it("restores focus to the chip after the close button without reopening the dialog", () => {
    const { trigger } = renderPreview();
    key(trigger, "ArrowDown");
    key(trigger, "ArrowDown");
    const close = dialog()!.querySelector<HTMLButtonElement>('button[aria-label="Close preview"]')!;
    act(() => close.focus());
    act(() => close.click());
    expect(dialog()).toBeNull();
    expect(document.activeElement).toBe(trigger);
    advance(1000);
    expect(dialog()).toBeNull();
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
  });

  it.each([true, false])(
    "previews expanded activity and preserves file navigation (diff handler: %s)",
    (hasDiffHandler) => {
      const onOpenFile = vi.fn();
      const onOpenDiff = hasDiffHandler ? vi.fn() : undefined;
      const blocks: Block[] = [
        { id: "user", role: "user", text: "Update my notes" },
        {
          id: "edit",
          role: "tool",
          text: "Edit /Users/me/Documents/notes.md",
          tool: { kind: "edit", status: "completed", preview },
        },
        { id: "answer", role: "assistant", text: "Updated your notes." },
      ];
      act(() => root.render(createElement(AgentTranscript, { blocks, onOpenFile, onOpenDiff })));
      expect(container.textContent).not.toContain("before");
      const expand = container.querySelector<HTMLButtonElement>(
        'button[aria-label="Show the work"]',
      )!;
      act(() => expand.click());
      const trigger = container.querySelector<HTMLButtonElement>('button[aria-haspopup="dialog"]')!;
      expect(trigger).not.toBeNull();
      act(() => trigger.focus());
      expect(dialog()).toBeNull();
      pointer(trigger, "pointerover");
      advance(300);
      expect(dialog()?.textContent).toContain("before");
      expect(dialog()?.textContent).toContain("after");
      act(() => trigger.click());
      expect(onOpenDiff ?? onOpenFile).toHaveBeenCalledWith("/Users/me/Documents/notes.md");
      if (onOpenDiff) expect(onOpenFile).not.toHaveBeenCalled();
      expect(dialog()).toBeNull();
    },
  );

  // Clicking opens the popover without relying on focus, so this stays independent of #1002's trigger behavior.
  it.each([
    ["accepted", "Change preview", "Değişiklik önizlemesi"],
    ["pending", "Proposed changes", "Önerilen değişiklikler"],
    [
      "rejected",
      "Attempted changes · tool did not complete",
      "Denenen değişiklikler · araç tamamlanmadı",
    ],
  ] as const)(
    "translates the %s header in the popover title and dialog name (%s)",
    async (status, english, turkish) => {
      await act(async () => {
        await setLanguagePreference("tr");
      });
      try {
        act(() =>
          root.render(
            createElement(ToolDiffPreview, {
              preview,
              label: "notes.md",
              status,
              children: "notes.md",
            }),
          ),
        );
        act(() => container.querySelector<HTMLButtonElement>("button")!.click());
        expect(dialog()?.getAttribute("aria-label")).toBe(`${turkish}: notes.md`);
        expect(dialog()?.textContent).toContain(turkish);
        expect(dialog()?.textContent).not.toContain(english);
      } finally {
        await act(async () => {
          await setLanguagePreference("en");
        });
      }
    },
  );

  it("translates the written-content header for content-only previews", async () => {
    await act(async () => {
      await setLanguagePreference("tr");
    });
    try {
      act(() =>
        root.render(
          createElement(ToolDiffPreview, {
            preview: previewFromTool("Write", { file_path: "notes.md", content: "new" })!,
            label: "notes.md",
            status: "accepted",
            children: "notes.md",
          }),
        ),
      );
      act(() => container.querySelector<HTMLButtonElement>("button")!.click());
      expect(dialog()?.getAttribute("aria-label")).toBe(
        "Yazılan içerik · önceki içerik kullanılamıyor: notes.md",
      );
      expect(dialog()?.textContent).not.toContain("previous contents unavailable");
    } finally {
      await act(async () => {
        await setLanguagePreference("en");
      });
    }
  });
});
