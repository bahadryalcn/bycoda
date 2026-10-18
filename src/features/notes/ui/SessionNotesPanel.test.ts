// @vitest-environment happy-dom
import { act, createElement, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { resetRetainedState } from "../../../shared/hooks/useRetainedState";
import {
  ADD_NOTE_TO_CHAT_EVENT,
  invalidateNotes,
  loadNotes,
  type Note,
  type NoteUpsert,
} from "../notes";
import { SessionNotesPanel } from "./SessionNotesPanel";

const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
let root: Root;
let container: HTMLDivElement;
let stored: Note[];
let sequence = 0;
let sessionId: string;
const projectNote: Note = {
  id: "project-note",
  slug: "project-plan",
  title: "Project plan",
  body: "Project text",
  sourceCwd: "/work/app",
  tags: [],
  createdAt: 1,
  updatedAt: 1,
};

beforeEach(() => {
  resetRetainedState();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.clear();
  invalidateNotes();
  stored = [{ ...projectNote }];
  sessionId = `session-${++sequence}`;
  invoke.mockReset();
  invoke.mockImplementation(
    async (command: string, args?: { note: NoteUpsert; id: string; sessionId: string }) => {
      if (command === "notes_list" || command === "notes_list_summaries")
        return stored.map((note) => ({ ...note }));
      if (command === "notes_get") return stored.find((note) => note.id === args?.id) ?? null;
      if (command === "notes_upsert") {
        const input = args!.note;
        const existing = stored.find((note) => note.id === input.id);
        const saved: Note = {
          slug: "new-note",
          createdAt: 2,
          updatedAt: 2,
          ...existing,
          ...input,
          title: input.title || "Untitled",
          slugPending: existing?.slugPending ?? !input.title,
        };
        stored = [saved, ...stored.filter((note) => note.id !== saved.id)];
        return saved;
      }
      if (command === "notes_link_session") {
        const saved = {
          ...stored.find((note) => note.id === args!.id)!,
          sourceSessionId: args!.sessionId,
        };
        stored = stored.map((note) => (note.id === saved.id ? saved : note));
        return saved;
      }
      if (command === "notes_delete") {
        stored = stored.filter((note) => note.id !== args!.id);
        return;
      }
      throw new Error(`Unexpected command: ${command}`);
    },
  );
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it("persists inline title edits and restores the saved title after a rejected rename", async () => {
  await render();
  const titleButton = () =>
    container.querySelector<HTMLButtonElement>('button[aria-label^="Note title:"]')!;
  await act(async () => titleButton().click());
  await input(
    container.querySelector<HTMLInputElement>('input[aria-label="Note title"]')!,
    "Inline title",
  );
  await act(async () =>
    container
      .querySelector<HTMLInputElement>('input[aria-label="Note title"]')!
      .dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })),
  );
  expect(stored.find((note) => note.sourceSessionId === sessionId)?.title).toBe("Inline title");
  const save = invoke.getMockImplementation()!;
  invoke.mockImplementation((command, args) =>
    command === "notes_upsert" ? Promise.reject(new Error("Write failed")) : save(command, args),
  );
  await act(async () => titleButton().click());
  await input(
    container.querySelector<HTMLInputElement>('input[aria-label="Note title"]')!,
    "Rejected title",
  );
  await act(async () =>
    container
      .querySelector<HTMLInputElement>('input[aria-label="Note title"]')!
      .dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })),
  );
  expect(titleButton().getAttribute("aria-label")).toBe("Note title: Inline title");
  expect(container.textContent).toContain("Try again");
  expect(stored.find((note) => note.sourceSessionId === sessionId)?.title).toBe("Inline title");
});

