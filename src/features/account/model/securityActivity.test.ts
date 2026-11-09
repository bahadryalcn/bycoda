import { SECURITY_ACTIVITY_KINDS } from "@bycoda/account-contracts";
import { describe, expect, it } from "vitest";
import {
  countryName,
  securityEventMeta,
  securityEventTitle,
  securityEventTone,
} from "./securityActivity";

describe("security activity labels", () => {
  it("names every event kind", () => {
    for (const kind of SECURITY_ACTIVITY_KINDS) expect(securityEventTitle(kind)).toBeTruthy();
  });

  it("joins device, client and country and skips what is missing", () => {
    expect(
      securityEventMeta(
        {
          at: "2026-11-09T10:00:00.000Z",
          kind: "session_started",
          device: { id: "d1", name: "BAB" },
          client: "desktop",
          country: "TR",
        },
        "en",
      ),
    ).toBe("BAB · Desktop app · Türkiye");
    expect(
      securityEventMeta(
        {
          at: "2026-11-09T10:00:00.000Z",
          kind: "export_requested",
          device: null,
          client: null,
          country: null,
        },
        "en",
      ),
    ).toBe("");
  });

  it("falls back to the code for an unknown region and marks removals as danger", () => {
    expect(countryName("ZZ", "en")).toBeTruthy();
    expect(securityEventTone("deletion_requested")).toBe("danger");
    expect(securityEventTone("session_started")).toBe("neutral");
  });
});
