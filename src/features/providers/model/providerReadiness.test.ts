import { expect, it } from "vitest";
import { providerReadiness } from "./providerReadiness";

const verified = {
  available: true,
  availabilityChecked: true,
  checking: false,
  status: "ok" as const,
  auth: "ready" as const,
};

it("requires current successful provider evidence in addition to CLI discovery", () => {
  expect(providerReadiness(verified)).toBe("ready");
  expect(providerReadiness({ ...verified, status: undefined, auth: undefined })).toBe("unknown");
});

it("clears ready after refresh failure even when last quota windows and auth are retained", () => {
  expect(providerReadiness({ ...verified, status: "error" })).toBe("unknown");
  expect(providerReadiness({ ...verified, status: "unavailable" })).toBe("unknown");
  expect(providerReadiness({ ...verified, status: "fetching" })).toBe("checking");
});

it("keeps observed missing CLI and exhausted provider unavailable", () => {
  expect(providerReadiness({ ...verified, available: false })).toBe("unavailable");
  expect(providerReadiness({ ...verified, auth: "exhausted" })).toBe("unavailable");
});