async function render(id = sessionId, strict = false) {
  await act(async () => {
    const panel = createElement(SessionNotesPanel, {
      sessionId: id,
      cwd: "/work/app",
    });
    root.render(strict ? createElement(StrictMode, null, panel) : panel);
  });
}
function button(label: string) {
  const found = [...container.querySelectorAll("button")].find(
    (item) => item.getAttribute("aria-label") === label || item.textContent === label,
  );
  expect(found, label).toBeTruthy();
  return found!;
}
async function click(label: string) {
  await act(async () => button(label).click());
}
async function input(field: HTMLInputElement | HTMLTextAreaElement, value: string) {
  await act(async () => {
    const prototype =
      field instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(field, value);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
const body = () => container.querySelector("textarea")!;

it("keeps autosaving the draft after deletion fails", async () => {
  await render();
  vi.useFakeTimers();
  await input(body(), "Keep this draft");
  invoke.mockRejectedValueOnce(new Error("Delete unavailable"));
  await click("Delete note");
  expect(container.textContent).toContain("Delete unavailable");
  await input(body(), "Keep this draft and the next edit");
  await act(async () => {
    await vi.advanceTimersByTimeAsync(500);
  });
  expect(stored.find((note) => note.sourceSessionId === sessionId)?.body).toBe(
    "Keep this draft and the next edit",
  );
  expect(button("Delete note").disabled).toBe(false);
});

it("creates one blank session document even with project notes and StrictMode remounts", async () => {
  await render(sessionId, true);
  expect(body().value).toBe("");
  const own = stored.filter((note) => note.sourceSessionId === sessionId);
  expect(own).toHaveLength(1);
  expect(own[0].sourceCwd).toBe("/work/app");
  expect(own[0].slugPending).toBe(true);
  await act(async () => root.render(null));
  await render();
  expect(stored.filter((note) => note.sourceSessionId === sessionId)).toHaveLength(1);
});

it("opens this session's document and resets selection when the session changes", async () => {
  stored.push({
    ...projectNote,
    id: "own",
    body: "Session text",
    sourceSessionId: sessionId,
  });
  await render();
  expect(body().value).toBe("Session text");
  await render(`${sessionId}-other`);
  expect(body().value).toBe("");
  expect(stored.some((note) => note.sourceSessionId === `${sessionId}-other`)).toBe(true);
});

it("links a chosen project note and remembers it after reopening", async () => {
  await render();
  await click("Switch note");
  await act(async () =>
    container.querySelector<HTMLButtonElement>('button[title="Project plan"]')!.click(),
  );
  expect(body().value).toBe("Project text");
  await click("Link to this session");
  expect(stored.find((note) => note.id === projectNote.id)?.sourceSessionId).toBe(sessionId);
  await act(async () => root.render(null));
  await render();
  expect(body().value).toBe("Project text");
});

it("sends the current unsaved note as a composer card", async () => {
  await render();
  await input(body(), "Use the current draft");
  const onCard = vi.fn();
  window.addEventListener(ADD_NOTE_TO_CHAT_EVENT, onCard);
  try {
    await click("Add to chat");
    expect(onCard).toHaveBeenCalledOnce();
    expect((onCard.mock.calls[0][0] as CustomEvent).detail).toMatchObject({
      body: "Use the current draft",
      id: stored[0].id,
    });
  } finally {
    window.removeEventListener(ADD_NOTE_TO_CHAT_EVENT, onCard);
  }
});

it("confirms copying the current draft only after clipboard success and permits retry after rejection", async () => {
  await render();
  await input(body(), "Current clipboard draft");
  let finish!: () => void;
  const pending = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const write = vi
    .spyOn(navigator.clipboard, "writeText")
    .mockRejectedValueOnce(new Error("Clipboard unavailable"))
    .mockImplementationOnce(() => pending);
  const copyButton = () => container.querySelector<HTMLButtonElement>('[data-id="copy"]')!;
  try {
    await click("Copy note");
    expect(copyButton().dataset.state).toBe("idle");
    await click("Copy note");
    await click("Copy note");
    expect(write).toHaveBeenCalledTimes(2);
    expect(write).toHaveBeenLastCalledWith("Current clipboard draft");
    expect(copyButton().getAttribute("aria-busy")).toBe("true");
    expect(copyButton().dataset.state).toBe("idle");
    await act(async () => finish());
    expect(copyButton().dataset.state).toBe("done");
  } finally {
    write.mockRestore();
  }
});

it("opens the dropdown without waiting for a pending save or fetching the list again", async () => {
  await render();
  let finish!: (note: Note) => void;
  const pending = new Promise<Note>((resolve) => {
    finish = resolve;
  });
  invoke.mockImplementationOnce(() => pending);
  await input(body(), "Pending draft");
  await act(async () => {
    body().focus();
    body().blur();
  });
  const listCalls = invoke.mock.calls.filter(
    ([command]) => command === "notes_list" || command === "notes_list_summaries",
  ).length;
  await click("Switch note");
  expect(button("Switch note").getAttribute("aria-expanded")).toBe("true");
  expect(container.querySelector('button[title="Project plan"]')).not.toBeNull();
  expect(
    invoke.mock.calls.filter(
      ([command]) => command === "notes_list" || command === "notes_list_summaries",
    ),
  ).toHaveLength(listCalls);
  await act(async () => finish({ ...stored[0], body: "Pending draft" }));
});

it("bounds dropdown rendering and finds notes beyond the first page", async () => {
  stored = Array.from({ length: 250 }, (_, index) => ({
    ...projectNote,
    id: `project-${index}`,
    title: `Plan ${index}`,
    updatedAt: index,
  }));
  await loadNotes(true);
  await render();
  await click("Switch note");
  expect(container.querySelectorAll("li")).toHaveLength(40);
  await click("Show more");
  expect(container.querySelectorAll("li")).toHaveLength(80);
  await input(
    container.querySelector<HTMLInputElement>('input[aria-label="Search notes"]')!,
    "Plan 0",
  );
  expect(container.querySelectorAll("li")).toHaveLength(1);
  expect(container.querySelector('button[title="Plan 0"]')).not.toBeNull();
});

it("shows a load error without creating an empty document on failed reads", async () => {
  invoke.mockRejectedValueOnce(new Error("Disk unavailable"));
  await render();
  expect(container.querySelector('[role="alert"]')?.textContent).toContain("Disk unavailable");
  expect(invoke.mock.calls.some(([command]) => command === "notes_upsert")).toBe(false);
  await click("Retry");
  expect(body().value).toBe("");
});
it("preserves an unsaved body across close and reopen after persistent write failure", async () => {
  await render();
  const original = invoke.getMockImplementation()!;
  invoke.mockImplementation((command, args) =>
    command === "notes_upsert" ? Promise.reject(new Error("Disk full")) : original(command, args),
  );
  await input(body(), "Irreplaceable draft");
  await act(async () => {
    body().focus();
    body().blur();
  });
  expect(container.textContent).toContain("Disk full");
  await act(async () => root.render(null));
  invoke.mockImplementation(original);
  await render();
  expect(body().value).toBe("Irreplaceable draft");
  await act(async () => {
    body().focus();
    body().blur();
  });
  expect(stored.find((note) => note.sourceSessionId === sessionId)?.body).toBe(
    "Irreplaceable draft",
  );
});
it("refreshes a clean editor when the same note changes externally", async () => {
  await render();
  const own = stored.find((note) => note.sourceSessionId === sessionId)!;
  stored = stored.map((note) =>
    note.id === own.id
      ? { ...note, title: "Updated title", body: "Updated in another window", updatedAt: 900 }
      : note,
  );
  invalidateNotes();
  await act(async () => {
    window.dispatchEvent(new Event("bycoda:notes-changed"));
  });
  expect(body().value).toBe("Updated in another window");
  expect(container.querySelector('button[aria-label="Note title: Updated title"]')).not.toBeNull();
});

it("preserves a dirty draft and requires explicit resolution of external updates", async () => {
  await render();
  await input(body(), "Local unsaved draft");
  const own = stored.find((note) => note.sourceSessionId === sessionId)!;
  stored = stored.map((note) =>
    note.id === own.id
      ? { ...note, title: "External title", body: "External body", updatedAt: 901 }
      : note,
  );
  invalidateNotes();
  await act(async () => {
    window.dispatchEvent(new Event("bycoda:notes-changed"));
  });
  expect(body().value).toBe("Local unsaved draft");
  expect(container.textContent).toContain("Your draft is preserved");
  await act(async () => {
    body().focus();
    body().blur();
  });
  expect(stored.find((note) => note.id === own.id)?.body).toBe("External body");
  await act(async () => root.render(null));
  await render();
  expect(body().value).toBe("Local unsaved draft");
  await click("Use saved version");
  expect(body().value).toBe("External body");
  expect(container.querySelector('button[aria-label="Note title: External title"]')).not.toBeNull();
});

it("isolates failed drafts across conversations", async () => {
  await render();
  const original = invoke.getMockImplementation()!;
  invoke.mockImplementation((command, args) =>
    command === "notes_upsert" &&
    args?.note?.id === stored.find((note) => note.sourceSessionId === sessionId)?.id
      ? Promise.reject(new Error("Disk full"))
      : original(command, args),
  );
  await input(body(), "Only the first session");
  await render(`${sessionId}-second`);
  expect(body().value).toBe("");
  await render();
  expect(body().value).toBe("Only the first session");
});

it("saves a preserved draft only after choosing Keep my draft", async () => {
  await render();
  await input(body(), "Keep this local body");
  const own = stored.find((note) => note.sourceSessionId === sessionId)!;
  stored = stored.map((note) =>
    note.id === own.id ? { ...note, body: "External body", updatedAt: 902 } : note,
  );
  invalidateNotes();
  await act(async () => {
    window.dispatchEvent(new Event("bycoda:notes-changed"));
  });
  expect(stored.find((note) => note.id === own.id)?.body).toBe("External body");
  await click("Keep my draft");
  expect(stored.find((note) => note.id === own.id)?.body).toBe("Keep this local body");
  await act(async () => root.render(null));
  await render();
  expect(body().value).toBe("Keep this local body");
  expect(container.textContent).not.toContain("Your draft is preserved");
});
