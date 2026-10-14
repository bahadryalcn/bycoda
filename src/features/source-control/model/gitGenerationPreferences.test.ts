// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it } from "vitest";
import { useGitGenerationChoice } from "../ui/GitGenerationSettings";
import {
  parseGitGenerationChoice,
  saveDefaultGitGenerationChoice,
} from "./gitGenerationPreferences";

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
let selection: ReturnType<typeof useGitGenerationChoice>;
const globalChoice = { harness: "codex" as const, model: "codex:gpt-6.1", modelSettings: {} };
const projectChoice = { harness: "claude" as const, model: "claude:sonnet-5", modelSettings: {} };

function Probe({ cwd }: { cwd: string }) {
  selection = useGitGenerationChoice(cwd);
  return null;
}

beforeEach(() => {
  localStorage.clear();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

it("updates mounted project selections when the global default changes and persists it", () => {
  act(() => root.render(createElement(Probe, { cwd: "/one" })));
  expect(selection[0]).toBeUndefined();
  act(() => saveDefaultGitGenerationChoice(globalChoice));
  expect(selection[0]?.harness).toBe("codex");
  expect(selection[2]).toBe(false);
  act(() => root.render(createElement(Probe, { cwd: "/two" })));
  expect(selection[0]?.harness).toBe("codex");
  expect(JSON.parse(localStorage.getItem("bycoda.gitGeneration.default.v1")!).harness).toBe(
    "codex",
  );
  act(() => saveDefaultGitGenerationChoice(undefined));
  expect(selection[0]).toBeUndefined();
});

it("preserves existing project overrides and returns to the global default on reset", () => {
  saveDefaultGitGenerationChoice(globalChoice);
  localStorage.setItem("bycoda.gitGeneration.v1:/one", JSON.stringify(projectChoice));
  act(() => root.render(createElement(Probe, { cwd: "/one" })));
  expect(selection[0]?.harness).toBe("claude");
  expect(selection[2]).toBe(true);
  act(() => saveDefaultGitGenerationChoice(undefined));
  expect(selection[0]?.harness).toBe("claude");
  act(() => saveDefaultGitGenerationChoice(globalChoice));
  act(() => selection[1](undefined));
  expect(selection[0]?.harness).toBe("codex");
  expect(selection[2]).toBe(false);
  expect(localStorage.getItem("bycoda.gitGeneration.v1:/one")).toBeNull();
});

it("ignores malformed and unsupported saved selections", () => {
  expect(parseGitGenerationChoice("broken")).toBeUndefined();
  expect(parseGitGenerationChoice('{"harness":"unknown","model":"x"}')).toBeUndefined();
  expect(parseGitGenerationChoice('{"harness":"codex"}')).toBeUndefined();
});
