import { expect, it } from "vitest";
import { isConfigurationConflict } from "./configurationConflict";

const HOST_MESSAGE =
  "Configuration changed in another client. Reopen it before saving; your changes have not been saved.";

it("recognizes the Host's edit-conflict refusal, with or without its transport prefix", () => {
  expect(isConfigurationConflict(new Error(HOST_MESSAGE))).toBe(true);
  expect(isConfigurationConflict(new Error(`Host rejected request: ${HOST_MESSAGE}`))).toBe(true);
  expect(isConfigurationConflict(HOST_MESSAGE)).toBe(true);
});

it("does not treat other failures as a conflict", () => {
  expect(isConfigurationConflict(new Error("Request timed out"))).toBe(false);
  expect(isConfigurationConflict(new Error("This project already has a steward."))).toBe(false);
  expect(isConfigurationConflict(undefined)).toBe(false);
});
