// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mcpInvoke = vi.hoisted(() => vi.fn());
vi.mock("../../workspaces/model/workspaceCreation", () => ({
  shortWorkspaceRef: (ref: string) => ref.replace(/^refs\/(heads|remotes)\//, ""),
  useWorkspaceCreation: (
    _cwd: string,
    _active: boolean,
    choice?: "current" | "worktree",
    base?: string,
  ) => ({
    mode: choice ?? "worktree",
    base: base || "main",
    preview: { baseRef: "refs/heads/main", baseCommit: "12345678", excludedPaths: 2 },
    pending: false,
    refresh: vi.fn(),
  }),
}));
vi.mock("../model/textareaSelectionRect", () => ({
  textareaSelectionRect: () => new DOMRect(20, 100, 120, 20),
}));
vi.mock("@tauri-apps/api/core", async (importOriginal) => {
  const original = await importOriginal<typeof import("@tauri-apps/api/core")>();
  return {
    ...original,
    invoke: (command: string, args?: unknown) =>
      command === "mcp_discover" || command === "claude_mcp_list"
        ? mcpInvoke(command, args)
        : original.invoke(command, args),
  };
});

vi.mock("@tauri-apps/api/webview", () => ({
  getCurrentWebview: () => ({ onDragDropEvent: async () => () => {} }),
}));
vi.mock("../../source-control/hooks/useProjectBranches", () => ({
  useProjectBranchesState: () => ({
    branches: {
      current: "mc/greeting",
      detached: false,
      branches: [
        { name: "mc/greeting", remote: null, current: true },
        { name: "main", remote: null, current: false },
      ],
    },
    settled: true,
  }),
}));

import { Composer, ComposerAction } from "./Composer";
import { setRemoteCommandRunner } from "../../../platform/tauri/fs";
import { invalidateSkills } from "../../skills/model/skills";
import { invalidateProjectFiles } from "../../files/model/fileIndex";
import { reportSessionCommands } from "../../../integrations/harness/core/reportedCommands";
import { clearMcpSettingsCache, loadMcpSettings } from "../../settings/model/mcpSettingsCache";
import type { ComposerTurnOptions, Attachment } from "../model/session";
import { clearComposerDraft, getComposerDraft, setComposerDraft } from "../model/draftCache";
import type { NewSessionOptions } from "../model/newSessionCommand";
import type { UserQuestionPrompt } from "../model/userQuestion";
import { registerHarness } from "../../../integrations/harness/core/registry";
import { codexAdapter } from "../../../integrations/harness/providers/codex/codexAdapter";
import { antigravityAdapter } from "../../../integrations/harness/providers/antigravity/antigravityAdapter";
import { saveLastModelChoice } from "../model/models";
import {
  saveDefaultTranslationChoice,
  saveDefaultRepromptChoice,
} from "../model/translationPreferences";

function renderAction(busy: boolean, hasValue: boolean, allowBusySubmit = true) {
  return renderToStaticMarkup(
    createElement(ComposerAction, {
      busy,
      hasValue,
      allowBusySubmit,
      onSend: vi.fn(),
      onStop: vi.fn(),
    }),
  );
}

describe("ComposerAction", () => {
  it("keeps Stop alongside Send when typing during a running turn", () => {
    const empty = renderAction(true, false);
    expect(empty).toContain('aria-label="Stop"');
    expect(empty).not.toContain('aria-label="Send"');

    const typed = renderAction(true, true);
    expect(typed).toContain('aria-label="Send"');
    expect(typed).toContain('data-button-variant="primary"');
    expect(typed).toContain('aria-label="Stop"');
    expect(typed).toContain('title="Send (Enter)"');
    expect(typed).toContain('title="Stop (Esc)"');
  });

  it("keeps Stop while busy when submitting follow-up text is disabled", () => {
    const typed = renderAction(true, true, false);
    expect(typed).toContain('aria-label="Stop"');
    expect(typed).not.toContain('aria-label="Send"');
  });
});

describe("Composer question focus", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    clearMcpSettingsCache();
    mcpInvoke.mockReset();
    mcpInvoke.mockImplementation(async (command: string) =>
      command === "mcp_discover"
        ? [
            {
              provider: "claude",
              name: "docs",
              scope: "project",
              configPath: "/repo/.mcp.json",
              transport: "stdio",
            },
            {
              provider: "cursor",
              name: "other",
              scope: "user",
              configPath: "/cursor/mcp.json",
              transport: "stdio",
            },
          ]
        : command === "claude_mcp_list"
          ? "docs: local - ✔ Connected"
          : undefined,
    );
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    saveDefaultTranslationChoice(undefined);
    saveDefaultRepromptChoice(undefined);
    container.remove();
    vi.unstubAllGlobals();
    registerHarness(codexAdapter);
  });

  it.each([
    ["Translate to English", "Apply translation"],
    ["Reprompt", "Apply prompt"],
  ])(
    "previews %s for a selected draft, applies only on approval, and toggles with arrows",
    async (action, applyLabel) => {
      saveLastModelChoice("codex", "codex:gpt-6.1");
      const run = vi.fn(async () => "Hello");
      registerHarness({ ...codexAdapter, runTextPrompt: run });
      const original = "Before Merhaba after";
      await renderComposer(
        undefined,
        vi.fn(),
        false,
        0,
        original,
        undefined,
        vi.fn(),
        "translate-draft",
        "codex",
      );
      const textarea = container.querySelector("textarea")!;
      textarea.focus();
      vi.spyOn(textarea, "getBoundingClientRect").mockReturnValue(new DOMRect(20, 100, 300, 40));
      await act(async () => {
        textarea.setSelectionRange(7, 14);
        textarea.dispatchEvent(new Event("select", { bubbles: true }));
        await new Promise((resolve) => requestAnimationFrame(resolve));
      });
      const translate = [
        ...document.querySelectorAll<HTMLButtonElement>('[role="toolbar"] button'),
      ].find((button) => button.textContent?.includes(action))!;
      expect(translate).toBeDefined();
      expect(run).not.toHaveBeenCalled();
      await act(async () => translate.click());
      expect(document.querySelector('[role="dialog"]')).not.toBeNull();
      expect(textarea.value).toBe(original);
      const apply = [
        ...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button'),
      ].find((button) => button.textContent === applyLabel)!;
      await act(async () => apply.click());
      expect(textarea.value).toBe("Before Hello after");
      for (const [key, expected] of [
        ["ArrowUp", original],
        ["ArrowDown", "Before Hello after"],
      ]) {
        await act(async () =>
          textarea.dispatchEvent(
            new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }),
          ),
        );
        expect(textarea.value).toBe(expected);
      }
      expect(run).toHaveBeenCalledOnce();
    },
  );
  it("opens the translation menu for an Antigravity model without silently calling Codex", async () => {
    saveDefaultTranslationChoice({
      harness: "antigravity",
      model: "antigravity:gemini-3.8-flash-high",
    });
    const run = vi.fn(async () => "Hello");
    registerHarness({ ...codexAdapter, runTextPrompt: run });
    const antigravityRun = vi.fn(async () => "Hello");
    registerHarness({ ...antigravityAdapter, runTextPrompt: antigravityRun });
    await renderComposer(
      undefined,
      vi.fn(),
      false,
      0,
      "selam bugün nasılsın?",
      undefined,
      vi.fn(),
      "antigravity-selection",
      "antigravity",
    );
    const textarea = container.querySelector("textarea")!;
    textarea.focus();
    await act(async () => {
      textarea.setSelectionRange(0, textarea.value.length);
      textarea.dispatchEvent(new Event("select", { bubbles: true }));
      await new Promise((resolve) => requestAnimationFrame(resolve));
    });
    const action = await vi.waitFor(async () => {
      await act(async () => {
        await new Promise((resolve) => requestAnimationFrame(resolve));
      });
      const button = [
        ...document.querySelectorAll<HTMLButtonElement>('[role="toolbar"] button'),
      ].find((candidate) => candidate.textContent?.includes("Translate to English"));
      expect(button).toBeDefined();
      return button!;
    });
    await act(async () => action.click());
    expect(document.querySelector('[role="dialog"]')?.textContent).not.toContain(
      "Choose a translation model",
    );
    expect(antigravityRun).toHaveBeenCalledOnce();
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain("Hello");
    expect(run).not.toHaveBeenCalled();
    expect(textarea.value).toBe("selam bugün nasılsın?");
  });

  it.each([
    ["Translate to English", "Apply translation"],
    ["Reprompt", "Apply prompt"],
  ])("keeps an edited draft when %s finishes late", async (action, applyLabel) => {
    saveLastModelChoice("codex", "codex:gpt-6.1");
    let resolve!: (value: string) => void;
    registerHarness({
      ...codexAdapter,
      runTextPrompt: () =>
        new Promise<string>((done) => {
          resolve = done;
        }),
    });
    await renderComposer(
      undefined,
      vi.fn(),
      false,
      0,
      "Merhaba",
      undefined,
      vi.fn(),
      "late-translation",
      "codex",
    );
    const textarea = container.querySelector("textarea")!;
    textarea.focus();
    vi.spyOn(textarea, "getBoundingClientRect").mockReturnValue(new DOMRect(20, 100, 300, 40));
    await act(async () => {
      textarea.setSelectionRange(0, 7);
      textarea.dispatchEvent(new Event("select", { bubbles: true }));
      await new Promise((resolve) => requestAnimationFrame(resolve));
    });
    const translate = [
      ...document.querySelectorAll<HTMLButtonElement>('[role="toolbar"] button'),
    ].find((button) => button.textContent?.includes(action))!;
    await act(async () => translate.click());
    await act(async () => {
      textarea.value = "Changed draft";
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
      resolve("Hello");
    });
    const apply = [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')].find(
      (button) => button.textContent === applyLabel,
    )!;
    await act(async () => vi.waitFor(() => expect(apply.disabled).toBe(false)));
    await act(async () => apply.click());
    expect(textarea.value).toBe("Changed draft");
    expect(document.querySelector('[role="alert"]')?.textContent).toContain("The text changed");
  });

  const question: UserQuestionPrompt = {
    requestId: 1,
    questions: [
      {
        id: "q1",
        prompt: "Pick one",
        multiSelect: false,
        allowCustom: false,
        options: [{ id: "a", label: "Option A" }],
      },
    ],
  };

  async function renderComposer(
    currentQuestion: UserQuestionPrompt | undefined,
    onQuestionReply: (requestId: number, reply: unknown) => void,
    busy = false,
    focusToken = 0,
    initialDraft?: string,
    onBtwCommand?: (text: string, options?: { draft?: boolean }) => boolean | void,
    onSubmit: (text: string, attachments: Attachment[]) => void = () => {},
    sessionId?: string,
    harness: "claude" | "codex" | "antigravity" = "claude",
    cwd?: string,
    remoteSession = false,
    onNewSession?: (options?: NewSessionOptions) => void,
  ) {
    await act(async () =>
      root.render(
        createElement(Composer, {
          key: sessionId,
          focused: true,
          focusToken,
          harness,
          model: "claude-sonnet",
          runtimeMode: "supervised",
          executionCwd: remoteSession ? cwd! : "/repo",
          remoteSession,
          cwd,
          initialDraft,
          sessionId,
          onDraftChange: sessionId ? (text) => setComposerDraft(sessionId, text) : undefined,
          hideProjectPicker: true,
          hideBranchPicker: true,
          onFocus: () => {},
          onCwdChange: () => {},
          onModelChange: () => {},
          onRuntimeModeChange: () => {},
          onSubmit,
          onBtwCommand,
          onNewSession,
          question: currentQuestion,
          onQuestionReply,
          busy,
        }),
      ),
    );
  }

  it("shows the working folder picker without additional projects", async () => {
    localStorage.clear();
    await renderComposer(
      undefined,
      vi.fn(),
      false,
      0,
      undefined,
      undefined,
      vi.fn(),
      "folder-default",
      "codex",
      "/repo",
    );
    const trigger = document.querySelector<HTMLButtonElement>(
      '[aria-label="Folders for this session"]',
    );
    expect(trigger?.textContent).toBe("repo");
    await act(async () => trigger!.click());
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain("Working folder");
    expect(document.querySelector('[role="dialog"]')?.textContent).not.toContain("Change project…");
  });

  it.each([
    ["/btw", ""],
    ["/btw some text here...", "some text here..."],
  ])("routes %s to BTW instead of the main submit", async (draft, text) => {
    const onBtwCommand = vi.fn(() => true);
    const onSubmit = vi.fn();
    await renderComposer(undefined, vi.fn(), false, 0, draft, onBtwCommand, onSubmit);
    const textarea = document.querySelector("textarea")!;
    await act(async () =>
      textarea.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Enter",
          bubbles: true,
          cancelable: true,
        }),
      ),
    );
    expect(onBtwCommand).toHaveBeenCalledWith(text);
    expect(onSubmit).not.toHaveBeenCalled();
    expect(textarea.value).toBe("");
  });

  it.each([false, true])("opens a new session without sending a turn (busy=%s)", async (busy) => {
    const onNewSession = vi.fn();
    const onSubmit = vi.fn();
    await renderComposer(
      undefined,
      vi.fn(),
      busy,
      0,
      " /NEW ",
      undefined,
      onSubmit,
      "new-command",
      "codex",
      "/repo",
      false,
      onNewSession,
    );
    const textarea = document.querySelector("textarea")!;
    await act(async () =>
      textarea.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }),
      ),
    );
    expect(onNewSession).toHaveBeenCalledOnce();
    expect(onSubmit).not.toHaveBeenCalled();
    expect(textarea.value).toBe("");
    expect(getComposerDraft("new-command")?.text ?? "").toBe("");
  });

  it("offers /new in the command picker for remote sessions", async () => {
    await renderComposer(
      undefined,
      vi.fn(),
      false,
      0,
      undefined,
      undefined,
      vi.fn(),
      "remote-new-command",
      "claude",
      "remote://host/repo",
      true,
      vi.fn(),
    );
    const textarea = document.querySelector("textarea")!;
    await typeInto(textarea, "/ne");
    expect(document.body.textContent).toContain("/new");
  });

  it.each([false, true])(
    "clears the current conversation without opening a tab (busy=%s)",
    async (busy) => {
      const onNewSession = vi.fn();
      const onSubmit = vi.fn();
      await renderComposer(
        undefined,
        vi.fn(),
        busy,
        0,
        undefined,
        undefined,
        onSubmit,
        "clear-command",
        "claude",
        "/repo",
        false,
        onNewSession,
      );
      const textarea = document.querySelector("textarea")!;
      // Keep the picker open: Enter on the full command must execute, not select it again.
      await typeInto(textarea, "/clear");
      expect(document.body.textContent).toContain("/clear");
      await act(async () =>
        textarea.dispatchEvent(
          new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }),
        ),
      );
      expect(onNewSession).not.toHaveBeenCalled();
      if (busy) {
        expect(onSubmit).not.toHaveBeenCalled();
        expect(textarea.value).toBe("/clear");
      } else {
        expect(onSubmit).toHaveBeenCalledExactlyOnceWith("/clear", [], { intent: "default" });
        expect(textarea.value).toBe("");
        expect(getComposerDraft("clear-command")?.text ?? "").toBe("");
      }
    },
  );

  it("keeps /clear when the session rejects clearing", async () => {
    const onSubmit = vi.fn(() => false);
    await renderComposer(undefined, vi.fn(), false, 0, "/clear", undefined, onSubmit);
    const textarea = document.querySelector("textarea")!;
    await act(async () =>
      textarea.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }),
      ),
    );
    expect(onSubmit).toHaveBeenCalledWith("/clear", [], { intent: "default" });
    expect(textarea.value).toBe("/clear");
    expect(document.body.textContent).toContain("Stop the current turn");
  });

  async function typeInto(textarea: HTMLTextAreaElement, value: string) {
    await act(async () => {
      textarea.value = value;
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }

  it("opens BTW as soon as `/btw ` is typed and hands over the rest", async () => {
    const onBtwCommand = vi.fn(() => true);
    await renderComposer(undefined, vi.fn(), false, 0, undefined, onBtwCommand);
    const textarea = document.querySelector("textarea")!;
    await typeInto(textarea, "/btw");
    expect(onBtwCommand).not.toHaveBeenCalled();

    await typeInto(textarea, "/btw why");
    expect(onBtwCommand).toHaveBeenCalledWith("why", { draft: true });
    expect(textarea.value).toBe("");
  });

  it("recalls earlier messages with Up and Down in an empty composer", async () => {
    const onRecallLastTurn = vi.fn();
    const lastTurnRecall = { text: "second", attachments: [] as Attachment[] };
    await act(async () =>
      root.render(
        createElement(Composer, {
          focused: true,
          harness: "claude",
          model: "claude-sonnet",
          runtimeMode: "supervised",
          executionCwd: "/repo",
          hideProjectPicker: true,
          hideBranchPicker: true,
          promptHistory: () => ["second", "first"],
          editLastTurnSupported: true,
          lastTurnRecall,
          onRecallLastTurn,
          onFocus: () => {},
          onCwdChange: () => {},
          onModelChange: () => {},
          onRuntimeModeChange: () => {},
          onSubmit: () => {},
        }),
      ),
    );
    const textarea = document.querySelector("textarea")!;
    const press = async (key: string) => {
      const event = new KeyboardEvent("keydown", {
        key,
        bubbles: true,
        cancelable: true,
      });
      await act(async () => textarea.dispatchEvent(event));
      return event;
    };

    expect((await press("ArrowUp")).defaultPrevented).toBe(true);
    expect(textarea.value).toBe("second");
    expect(textarea.selectionStart).toBe(6);
    await press("ArrowUp");
    expect(textarea.value).toBe("first");
    await press("ArrowDown");
    expect(textarea.value).toBe("second");
    await press("ArrowDown");
    expect(textarea.value).toBe("");
    expect(onRecallLastTurn).not.toHaveBeenCalled();

    await press("Escape");
    expect(onRecallLastTurn).not.toHaveBeenCalled();
    await press("Escape");
    expect(onRecallLastTurn).toHaveBeenCalledExactlyOnceWith(lastTurnRecall);

    await press("ArrowUp");
    await typeInto(textarea, "second!");
    expect((await press("ArrowUp")).defaultPrevented).toBe(false);
    expect(textarea.value).toBe("second!");
  });

  it("leaves a typed `/btw ` alone when BTW is unavailable", async () => {
    const onBtwCommand = vi.fn(() => false);
    await renderComposer(undefined, vi.fn(), false, 0, undefined, onBtwCommand);
    const textarea = document.querySelector("textarea")!;
    await typeInto(textarea, "/btw ");
    expect(textarea.value).toBe("/btw ");
  });

  it("opens a searchable MCP picker and sends selected context", async () => {
    const onSubmit = vi.fn();
    const onOpen = vi.fn();
    window.addEventListener("bycoda:open-mcp-settings", onOpen);
    try {
      await renderComposer(undefined, vi.fn(), false, 0, "/mcp", undefined, onSubmit);
      const textarea = document.querySelector("textarea")!;
      await act(async () =>
        textarea.dispatchEvent(
          new KeyboardEvent("keydown", {
            key: "Enter",
            bubbles: true,
            cancelable: true,
          }),
        ),
      );
      expect(document.querySelector("[data-mcp-picker]")).not.toBeNull();
      expect(document.body.textContent).toContain("docs");
      expect(document.body.textContent).toContain("other");
      const unavailable = [
        ...document.querySelectorAll<HTMLButtonElement>('[data-mcp-picker] [role="option"]'),
      ].find((button) => button.textContent?.includes("other"))!;
      expect(unavailable.disabled).toBe(true);
      const search = document.querySelector<HTMLInputElement>('[aria-label="Search MCP servers"]')!;
      await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(
          search,
          "docs",
        );
        search.dispatchEvent(new Event("input", { bubbles: true }));
      });
      expect(document.querySelector("[data-mcp-picker]")?.textContent).not.toContain("other");
      const available = [
        ...document.querySelectorAll<HTMLButtonElement>('[data-mcp-picker] [role="option"]'),
      ].find((button) => button.textContent?.includes("docs"))!;
      await act(async () => available.click());
      expect(textarea.value).toBe("@mcp/docs ");
      expect(document.querySelector('[data-mcp-tag="@mcp/docs"]')).not.toBeNull();
      expect(document.querySelector('[aria-label="Selected MCP context"]')).toBeNull();
      await typeInto(textarea, `${textarea.value}Find the docs`);
      await act(async () =>
        textarea.dispatchEvent(
          new KeyboardEvent("keydown", {
            key: "Enter",
            bubbles: true,
            cancelable: true,
          }),
        ),
      );
      expect(onSubmit).toHaveBeenCalledWith(
        expect.stringContaining('"docs" (claude)'),
        expect.any(Array),
        expect.any(Object),
      );
      expect(document.querySelector('[data-mcp-tag="@mcp/docs"]')).toBeNull();
      expect(onOpen).not.toHaveBeenCalled();
      expect(textarea.value).toBe("");
    } finally {
      window.removeEventListener("bycoda:open-mcp-settings", onOpen);
    }
  });

  it("reuses MCP discovery on reopen and applies shared settings refreshes", async () => {
    await renderComposer(undefined, vi.fn(), false, 0, "/mcp");
    const textarea = document.querySelector("textarea")!;
    const enter = () =>
      textarea.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Enter",
          bubbles: true,
          cancelable: true,
        }),
      );
    await act(async () => enter());
    expect(mcpInvoke).toHaveBeenCalledTimes(2);
    await act(async () =>
      document
        .querySelector('[aria-label="Search MCP servers"]')!
        .dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })),
    );
    await typeInto(textarea, "/mcp");
    await act(async () => enter());
    expect(document.querySelector("[data-mcp-picker]")).not.toBeNull();
    expect(mcpInvoke).toHaveBeenCalledTimes(2);

    mcpInvoke.mockImplementation(async (command: string) =>
      command === "mcp_discover"
        ? [
            {
              provider: "claude",
              name: "docs",
              scope: "project",
              configPath: "/repo/.mcp.json",
              transport: "stdio",
              enabled: false,
            },
          ]
        : "docs: local - Connected",
    );
    await act(async () => {
      await loadMcpSettings("/repo", true);
    });
    const docs = document.querySelector<HTMLButtonElement>('[data-mcp-picker] [role="option"]')!;
    expect(docs.disabled).toBe(true);
    expect(docs.textContent).toContain("Disabled in provider configuration");
    expect(mcpInvoke).toHaveBeenCalledTimes(4);
  });

  it("shows four MCP rows at a time and dismisses on outside click or Escape", async () => {
    mcpInvoke.mockImplementation(async (command: string) =>
      command === "mcp_discover"
        ? Array.from({ length: 6 }, (_, index) => ({
            provider: "claude",
            name: `server-${index}`,
            scope: "project",
            configPath: "/repo/.mcp.json",
            transport: "stdio",
          }))
        : "",
    );
    await renderComposer(undefined, vi.fn(), false, 0, "/mcp");
    const textarea = document.querySelector("textarea")!;
    const openPicker = async () => {
      await act(async () =>
        textarea.dispatchEvent(
          new KeyboardEvent("keydown", {
            key: "Enter",
            bubbles: true,
            cancelable: true,
          }),
        ),
      );
    };
    await openPicker();

    const list = document.querySelector<HTMLElement>('[data-mcp-picker] [role="listbox"]')!;
    expect(list.querySelectorAll('[role="option"]')).toHaveLength(6);
    expect(list.classList.contains("max-h-[min(184px,45vh)]")).toBe(true);
    expect(list.querySelector('[role="option"]')?.className).toContain("bycoda-arc");
    expect(document.querySelector("[data-mcp-picker]")?.className).toContain("--ui-surface-raised");
    const searchInput = document.querySelector<HTMLInputElement>(
      '[aria-label="Search MCP servers"]',
    )!;
    const options = list.querySelectorAll<HTMLButtonElement>('[role="option"]');
    expect(searchInput.getAttribute("aria-controls")).toBe(list.id);
    await act(async () => options[1].focus());
    expect(options[1].getAttribute("aria-selected")).toBe("true");
    expect(searchInput.getAttribute("aria-activedescendant")).toBe(options[1].id);
    await act(async () => {
      searchInput.focus();
      for (const key of ["ArrowDown", "Enter", "Escape"]) {
        searchInput.dispatchEvent(
          new KeyboardEvent("keydown", {
            key,
            bubbles: true,
            isComposing: true,
          }),
        );
      }
    });
    expect(document.querySelector("[data-mcp-picker]")).not.toBeNull();
    expect(document.body.textContent).not.toContain("MCP: server-");

    const outside = document.createElement("button");
    document.body.append(outside);
    await act(async () => {
      outside.focus();
      outside.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    });
    expect(document.querySelector("[data-mcp-picker]")).toBeNull();
    expect(document.activeElement).toBe(outside);
    outside.remove();

    await typeInto(textarea, "/mcp");
    await openPicker();
    const search = document.querySelector<HTMLInputElement>('[aria-label="Search MCP servers"]')!;
    await act(async () =>
      search.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })),
    );
    expect(document.querySelector("[data-mcp-picker]")).toBeNull();
    expect(document.activeElement).toBe(textarea);

    await typeInto(textarea, "/mcp");
    await openPicker();
    const close = document.querySelector<HTMLButtonElement>('[aria-label="Close MCP picker"]')!;
    expect(close.title).toContain("Esc");
    await act(async () => close.click());
    expect(document.querySelector("[data-mcp-picker]")).toBeNull();
  });

  it("removes MCP context when its inline tag is deleted", async () => {
    const onSubmit = vi.fn();
    await renderComposer(undefined, vi.fn(), false, 0, "/mcp", undefined, onSubmit);
    const textarea = document.querySelector("textarea")!;
    await act(async () =>
      textarea.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Enter",
          bubbles: true,
          cancelable: true,
        }),
      ),
    );
    const docs = [
      ...document.querySelectorAll<HTMLButtonElement>('[data-mcp-picker] [role="option"]'),
    ].find((button) => button.textContent?.includes("docs"))!;
    await act(async () => docs.click());
    expect(textarea.value).toContain("@mcp/docs");
    await typeInto(textarea, "Find the docs");
    expect(document.querySelector("[data-mcp-tag]")).toBeNull();
    await act(async () =>
      textarea.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Enter",
          bubbles: true,
          cancelable: true,
        }),
      ),
    );
    expect(onSubmit).toHaveBeenCalledWith("Find the docs", expect.any(Array), expect.any(Object));
  });

  it("inserts an MCP tag beside existing composer text", async () => {
    await renderComposer(undefined, vi.fn());
    const textarea = document.querySelector("textarea")!;
    await typeInto(textarea, "sad /mcp");
    const command = [
      ...document.querySelectorAll<HTMLButtonElement>('[data-skill-picker] [role="option"]'),
    ].find((button) => button.textContent?.includes("/mcp"))!;
    expect(command).toBeDefined();
    await act(async () => command.click());
    const docs = [
      ...document.querySelectorAll<HTMLButtonElement>('[data-mcp-picker] [role="option"]'),
    ].find((button) => button.textContent?.includes("docs"))!;
    await act(async () => docs.click());
    expect(textarea.value).toBe("sad @mcp/docs ");
    expect(document.querySelector('[data-mcp-tag="@mcp/docs"]')).not.toBeNull();
  });

  it("restores a Codex MCP tag and its context after switching sessions", async () => {
    mcpInvoke.mockImplementation(async (command: string) =>
      command === "mcp_discover"
        ? [
            {
              provider: "codex",
              name: "docs",
              scope: "user",
              configPath: "/codex/config.toml",
              transport: "stdio",
            },
          ]
        : "",
    );
    const onSubmit = vi.fn();
    try {
      await renderComposer(
        undefined,
        vi.fn(),
        false,
        0,
        "/mcp",
        undefined,
        onSubmit,
        "mcp-session-one",
        "codex",
      );
      let textarea = document.querySelector("textarea")!;
      await act(async () =>
        textarea.dispatchEvent(
          new KeyboardEvent("keydown", {
            key: "Enter",
            bubbles: true,
            cancelable: true,
          }),
        ),
      );
      const docs = document.querySelector<HTMLButtonElement>('[data-mcp-picker] [role="option"]')!;
      expect(mcpInvoke).not.toHaveBeenCalledWith("claude_mcp_list", expect.anything());
      await act(async () => docs.click());
      expect(textarea.value).toContain("@mcp/docs");
      expect(document.querySelector("[data-mcp-tag] svg")).toBeNull();

      await renderComposer(
        undefined,
        vi.fn(),
        false,
        0,
        "Other draft",
        undefined,
        onSubmit,
        "mcp-session-two",
        "codex",
      );
      expect(document.querySelector("[data-mcp-tag]")).toBeNull();

      await renderComposer(
        undefined,
        vi.fn(),
        false,
        0,
        getComposerDraft("mcp-session-one"),
        undefined,
        onSubmit,
        "mcp-session-one",
        "codex",
      );
      textarea = document.querySelector("textarea")!;
      expect(textarea.value).toContain("@mcp/docs");
      expect(document.querySelector('[data-mcp-tag="@mcp/docs"]')).not.toBeNull();
      await typeInto(textarea, `${textarea.value}Use docs`);
      await act(async () =>
        textarea.dispatchEvent(
          new KeyboardEvent("keydown", {
            key: "Enter",
            bubbles: true,
            cancelable: true,
          }),
        ),
      );
      expect(onSubmit).toHaveBeenCalledWith(
        expect.stringContaining('"docs" (codex)'),
        expect.any(Array),
        expect.any(Object),
      );
    } finally {
      clearComposerDraft("mcp-session-one");
      clearComposerDraft("mcp-session-two");
    }
  });

  it("keeps the draft when onBtwCommand rejects the command", async () => {
    const onBtwCommand = vi.fn(() => false);
    const onSubmit = vi.fn();
    await renderComposer(undefined, vi.fn(), false, 0, "/btw", onBtwCommand, onSubmit);
    const textarea = document.querySelector("textarea")!;
    await act(async () =>
      textarea.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Enter",
          bubbles: true,
          cancelable: true,
        }),
      ),
    );
    expect(onBtwCommand).toHaveBeenCalledWith("");
    expect(onSubmit).not.toHaveBeenCalled();
    expect(textarea.value).toBe("/btw");
  });

  it("clears the draft when the reset token advances", async () => {
    const onDraftChange = vi.fn();
    const props = {
      focused: true,
      harness: "claude" as const,
      model: "claude-sonnet",
      runtimeMode: "supervised" as const,
      executionCwd: "/repo",
      hideProjectPicker: true,
      hideBranchPicker: true,
      initialDraft: "something here...",
      draftResetToken: 1,
      onDraftChange,
      onFocus: vi.fn(),
      onCwdChange: vi.fn(),
      onModelChange: vi.fn(),
      onRuntimeModeChange: vi.fn(),
      onSubmit: vi.fn(),
    };
    await act(async () => root.render(createElement(Composer, props)));
    expect(document.querySelector("textarea")?.value).toBe("something here...");

    await act(async () => root.render(createElement(Composer, { ...props, draftResetToken: 2 })));
    expect(document.querySelector("textarea")?.value).toBe("");
    expect(onDraftChange).toHaveBeenLastCalledWith("");
  });

  it("keeps drafts and blocks sending until a working copy is selected", async () => {
    const onSubmit = vi.fn();
    const props = {
      harness: "claude" as const,
      model: "claude-sonnet",
      runtimeMode: "supervised" as const,
      executionCwd: "/deleted-worktree",
      hideProjectPicker: true,
      hideBranchPicker: true,
      initialDraft: "Continue this feature",
      onFocus: vi.fn(),
      onCwdChange: vi.fn(),
      onModelChange: vi.fn(),
      onRuntimeModeChange: vi.fn(),
      onSubmit,
    };
    await act(async () =>
      root.render(createElement(Composer, { ...props, worktreeRemoved: true })),
    );
    const textarea = document.querySelector("textarea")!;
    const send = document.querySelector<HTMLButtonElement>('[aria-label="Send"]')!;
    expect(send.disabled).toBe(true);
    expect(textarea.placeholder).toContain("Select a branch or worktree");
    await act(async () =>
      textarea.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Enter",
          bubbles: true,
          cancelable: true,
        }),
      ),
    );
    expect(onSubmit).not.toHaveBeenCalled();
    expect(textarea.value).toBe("Continue this feature");
    await act(async () =>
      root.render(createElement(Composer, { ...props, worktreeRemoved: false })),
    );
    expect(send.disabled).toBe(false);
    await act(async () => send.click());
    expect(onSubmit).toHaveBeenCalledWith("Continue this feature", [], {
      intent: "default",
      onSendRejected: expect.any(Function),
    });
  });

  it("places the caret at the end of an initial draft", async () => {
    const initialDraft = "Comment on src/App.tsx:42\n\n";
    await renderComposer(undefined, vi.fn(), false, 0, initialDraft);

    const textarea = document.querySelector("textarea")!;
    expect(textarea.value).toBe(initialDraft);
    expect(textarea.selectionStart).toBe(initialDraft.length);
    expect(textarea.selectionEnd).toBe(initialDraft.length);
  });

  it("explains Codex skill tagging and offers its goal command", async () => {
    await renderComposer(
      undefined,
      vi.fn(),
      false,
      0,
      "/goal",
      undefined,
      vi.fn(),
      "codex-goal-menu",
      "codex",
    );
    const textarea = document.querySelector("textarea")!;
    expect(textarea.placeholder).toContain("$ for skills");
    await act(async () => textarea.dispatchEvent(new Event("input", { bubbles: true })));
    const goal = Array.from(document.querySelectorAll<HTMLButtonElement>('[role="option"]')).find(
      (button) => button.textContent?.includes("/goal"),
    );
    expect(goal).toBeDefined();
    await act(async () => goal!.click());
    expect(textarea.value).toBe("/goal ");
  });

  it("loads and selects $, @ and / suggestions from a remote workspace", async () => {
    invalidateSkills();
    invalidateProjectFiles();
    const cwd = "remote://composer-host/work/repo";
    const runner = vi.fn(async (command: string) => {
      if (command === "skill_policy_get") return { disabledNames: [], disabledPaths: [] };
      if (command === "list_skills")
        return [
          {
            name: "remote-review",
            description: "Host review",
            path: `${cwd}/.agents/skills/remote-review/SKILL.md`,
            scope: "project",
            source: "agents",
          },
        ];
      if (command === "list_project_files")
        return [
          {
            name: "server.ts",
            relative: "src/server.ts",
            path: `${cwd}/src/server.ts`,
          },
        ];
      return [];
    });
    setRemoteCommandRunner(runner);
    const onSubmit = vi.fn(() => true);
    await renderComposer(
      undefined,
      vi.fn(),
      false,
      0,
      "$remote",
      undefined,
      onSubmit,
      "remote-suggestions",
      "codex",
      cwd,
      true,
    );
    const textarea = document.querySelector("textarea")!;
    const type = async (value: string) =>
      act(async () => {
        textarea.value = value;
        textarea.setSelectionRange(value.length, value.length);
        textarea.dispatchEvent(new Event("input", { bubbles: true }));
      });
    await type("$remote");
    const option = (label: string) =>
      Array.from(document.querySelectorAll<HTMLButtonElement>('[role="option"]')).find((button) =>
        button.textContent?.includes(label),
      );
    expect(option("$remote-review")).toBeDefined();
    await act(async () => option("$remote-review")!.click());
    expect(textarea.value).toBe("$remote-review ");
    await type("@server");
    expect(option("server.ts")).toBeDefined();
    await act(async () =>
      textarea.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Tab",
          bubbles: true,
          cancelable: true,
        }),
      ),
    );
    expect(textarea.value).toBe("@src/server.ts ");
    await type("/goal");
    expect(option("/goal")).toBeDefined();
    expect(runner.mock.calls.filter(([command]) => command === "list_skills")).toHaveLength(1);
    expect(runner.mock.calls.filter(([command]) => command === "skill_policy_get")).toHaveLength(1);
    expect(runner.mock.calls.filter(([command]) => command === "list_project_files")).toHaveLength(
      1,
    );
    expect(runner.mock.calls.some(([command]) => command === "list_claude_commands")).toBe(false);
    await act(async () => root.unmount());
    root = createRoot(container);
    setRemoteCommandRunner(async () => {
      throw new Error("No remote test host");
    });
  });

  it("offers host custom slash commands in a remote Claude session", async () => {
    const cwd = "remote://claude-composer/work/repo";
    const runner = vi.fn(async (command: string) =>
      command === "list_claude_commands"
        ? [
            {
              name: "team:review",
              description: "Host command",
              argumentHint: "[file]",
              scope: "project",
            },
          ]
        : [],
    );
    setRemoteCommandRunner(runner);
    await renderComposer(
      undefined,
      vi.fn(),
      false,
      0,
      "/team",
      undefined,
      vi.fn(),
      "remote-claude-commands",
      "claude",
      cwd,
      true,
    );
    const textarea = document.querySelector("textarea")!;
    await act(async () => textarea.dispatchEvent(new Event("input", { bubbles: true })));
    const command = Array.from(
      document.querySelectorAll<HTMLButtonElement>('[role="option"]'),
    ).find((button) => button.textContent?.includes("/team:review"));
    expect(command).toBeDefined();
    await act(async () => command!.click());
    expect(textarea.value).toBe("/team:review ");
    expect(runner.mock.calls.filter(([name]) => name === "list_claude_commands")).toHaveLength(1);
    await act(async () => root.unmount());
    root = createRoot(container);
    setRemoteCommandRunner(async () => {
      throw new Error("No remote test host");
    });
  });

  it("picks a Codex skill with $ and highlights it in the chat input", async () => {
    reportSessionCommands("codex-skill-menu", [
      {
        name: "plugin:review",
        kind: "skill",
        description: "Review code",
        path: "/skills/review/SKILL.md",
      },
    ]);
    await renderComposer(
      undefined,
      vi.fn(),
      false,
      0,
      "Review this",
      undefined,
      vi.fn(),
      "codex-skill-menu",
      "codex",
    );
    const textarea = document.querySelector("textarea")!;
    await act(async () =>
      container
        .querySelector<HTMLButtonElement>('[aria-label="Add files or choose a mode"]')!
        .click(),
    );
    const skillsButton = Array.from(
      document.querySelectorAll<HTMLButtonElement>("[data-composer-plus] button"),
    ).find((button) => button.textContent?.includes("Choose a skill or type $name"));
    expect(skillsButton).toBeDefined();
    await act(async () => skillsButton!.click());
    const skill = Array.from(document.querySelectorAll<HTMLButtonElement>('[role="option"]')).find(
      (button) => button.textContent?.includes("$plugin:review"),
    );
    expect(skill).toBeDefined();
    await act(async () => skill!.click());
    expect(textarea.value).toBe("Review this $plugin:review ");
    expect(document.querySelector(".text-skill")?.textContent).toBe("$plugin:review");
  });

  it("offers /operator in the slash picker and submits it as a local command", async () => {
    const onSubmit = vi.fn(() => true);
    await act(async () =>
      root.render(
        createElement(Composer, {
          focused: true,
          harness: "claude",
          model: "claude-sonnet",
          runtimeMode: "supervised",
          executionCwd: "/repo",
          initialDraft: "/operator",
          hideProjectPicker: true,
          hideBranchPicker: true,
          onFocus: vi.fn(),
          onCwdChange: vi.fn(),
          onModelChange: vi.fn(),
          onRuntimeModeChange: vi.fn(),
          onSubmit,
        }),
      ),
    );
    const textarea = document.querySelector("textarea")!;
    await act(async () => textarea.dispatchEvent(new Event("input", { bubbles: true })));
    const command = Array.from(
      document.querySelectorAll<HTMLButtonElement>('[role="option"]'),
    ).find((button) => button.textContent?.includes("/operator"));
    expect(command).toBeDefined();
    await act(async () => command!.click());
    expect(textarea.value).toBe("/operator ");
    expect(document.querySelector('[aria-label="Turn off Operator"]')).not.toBeNull();
    await act(async () => {
      textarea.value += "list my notes";
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () =>
      container.querySelector<HTMLButtonElement>('[aria-label="Send"]')!.click(),
    );
    expect(onSubmit).toHaveBeenCalledWith("/operator list my notes", [], {
      intent: "default",
      onSendRejected: expect.any(Function),
    });
  });

  it("keeps /plan in the text beside its pill and submits with the plan intent", async () => {
    const onSubmit = vi.fn(() => true);
    await act(async () =>
      root.render(
        createElement(Composer, {
          focused: true,
          harness: "claude",
          model: "claude-sonnet",
          runtimeMode: "supervised",
          executionCwd: "/repo",
          initialDraft: "/pla",
          hideProjectPicker: true,
          hideBranchPicker: true,
          onFocus: vi.fn(),
          onCwdChange: vi.fn(),
          onModelChange: vi.fn(),
          onRuntimeModeChange: vi.fn(),
          onSubmit,
        }),
      ),
    );
    const textarea = document.querySelector("textarea")!;
    await act(async () => textarea.dispatchEvent(new Event("input", { bubbles: true })));
    const command = Array.from(
      document.querySelectorAll<HTMLButtonElement>('[role="option"]'),
    ).find((button) => button.textContent?.includes("/plan"));
    await act(async () => command!.click());
    expect(textarea.value).toBe("/plan ");
    expect(document.querySelector('[aria-label="Turn off Plan mode"]')).not.toBeNull();
    await act(async () => {
      textarea.value += "sketch the refactor";
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () =>
      container.querySelector<HTMLButtonElement>('[aria-label="Send"]')!.click(),
    );
    expect(onSubmit).toHaveBeenLastCalledWith("sketch the refactor", [], {
      intent: "plan",
      onSendRejected: expect.any(Function),
    });
  });

  it("keeps a picked /plan in the text beside its pill and submits with the plan intent", async () => {
    const onSubmit = vi.fn(() => true);
    await act(async () =>
      root.render(
        createElement(Composer, {
          focused: true,
          harness: "claude",
          model: "claude-sonnet",
          runtimeMode: "supervised",
          executionCwd: "/repo",
          initialDraft: "/pla",
          hideProjectPicker: true,
          hideBranchPicker: true,
          onFocus: vi.fn(),
          onCwdChange: vi.fn(),
          onModelChange: vi.fn(),
          onRuntimeModeChange: vi.fn(),
          onSubmit,
        }),
      ),
    );
    const textarea = document.querySelector("textarea")!;
    await act(async () => textarea.dispatchEvent(new Event("input", { bubbles: true })));
    const command = Array.from(
      document.querySelectorAll<HTMLButtonElement>('[role="option"]'),
    ).find((button) => button.textContent?.includes("/plan"));
    expect(command).toBeDefined();
    await act(async () => command!.click());
    expect(textarea.value).toBe("/plan ");
    expect(document.querySelector('[aria-label="Turn off Plan mode"]')).not.toBeNull();
    await act(async () => {
      textarea.value += "sketch the refactor";
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () =>
      container.querySelector<HTMLButtonElement>('[aria-label="Send"]')!.click(),
    );
    expect(onSubmit).toHaveBeenLastCalledWith("sketch the refactor", [], {
      intent: "plan",
      onSendRejected: expect.any(Function),
    });
  });

  it("offers /orchestrator in the slash picker and submits with the orchestrate intent", async () => {
    const onSubmit = vi.fn(() => true);
    await act(async () =>
      root.render(
        createElement(Composer, {
          focused: true,
          harness: "claude",
          model: "claude-sonnet",
          runtimeMode: "supervised",
          executionCwd: "/repo",
          initialDraft: "/orch",
          hideProjectPicker: true,
          hideBranchPicker: true,
          onFocus: vi.fn(),
          onCwdChange: vi.fn(),
          onModelChange: vi.fn(),
          onRuntimeModeChange: vi.fn(),
          onSubmit,
        }),
      ),
    );
    const textarea = document.querySelector("textarea")!;
    await act(async () => textarea.dispatchEvent(new Event("input", { bubbles: true })));
    const command = Array.from(
      document.querySelectorAll<HTMLButtonElement>('[role="option"]'),
    ).find((button) => button.textContent?.includes("/orchestrator"));
    expect(command).toBeDefined();
    await act(async () => command!.click());
    expect(textarea.value).toBe("/orchestrator ");
    expect(document.querySelector('[aria-label="Turn off Orchestrator mode"]')).not.toBeNull();
    await act(async () => {
      textarea.value += "ship the release";
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const send = document.querySelector<HTMLButtonElement>('[aria-label="Send"]')!;
    await act(async () => send.click());
    expect(onSubmit).toHaveBeenLastCalledWith("ship the release", [], {
      intent: "orchestrate",
      onSendRejected: expect.any(Function),
    });

    await act(async () => {
      textarea.value = "/orchestrator fix the build";
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => send.click());
    expect(onSubmit).toHaveBeenLastCalledWith("fix the build", [], {
      intent: "orchestrate",
      onSendRejected: expect.any(Function),
    });
  });

  async function renderWithResume(
    harness: "claude" | "codex",
    onResumeProviderSession?: () => void,
    remoteSession = false,
    initialDraft = "/resume",
  ) {
    const onSubmit = vi.fn(() => true);
    await act(async () =>
      root.render(
        createElement(Composer, {
          focused: true,
          harness,
          model: harness === "claude" ? "claude-sonnet" : "gpt-5",
          runtimeMode: "supervised",
          executionCwd: remoteSession ? "remote://resume-host/repo" : "/repo",
          remoteSession,
          initialDraft,
          hideProjectPicker: true,
          hideBranchPicker: true,
          onFocus: vi.fn(),
          onCwdChange: vi.fn(),
          onModelChange: vi.fn(),
          onRuntimeModeChange: vi.fn(),
          onSubmit,
          ...(onResumeProviderSession ? { onResumeProviderSession } : {}),
        }),
      ),
    );
    const textarea = document.querySelector("textarea")!;
    await act(async () => textarea.dispatchEvent(new Event("input", { bubbles: true })));
    const option = Array.from(document.querySelectorAll<HTMLButtonElement>('[role="option"]')).find(
      (button) => button.textContent?.includes("/resume"),
    );
    return { option, textarea, onSubmit };
  }

  it("offers /resume for Claude and opens the picker without leaving text behind", async () => {
    const onResumeProviderSession = vi.fn();
    const { option, textarea } = await renderWithResume("claude", onResumeProviderSession);
    expect(option).toBeDefined();
    await act(async () => option!.click());
    expect(onResumeProviderSession).toHaveBeenCalledTimes(1);
    // Choosing a conversation loads a transcript; it is not a prompt to send.
    expect(textarea.value).toBe("");
  });

  it("offers /resume for Codex and opens import without starting a model turn", async () => {
    const onResume = vi.fn();
    const { option, textarea, onSubmit } = await renderWithResume("codex", onResume);
    expect(option).toBeDefined();
    await act(async () => option!.click());
    expect(onResume).toHaveBeenCalledOnce();
    expect(onSubmit).not.toHaveBeenCalled();
    expect(textarea.value).toBe("");
  });

  it.each(["claude", "codex"] as const)(
    "imports a typed / resume from Send for %s",
    async (harness) => {
      const onResume = vi.fn();
      const { textarea, onSubmit } = await renderWithResume(harness, onResume, false, "/ resume");
      await act(async () =>
        container.querySelector<HTMLButtonElement>('[aria-label="Send"]')!.click(),
      );
      expect(onResume).toHaveBeenCalledOnce();
      expect(onSubmit).not.toHaveBeenCalled();
      expect(textarea.value).toBe("");
    },
  );

  it("keeps a remote /resume draft and explains why terminal import is unavailable", async () => {
    const onResume = vi.fn();
    const { textarea, onSubmit } = await renderWithResume("codex", onResume, true);
    await act(async () =>
      container.querySelector<HTMLButtonElement>('[aria-label="Send"]')!.click(),
    );
    expect(onResume).not.toHaveBeenCalled();
    expect(onSubmit).not.toHaveBeenCalled();
    expect(textarea.value).toBe("/resume");
    expect(document.body.textContent).toContain(
      "Importing terminal conversations from a remote machine is not available yet",
    );
  });

  it("hides /resume when the picker is not wired up", async () => {
    const { option } = await renderWithResume("claude");
    expect(option).toBeUndefined();
  });

  it.each(["claude", "codex"] as const)(
    "opens terminal history with Enter on /resume for %s",
    async (harness) => {
      const onResume = vi.fn();
      const { textarea, onSubmit } = await renderWithResume(harness, onResume);
      await act(async () =>
        textarea.dispatchEvent(
          new KeyboardEvent("keydown", {
            key: "Enter",
            bubbles: true,
            cancelable: true,
          }),
        ),
      );
      expect(onResume).toHaveBeenCalledOnce();
      expect(onSubmit).not.toHaveBeenCalled();
      expect(textarea.value).toBe("");
    },
  );

  it("offers Operator above Orchestrator and sends the /operator command", async () => {
    const onSubmit = vi.fn().mockReturnValueOnce(false).mockReturnValue(true);
    await act(async () =>
      root.render(
        createElement(Composer, {
          focused: true,
          harness: "claude",
          model: "claude-sonnet",
          runtimeMode: "supervised",
          executionCwd: "/repo",
          initialDraft: "List my notes",
          hideProjectPicker: true,
          hideBranchPicker: true,
          onFocus: vi.fn(),
          onCwdChange: vi.fn(),
          onModelChange: vi.fn(),
          onRuntimeModeChange: vi.fn(),
          onSubmit,
        }),
      ),
    );
    await act(async () =>
      container
        .querySelector<HTMLButtonElement>('[aria-label="Add files or choose a mode"]')!
        .click(),
    );
    const options = Array.from(
      document.querySelectorAll<HTMLButtonElement>("[data-composer-plus] button"),
    );
    const operator = options.find((button) => button.textContent?.includes("Operator"))!;
    expect(operator).toBeDefined();
    expect(options.indexOf(operator)).toBeLessThan(
      options.findIndex((button) => button.textContent?.includes("Orchestrator")),
    );
    await act(async () => operator.click());
    const textarea = document.querySelector("textarea")!;
    expect(textarea.value).toBe("List my notes");
    expect(document.querySelector('[aria-label="Turn off Operator"]')).not.toBeNull();

    const send = document.querySelector<HTMLButtonElement>('[aria-label="Send"]')!;
    await act(async () => send.click());
    expect(onSubmit).toHaveBeenLastCalledWith("/operator List my notes", [], {
      intent: "default",
      onSendRejected: expect.any(Function),
    });
    expect(textarea.value).toBe("List my notes");
    expect(document.querySelector('[aria-label="Turn off Operator"]')).not.toBeNull();

    await act(async () => {
      textarea.value = "/operator List my notes";
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
      send.click();
    });
    expect(onSubmit).toHaveBeenCalledTimes(2);
    expect(onSubmit).toHaveBeenLastCalledWith("/operator List my notes", [], {
      intent: "default",
      onSendRejected: expect.any(Function),
    });
    expect(textarea.value).toBe("");
    expect(document.querySelector('[aria-label="Turn off Operator"]')).toBeNull();
  });

  it("clears the parent draft before submit so a remounting composer stays empty", async () => {
    let parentDraft = "Ship the empty-state fix";
    const onDraftChange = vi.fn((text: string) => {
      parentDraft = text;
    });
    const baseProps = {
      focused: true,
      harness: "claude" as const,
      model: "claude-sonnet",
      runtimeMode: "supervised" as const,
      executionCwd: "/repo",
      hideProjectPicker: true,
      hideBranchPicker: true,
      initialDraft: parentDraft,
      onDraftChange,
      onFocus: vi.fn(),
      onCwdChange: vi.fn(),
      onModelChange: vi.fn(),
      onRuntimeModeChange: vi.fn(),
    };
    const onSubmit = vi.fn(() => {
      act(() =>
        root.render(
          createElement(Composer, {
            ...baseProps,
            key: "docked",
            initialDraft: parentDraft,
            onSubmit,
          }),
        ),
      );
      return true;
    });
    await act(async () =>
      root.render(createElement(Composer, { ...baseProps, key: "empty", onSubmit })),
    );

    const textarea = document.querySelector("textarea")!;
    expect(textarea.value).toBe("Ship the empty-state fix");
    await act(async () =>
      container.querySelector<HTMLButtonElement>('[aria-label="Send"]')!.click(),
    );

    expect(onSubmit).toHaveBeenCalledWith("Ship the empty-state fix", [], {
      intent: "default",
      onSendRejected: expect.any(Function),
    });
    expect(onDraftChange).toHaveBeenCalledWith("");
    expect(parentDraft).toBe("");
    expect(textarea.value).toBe("");
  });

  it("restores the draft when submit is rejected", async () => {
    let parentDraft = "Blocked while orchestration is paused";
    const onDraftChange = vi.fn((text: string) => {
      parentDraft = text;
    });
    await act(async () =>
      root.render(
        createElement(Composer, {
          focused: true,
          harness: "claude",
          model: "claude-sonnet",
          runtimeMode: "supervised",
          executionCwd: "/repo",
          hideProjectPicker: true,
          hideBranchPicker: true,
          initialDraft: parentDraft,
          onDraftChange,
          onFocus: vi.fn(),
          onCwdChange: vi.fn(),
          onModelChange: vi.fn(),
          onRuntimeModeChange: vi.fn(),
          onSubmit: () => false,
        }),
      ),
    );

    const textarea = document.querySelector("textarea")!;
    await act(async () =>
      container.querySelector<HTMLButtonElement>('[aria-label="Send"]')!.click(),
    );

    expect(textarea.value).toBe("Blocked while orchestration is paused");
    expect(parentDraft).toBe("Blocked while orchestration is paused");
  });

  it("routes last-turn recall through common rewind and restores as a normal draft", async () => {
    const recalled = { text: "Original prompt", attachments: [] as Attachment[] };
    const onRecallLastTurn = vi.fn();
    let restoreMessage: ((value: typeof recalled) => void) | undefined;
    let recallLastTurn: (() => void) | undefined;
    const onSubmit = vi.fn(() => true);

    await act(async () =>
      root.render(
        createElement(Composer, {
          focused: true,
          harness: "claude",
          model: "claude-sonnet",
          runtimeMode: "supervised",
          executionCwd: "/repo",
          hideProjectPicker: true,
          hideBranchPicker: true,
          editLastTurnSupported: true,
          lastTurnRecall: recalled,
          onRecallLastTurn,
          onRecallLastTurnReady: (recall) => {
            recallLastTurn = recall;
          },
          onRecallMessageReady: (recall) => {
            restoreMessage = recall;
          },
          onFocus: vi.fn(),
          onCwdChange: vi.fn(),
          onModelChange: vi.fn(),
          onRuntimeModeChange: vi.fn(),
          onSubmit,
        }),
      ),
    );

    await act(async () => recallLastTurn?.());
    expect(onRecallLastTurn).toHaveBeenCalledWith(recalled);
    expect(document.querySelector("textarea")!.value).toBe("");

    await act(async () => restoreMessage?.(recalled));
    expect(document.querySelector("textarea")!.value).toBe("Original prompt");
    await act(async () =>
      container.querySelector<HTMLButtonElement>('[aria-label="Send"]')!.click(),
    );
    expect(onSubmit.mock.calls[0]?.[2]).toEqual({
      intent: "default",
      onSendRejected: expect.any(Function),
    });
  });

  it("applies a declarative recalled message after the composer remounts", async () => {
    const recalled = {
      text: "Recovered prompt",
      attachments: [
        {
          id: "rewound-image",
          name: "sketch.png",
          mimeType: "image/png",
          kind: "image" as const,
          size: 3,
          previewUrl: "blob:rewound-image",
        },
      ],
    };
    const onRecalledMessageApplied = vi.fn();
    const onSubmit = vi.fn(() => true);

    await act(async () =>
      root.render(
        createElement(Composer, {
          focused: true,
          harness: "claude",
          model: "claude-sonnet",
          runtimeMode: "supervised",
          executionCwd: "/repo",
          hideProjectPicker: true,
          hideBranchPicker: true,
          recalledMessage: { id: "rewind-1", value: recalled },
          onRecalledMessageApplied,
          onFocus: vi.fn(),
          onCwdChange: vi.fn(),
          onModelChange: vi.fn(),
          onRuntimeModeChange: vi.fn(),
          onSubmit,
        }),
      ),
    );

    expect(document.querySelector("textarea")!.value).toBe("Recovered prompt");
    expect(onRecalledMessageApplied).toHaveBeenCalledWith("rewind-1");
    await act(async () =>
      container.querySelector<HTMLButtonElement>('[aria-label="Send"]')!.click(),
    );
    expect(onSubmit).toHaveBeenCalledWith(
      "Recovered prompt",
      recalled.attachments,
      expect.not.objectContaining({ resendEdited: true }),
    );
  });

  it("does not restore a failed resend over newer composer text", async () => {
    let recallLastTurn: (() => void) | undefined;
    let rejectResend: ComposerTurnOptions["onResendRejected"];
    const onSubmit = vi.fn((_text: string, _files: Attachment[], options?: ComposerTurnOptions) => {
      rejectResend = options?.onResendRejected;
      return true;
    });

    await act(async () =>
      root.render(
        createElement(Composer, {
          focused: true,
          harness: "pi",
          model: "pi:default",
          runtimeMode: "supervised",
          executionCwd: "/repo",
          hideProjectPicker: true,
          hideBranchPicker: true,
          editLastTurnSupported: true,
          lastTurnRecall: { text: "Original prompt", attachments: [] },
          onRecallLastTurnReady: (recall) => {
            recallLastTurn = recall;
          },
          onFocus: vi.fn(),
          onCwdChange: vi.fn(),
          onModelChange: vi.fn(),
          onRuntimeModeChange: vi.fn(),
          onSubmit,
        }),
      ),
    );

    await act(async () => recallLastTurn?.());
    const textarea = document.querySelector("textarea")!;
    expect(textarea.value).toBe("Original prompt");

    await act(async () =>
      container.querySelector<HTMLButtonElement>('[aria-label="Send"]')!.click(),
    );
    await act(async () => {
      textarea.value = "New prompt";
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => rejectResend?.({ providerRewound: false }));

    expect(textarea.value).toBe("New prompt");
  });

  it("retries an already rewound prompt as a normal submission", async () => {
    let recallLastTurn: (() => void) | undefined;
    let rejectResend: ComposerTurnOptions["onResendRejected"];
    const onSubmit = vi.fn((_text: string, _files: Attachment[], options?: ComposerTurnOptions) => {
      rejectResend = options?.onResendRejected;
      return true;
    });

    await act(async () =>
      root.render(
        createElement(Composer, {
          focused: true,
          harness: "pi",
          model: "pi:default",
          runtimeMode: "supervised",
          executionCwd: "/repo",
          hideProjectPicker: true,
          hideBranchPicker: true,
          editLastTurnSupported: true,
          lastTurnRecall: { text: "Edited prompt", attachments: [] },
          onRecallLastTurnReady: (recall) => {
            recallLastTurn = recall;
          },
          onFocus: vi.fn(),
          onCwdChange: vi.fn(),
          onModelChange: vi.fn(),
          onRuntimeModeChange: vi.fn(),
          onSubmit,
        }),
      ),
    );

    await act(async () => recallLastTurn?.());
    await act(async () =>
      container.querySelector<HTMLButtonElement>('[aria-label="Send"]')!.click(),
    );
    await act(async () => rejectResend?.({ providerRewound: true }));

    const textarea = document.querySelector("textarea")!;
    expect(textarea.value).toBe("Edited prompt");
    await act(async () =>
      container.querySelector<HTMLButtonElement>('[aria-label="Send"]')!.click(),
    );

    expect(onSubmit).toHaveBeenCalledTimes(2);
    expect(onSubmit.mock.calls[1][2]).toEqual({
      intent: "default",
      onSendRejected: expect.any(Function),
    });
  });

  it("preserves attachment ownership when a resend is restored", async () => {
    const createObjectURL = vi.fn(() => "blob:owned");
    const revokeObjectURL = vi.fn();
    vi.stubGlobal("URL", { createObjectURL, revokeObjectURL });
    let recallLastTurn: (() => void) | undefined;
    let rejectResend: ComposerTurnOptions["onResendRejected"];
    const borrowed: Attachment = {
      id: "borrowed",
      name: "borrowed.png",
      mimeType: "image/png",
      kind: "image",
      size: 3,
      previewUrl: "blob:borrowed",
    };
    const onSubmit = vi.fn((_text: string, _files: Attachment[], options?: ComposerTurnOptions) => {
      rejectResend = options?.onResendRejected;
      return true;
    });

    await act(async () =>
      root.render(
        createElement(Composer, {
          focused: true,
          harness: "pi",
          model: "pi:default",
          runtimeMode: "supervised",
          executionCwd: "/repo",
          hideProjectPicker: true,
          hideBranchPicker: true,
          editLastTurnSupported: true,
          lastTurnRecall: {
            text: "Edited prompt",
            attachments: [borrowed],
          },
          onRecallLastTurnReady: (recall) => {
            recallLastTurn = recall;
          },
          onFocus: vi.fn(),
          onCwdChange: vi.fn(),
          onModelChange: vi.fn(),
          onRuntimeModeChange: vi.fn(),
          onSubmit,
        }),
      ),
    );

    await act(async () => recallLastTurn?.());
    const owned = new File(["new"], "owned.png", { type: "image/png" });
    const paste = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(paste, "clipboardData", {
      value: {
        getData: () => "",
        files: [owned],
        items: [
          {
            kind: "file",
            type: owned.type,
            getAsFile: () => owned,
          },
        ],
      },
    });
    await act(async () => {
      document.querySelector("textarea")!.dispatchEvent(paste);
      await new Promise((resolve) => setTimeout(resolve, 20));
    });

    await act(async () =>
      container.querySelector<HTMLButtonElement>('[aria-label="Send"]')!.click(),
    );
    await act(async () => rejectResend?.({ providerRewound: false }));
    await act(async () =>
      container.querySelector<HTMLButtonElement>('[aria-label="Remove owned.png"]')!.click(),
    );
    await act(async () =>
      container.querySelector<HTMLButtonElement>('[aria-label="Remove borrowed.png"]')!.click(),
    );

    expect(createObjectURL).toHaveBeenCalledOnce();
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:owned");
    expect(revokeObjectURL).not.toHaveBeenCalledWith("blob:borrowed");
  });

  it("saves a new message as a draft without submitting it", async () => {
    const onSubmit = vi.fn();
    const onSaveDraft = vi.fn();
    await act(async () =>
      root.render(
        createElement(Composer, {
          focused: true,
          harness: "claude",
          model: "claude-sonnet",
          runtimeMode: "supervised",
          executionCwd: "/repo",
          hideProjectPicker: true,
          hideBranchPicker: true,
          canSaveDraft: true,
          onFocus: vi.fn(),
          onCwdChange: vi.fn(),
          onModelChange: vi.fn(),
          onRuntimeModeChange: vi.fn(),
          onSubmit,
          onSaveDraft,
        }),
      ),
    );

    await act(async () =>
      container
        .querySelector<HTMLButtonElement>('[aria-label="Add files or choose a mode"]')!
        .click(),
    );
    const draftMode = [...document.querySelectorAll<HTMLButtonElement>("button")].find((button) =>
      button.textContent?.includes("Save this message"),
    );
    expect(draftMode).toBeDefined();
    await act(async () => draftMode!.click());

    const textarea = document.querySelector("textarea")!;
    await act(async () => {
      textarea.value = "Explore a quieter empty state";
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const save = document.querySelector<HTMLButtonElement>('[aria-label="Save draft"]');
    expect(save?.disabled).toBe(false);
    await act(async () => save!.click());

    expect(onSaveDraft).toHaveBeenCalledWith("Explore a quieter empty state", []);
    expect(onSubmit).not.toHaveBeenCalled();
    expect(textarea.value).toBe("");
  });

  it("saves a /draft message as a draft and keeps the command in the text", async () => {
    const onSubmit = vi.fn();
    const onSaveDraft = vi.fn();
    await act(async () =>
      root.render(
        createElement(Composer, {
          focused: true,
          harness: "claude",
          model: "claude-sonnet",
          runtimeMode: "supervised",
          executionCwd: "/repo",
          initialDraft: "/dra",
          hideProjectPicker: true,
          hideBranchPicker: true,
          canSaveDraft: true,
          onFocus: vi.fn(),
          onCwdChange: vi.fn(),
          onModelChange: vi.fn(),
          onRuntimeModeChange: vi.fn(),
          onSubmit,
          onSaveDraft,
        }),
      ),
    );
    const textarea = document.querySelector("textarea")!;
    await act(async () => textarea.dispatchEvent(new Event("input", { bubbles: true })));
    const command = Array.from(
      document.querySelectorAll<HTMLButtonElement>('[role="option"]'),
    ).find((button) => button.textContent?.includes("/draft"));
    expect(command).toBeDefined();
    await act(async () => command!.click());
    expect(textarea.value).toBe("/draft ");
    expect(document.querySelector('[title="Turn off Draft mode"]')).not.toBeNull();
    await act(async () => {
      textarea.value += "Explore a quieter empty state";
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const save = document.querySelector<HTMLButtonElement>('[aria-label="Save draft"]');
    expect(save).not.toBeNull();
    await act(async () => save!.click());

    expect(onSaveDraft).toHaveBeenCalledWith("Explore a quieter empty state", []);
    expect(onSubmit).not.toHaveBeenCalled();
    expect(textarea.value).toBe("");
  });

  it("locks a started session to its worktree while keeping its branch editable", async () => {
    await act(async () =>
      root.render(
        createElement(Composer, {
          focused: true,
          harness: "claude",
          model: "claude-sonnet",
          runtimeMode: "supervised",
          cwd: "/repo",
          executionCwd: "/repo-worktrees/mc-greeting",
          hideProjectPicker: true,
          onFocus: vi.fn(),
          onCwdChange: vi.fn(),
          onWorktreeChange: vi.fn(async () => {}),
          onModelChange: vi.fn(),
          onRuntimeModeChange: vi.fn(),
          onSubmit: vi.fn(),
        }),
      ),
    );

    const workspace = document.querySelector('[aria-label="Workspace Worktree"]');
    expect(workspace?.tagName).toBe("DIV");
    expect(document.querySelector('[aria-label="Choose working copy"]')).toBeNull();
    expect(document.querySelector('[aria-label="Branch mc/greeting"]')).not.toBeNull();
  });

  it("toggles a draft between the current checkout and a new worktree", async () => {
    const onWorkspaceModeChange = vi.fn();
    const onWorktreeBaseChange = vi.fn();
    const props = {
      focused: true,
      harness: "claude" as const,
      model: "claude-sonnet",
      runtimeMode: "supervised" as const,
      cwd: "/repo",
      executionCwd: "/repo",
      branch: "main",
      hideProjectPicker: true,
      draftWorkspace: true,
      onFocus: vi.fn(),
      onCwdChange: vi.fn(),
      onBranchChange: vi.fn(async () => {}),
      onWorktreeChange: vi.fn(async () => {}),
      onWorkspaceModeChange,
      onWorktreeBaseChange,
      onModelChange: vi.fn(),
      onRuntimeModeChange: vi.fn(),
      onSubmit: vi.fn(),
    };
    await act(async () =>
      root.render(createElement(Composer, { ...props, workspaceMode: "current" })),
    );
    const textarea = document.querySelector("textarea")!;
    const workspace = document.querySelector<HTMLButtonElement>(
      '[aria-label="Workspace Current checkout"]',
    )!;
    expect(document.querySelector('[aria-label="Branch main"]')).not.toBeNull();
    await act(async () => workspace.click());
    expect(document.body.textContent).toContain("Existing worktree…");
    expect(document.querySelector('[aria-label="Branch main"]')).not.toBeNull();
    await act(async () => workspace.click());

    await act(async () =>
      textarea.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "g",
          ctrlKey: true,
          shiftKey: true,
          bubbles: true,
          cancelable: true,
        }),
      ),
    );
    expect(onWorkspaceModeChange).toHaveBeenLastCalledWith("worktree", "main");

    await act(async () =>
      root.render(createElement(Composer, { ...props, workspaceMode: "worktree" })),
    );
    await act(async () =>
      textarea.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "G",
          ctrlKey: true,
          shiftKey: true,
          bubbles: true,
          cancelable: true,
        }),
      ),
    );
    expect(onWorkspaceModeChange).toHaveBeenLastCalledWith("current", undefined);

    await act(async () =>
      root.render(
        createElement(Composer, {
          ...props,
          branch: undefined,
          workspaceMode: "current",
        }),
      ),
    );
    await act(async () =>
      textarea.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "g",
          ctrlKey: true,
          shiftKey: true,
          bubbles: true,
          cancelable: true,
        }),
      ),
    );
    expect(onWorkspaceModeChange).toHaveBeenLastCalledWith("worktree", "main");

    await act(async () =>
      root.render(
        createElement(Composer, {
          ...props,
          branch: undefined,
          workspaceMode: "worktree",
          worktreeBase: "HEAD",
        }),
      ),
    );
    expect(onWorktreeBaseChange).toHaveBeenLastCalledWith("mc/greeting");
  });

  it("holds new remote sends until the creator explicitly supports managed ownership", async () => {
    const onSubmit = vi.fn();
    const onSaveDraft = vi.fn();
    const props = {
      focused: false,
      harness: "codex" as const,
      model: "codex:gpt-6.1",
      runtimeMode: "supervised" as const,
      cwd: "remote://fixture/repo",
      executionCwd: "remote://fixture/repo",
      draftWorkspace: true,
      hideTopBar: true,
      hideBranchPicker: true,
      initialDraft: "Keep this remote draft",
      canSaveDraft: true,
      onSaveDraft,
      onFocus: vi.fn(),
      onCwdChange: vi.fn(),
      onModelChange: vi.fn(),
      onRuntimeModeChange: vi.fn(),
      onSubmit,
    };
    await act(async () => root.render(createElement(Composer, props)));
    expect(container.textContent).toContain(
      "Update bycoda to create managed sessions on this remote Host.",
    );
    expect(container.querySelector<HTMLButtonElement>('[aria-label="Send"]')?.disabled).toBe(true);
    const textarea = container.querySelector("textarea")!;
    await act(async () =>
      textarea.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }),
      ),
    );
    expect(onSubmit).not.toHaveBeenCalled();
    expect(textarea.value).toBe("Keep this remote draft");
    await act(async () => {
      textarea.value = "/draft Keep this remote draft";
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(container.querySelector<HTMLButtonElement>('[aria-label="Save draft"]')?.disabled).toBe(
      true,
    );
    await act(async () =>
      textarea.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }),
      ),
    );
    expect(onSaveDraft).not.toHaveBeenCalled();
    await act(async () => {
      textarea.value = "Keep this remote draft";
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () =>
      root.render(createElement(Composer, { ...props, managedWorkspaceCreationReady: true })),
    );
    expect(container.querySelector<HTMLButtonElement>('[aria-label="Send"]')?.disabled).toBe(false);
    await act(async () =>
      root.render(createElement(Composer, { ...props, draftWorkspace: false })),
    );
    expect(container.querySelector<HTMLButtonElement>('[aria-label="Send"]')?.disabled).toBe(false);
  });

  it("focuses the draft from blank composer space without intercepting controls", async () => {
    await renderComposer(undefined, vi.fn());
    const textarea = document.querySelector("textarea")!;
    const box = document.querySelector("[data-composer-box]")!;
    const button = box.querySelector("button")!;
    textarea.blur();
    await act(async () => {
      box.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0 }));
    });
    expect(document.activeElement).toBe(textarea);
    textarea.blur();
    const press = new PointerEvent("pointerdown", { bubbles: true, cancelable: true, button: 0 });
    await act(async () => button.dispatchEvent(press));
    expect(press.defaultPrevented).toBe(false);
    expect(document.activeElement).not.toBe(textarea);
  });

  it("honors an explicit session focus request across visible split composers", async () => {
    await renderComposer(undefined, vi.fn());
    const other = document.createElement("div");
    other.setAttribute("data-composer", "");
    const input = document.createElement("textarea");
    other.append(input);
    document.body.append(other);
    input.focus();
    await renderComposer(undefined, vi.fn(), false, 1);
    expect(document.activeElement).toBe(document.querySelector("textarea"));
    other.remove();
  });

  it("returns focus to the composer textarea once a question is answered", async () => {
    const onQuestionReply = vi.fn();
    await renderComposer(question, onQuestionReply);

    await act(async () =>
      (
        document.querySelector('[data-question-form] input[type="radio"]') as HTMLInputElement
      ).click(),
    );
    await act(async () =>
      (document.querySelector('button[type="submit"]') as HTMLButtonElement).click(),
    );
    expect(onQuestionReply).toHaveBeenCalledWith(1, {
      kind: "answered",
      answers: { q1: ["a"] },
    });

    // The real app clears `question` once onQuestionReply resolves it.
    await renderComposer(undefined, onQuestionReply);

    expect(document.activeElement).toBe(document.querySelector("textarea"));
  });

  it("returns focus to the composer textarea once the agent turn finishes", async () => {
    await renderComposer(undefined, vi.fn(), true);
    const textarea = document.querySelector("textarea") as HTMLTextAreaElement;

    const decoy = document.createElement("input");
    document.body.append(decoy);
    decoy.focus();
    expect(document.activeElement).toBe(decoy);

    await renderComposer(undefined, vi.fn(), false);

    expect(document.activeElement).toBe(textarea);
    decoy.remove();
  });

  it("returns focus to the composer textarea when focusToken bumps while already focused", async () => {
    await renderComposer(undefined, vi.fn());
    const textarea = document.querySelector("textarea") as HTMLTextAreaElement;

    const decoy = document.createElement("input");
    document.body.append(decoy);
    decoy.focus();
    expect(document.activeElement).toBe(decoy);

    // `focused` never changes value here (stays true throughout) — mirrors a
    // real window blur/refocus, where React's composerFocused state doesn't
    // change even though the OS took DOM focus away and back.
    await renderComposer(undefined, vi.fn(), false, 1);

    expect(document.activeElement).toBe(textarea);
    decoy.remove();
  });

  it("does not steal focus from a control inside a different composer", async () => {
    await renderComposer(undefined, vi.fn(), true);

    // Simulates focus reaching another mounted Composer's control via
    // keyboard Tab navigation, which never fires the onMouseDown-based
    // onFocus that would normally update which pane is "focused".
    const otherComposer = document.createElement("div");
    otherComposer.setAttribute("data-composer", "");
    const otherInput = document.createElement("textarea");
    otherComposer.append(otherInput);
    document.body.append(otherComposer);
    otherInput.focus();
    expect(document.activeElement).toBe(otherInput);

    await renderComposer(undefined, vi.fn(), false);

    expect(document.activeElement).toBe(otherInput);
    otherComposer.remove();
  });

  it("takes focus from a composer in a hidden session", async () => {
    const hiddenSession = document.createElement("div");
    hiddenSession.setAttribute("aria-hidden", "true");
    const hiddenComposer = document.createElement("div");
    hiddenComposer.setAttribute("data-composer", "");
    const hiddenInput = document.createElement("textarea");
    hiddenComposer.append(hiddenInput);
    hiddenSession.append(hiddenComposer);
    document.body.append(hiddenSession);
    hiddenInput.focus();
    expect(document.activeElement).toBe(hiddenInput);

    await renderComposer(undefined, vi.fn());

    expect(document.activeElement).toBe(document.querySelector("textarea"));
    hiddenSession.remove();
  });

  it("does not steal focus from a picker portaled outside the composer", async () => {
    await renderComposer(undefined, vi.fn(), true);

    // Popover.tsx portals picker content directly into document.body, so it
    // never sits under this composer's own [data-composer] subtree.
    const portaledPicker = document.createElement("div");
    portaledPicker.setAttribute("data-model-picker", "");
    const searchInput = document.createElement("input");
    portaledPicker.append(searchInput);
    document.body.append(portaledPicker);
    searchInput.focus();
    expect(document.activeElement).toBe(searchInput);

    await renderComposer(undefined, vi.fn(), false);

    expect(document.activeElement).toBe(searchInput);
    portaledPicker.remove();
  });

  it("opens the MCP picker in Save draft mode and offers Manage", async () => {
    const onSaveDraft = vi.fn();
    const onOpen = vi.fn();
    window.addEventListener("bycoda:open-mcp-settings", onOpen);
    try {
      await act(async () =>
        root.render(
          createElement(Composer, {
            focused: true,
            harness: "claude",
            model: "claude-sonnet",
            runtimeMode: "supervised",
            executionCwd: "/repo",
            hideProjectPicker: true,
            hideBranchPicker: true,
            canSaveDraft: true,
            onFocus: vi.fn(),
            onCwdChange: vi.fn(),
            onModelChange: vi.fn(),
            onRuntimeModeChange: vi.fn(),
            onSubmit: vi.fn(),
            onSaveDraft,
          }),
        ),
      );
      await act(async () =>
        container
          .querySelector<HTMLButtonElement>('[aria-label="Add files or choose a mode"]')!
          .click(),
      );
      const draftMode = [...document.querySelectorAll<HTMLButtonElement>("button")].find((button) =>
        button.textContent?.includes("Save this message"),
      )!;
      await act(async () => draftMode.click());
      const textarea = document.querySelector("textarea")!;
      await act(async () => {
        textarea.value = "/mcp";
        textarea.dispatchEvent(new Event("input", { bubbles: true }));
      });
      await act(async () =>
        textarea.dispatchEvent(
          new KeyboardEvent("keydown", {
            key: "Enter",
            bubbles: true,
            cancelable: true,
          }),
        ),
      );
      expect(document.querySelector("[data-mcp-picker]")).not.toBeNull();
      expect(onSaveDraft).not.toHaveBeenCalled();
      const manage = [...document.querySelectorAll<HTMLButtonElement>("button")].find((button) =>
        button.textContent?.includes("Manage MCP Servers"),
      )!;
      await act(async () => manage.click());
      expect(onOpen).toHaveBeenCalledOnce();
    } finally {
      window.removeEventListener("bycoda:open-mcp-settings", onOpen);
    }
  });
});
