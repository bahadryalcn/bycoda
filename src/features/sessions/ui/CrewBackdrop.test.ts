// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { CrewBackdrop, isReplyStreaming } from "./CrewBackdrop";
import type { Session } from "../model/session";
import { saveCrewSceneEnabled } from "../../settings/model/settings";

vi.mock("./CrewScene", () => ({
  CrewScene: ({ variant }: { variant: string }) => createElement("div", { "data-scene": variant }),
}));
let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.clear();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});
it("uses a background scene and responds to the shared setting without replacing the conversation", async () => {
  await act(async () =>
    root.render(
      createElement(
        "div",
        null,
        createElement(CrewBackdrop),
        createElement("textarea", { defaultValue: "draft" }),
      ),
    ),
  );
  const input = container.querySelector("textarea");
  expect(container.querySelector("[data-scene]")?.getAttribute("data-scene")).toBe("background");
  act(() => saveCrewSceneEnabled(false));
  expect(container.querySelector("[data-scene]")).toBeNull();
  expect(container.querySelector("textarea")).toBe(input);
  expect(input?.value).toBe("draft");
  act(() => saveCrewSceneEnabled(true));
  expect(container.querySelector("[data-scene]")).not.toBeNull();
});
it("does not mount decorative observers for an invisible session", () => {
  act(() => root.render(createElement(CrewBackdrop, { visible: false })));
  expect(container.querySelector("[data-scene]")).toBeNull();
});
it("treats only a busy session whose last assistant block streams as streaming", () => {
  const session = (busy: boolean, role: string, streaming: boolean) =>
    ({ busy, blocks: [{ role, streaming }] }) as unknown as Session;
  expect(isReplyStreaming(session(true, "assistant", true))).toBe(true);
  expect(isReplyStreaming(session(false, "assistant", true))).toBe(false);
  expect(isReplyStreaming(session(true, "tool", true))).toBe(false);
  expect(isReplyStreaming(session(true, "assistant", false))).toBe(false);
  expect(isReplyStreaming(undefined)).toBe(false);
});
