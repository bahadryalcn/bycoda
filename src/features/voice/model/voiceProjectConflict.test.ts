import { expect, it } from "vitest";
import { projectNameTaken } from "./voiceProjectConflict";

it("offers to continue a listed project with the taken name", () => {
  const refusal = projectNameTaken("mini golf", "G:/Projects/mini-golf", [
    "G:\\Projects\\mini-golf",
  ]);
  expect(refusal.details).toMatchObject({
    reason: "name-taken",
    existingProjectPath: "G:\\Projects\\mini-golf",
    options: ["continue-existing-project", "create-with-another-name"],
  });
});

it("asks only for another name when the folder is not a project", () => {
  const refusal = projectNameTaken("x", "G:/Projects/x", ["G:/Projects/y"]);
  expect(refusal.details.existingProjectPath).toBeUndefined();
  expect(refusal.details.options).toEqual(["create-with-another-name"]);
});
