import { expect, it } from "vitest";
import { splitSessionTitle } from "./recordedSessionRows";

it("strips a harness prefix and lets it decide the provider", () => {
  expect(splitSessionTitle("codex · Session greeting", "claude")).toEqual({
    label: "Session greeting",
    provider: "codex",
  });
  expect(splitSessionTitle("claude · Fix bug", "claude")).toEqual({
    label: "Fix bug",
    provider: "claude",
  });
});

it("keeps titles whose prefix is not a harness", () => {
  expect(splitSessionTitle("Notes · draft", "claude")).toEqual({
    label: "Notes · draft",
    provider: "claude",
  });
  expect(splitSessionTitle("codex · ", "claude").label).toBe("codex · ");
});
