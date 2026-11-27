import { expect, it } from "vitest";
import { traceName } from "./tracedInvoke";

it("names the operation of a multiplexing request so a failure can be attributed", () => {
  expect(
    traceName("social.request", { params: { action: "browser.needsHuman.list", input: {} } }),
  ).toBe("social.request:browser.needsHuman.list");
  expect(traceName("workspace.run", { params: { command: "git_status", cwd: "C:/x" } })).toBe(
    "workspace.run:git_status",
  );
});

it("keeps only the method for other requests and for operation values that are not names", () => {
  expect(traceName("sessions.list", { params: { action: "x" } })).toBe("sessions.list");
  expect(traceName("social.request", { params: { action: "C:/Users/someone/secret" } })).toBe(
    "social.request",
  );
  expect(traceName("social.request", { params: { action: 3 } })).toBe("social.request");
  expect(traceName("social.request", {})).toBe("social.request");
});
