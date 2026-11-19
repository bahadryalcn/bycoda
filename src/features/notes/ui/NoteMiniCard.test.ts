// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { projectKey } from "../../../shared/lib/paths";
import type { NoteCardMeta } from "../notes";
import { NoteMiniCard } from "./NoteMiniCard";
import { saveTabGroupCustomColor, saveTabGroupMascot } from "../../workspace/model/tabGroups";

// #1188: a note card must follow mascot and color changes saved elsewhere while it stays mounted.
const invoke = vi.hoisted(() => vi.fn());
const mascotCalls = vi.hoisted(() => [] as { name: string | null; color: string | undefined }[]);
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
vi.mock("../../projects/ui/ProjectMascot", () => ({
  ProjectMascot: ({ name, color }: { name: string | null; color?: string }) => {
    mascotCalls.push({ name, color });
    return null;
  },
}));

const cwd = "/work/p";
const card: NoteCardMeta = { id: "n1", slug: "plan", title: "Plan", sourceCwd: cwd };

beforeEach(() => {
  localStorage.clear();
  invoke.mockReset();
  invoke.mockResolvedValue(null);
  mascotCalls.length = 0;
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
});
afterEach(() => vi.unstubAllGlobals());

it("re-renders the mounted card when its mascot or custom color is saved elsewhere", async () => {
  const root = createRoot(document.createElement("div"));
  await act(async () => root.render(createElement(NoteMiniCard, { card })));
  const last = () => mascotCalls[mascotCalls.length - 1];
  expect(last().name).toBeNull();

  act(() => {
    saveTabGroupMascot(projectKey(cwd), "fox");
  });
  expect(last().name).toBe("fox");

  act(() => {
    saveTabGroupCustomColor(projectKey(cwd), "#112233");
  });
  expect(last().color).toBe("#112233");

  act(() => root.unmount());
});
