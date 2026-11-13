// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useGitGenerationChoice } from "../ui/GitGenerationSettings";
import { parseGitGenerationChoice } from "./gitGenerationPreferences";

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
let selection: ReturnType<typeof useGitGenerationChoice>;
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

it("preserves project overrides and clears them on reset", () => {
  localStorage.setItem("bycoda.gitGeneration.v1:/one", JSON.stringify(projectChoice));
  act(() => root.render(createElement(Probe, { cwd: "/one" })));
  expect(selection[0]?.harness).toBe("claude");
  expect(selection[2]).toBe(true);
  expect(selection[0]?.harness).toBe("claude");
  act(() => selection[1](undefined));
  expect(selection[0]).toBeUndefined();
  expect(selection[2]).toBe(false);
  expect(localStorage.getItem("bycoda.gitGeneration.v1:/one")).toBeNull();
});

it("ignores malformed and unsupported saved selections", () => {
  expect(parseGitGenerationChoice("broken")).toBeUndefined();
  expect(parseGitGenerationChoice('{"harness":"unknown","model":"x"}')).toBeUndefined();
  expect(parseGitGenerationChoice('{"harness":"codex"}')).toBeUndefined();
});

const routing = vi.hoisted(() => ({ resolve: vi.fn() }));
vi.mock("../../model-routing/public/helpers", async (original) => ({
  ...(await original<typeof import("../../model-routing/public/helpers")>()),
  resolveHelperModel: routing.resolve,
}));
import { resolveGitGenerationChoice } from "./gitGenerationPreferences";
it("uses bound git role and preserves account identity", async () => {
  const target = {
    harness: "codex" as const,
    model: "role-model",
    providerAccountId: "role-account",
    modelSettings: { effort: "low" },
  };
  routing.resolve.mockResolvedValueOnce(target);
  expect(await resolveGitGenerationChoice()).toEqual(target);
  expect(routing.resolve).toHaveBeenCalledWith("text.git", { cwd: undefined });
});

it("keeps project overrides when routing is unavailable", async () => {
  routing.resolve.mockResolvedValueOnce(undefined);
  expect(await resolveGitGenerationChoice(projectChoice)).toEqual(projectChoice);
});
