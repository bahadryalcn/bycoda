import { describe, expect, it } from "vitest";
import { accountConnectionStatus } from "../../model/accountConnection";
import type { SocialAccount } from "../../model/social";

const NOW = Date.UTC(2026, 10, 7);
const account = (patch: Partial<SocialAccount> = {}) =>
  ({ id: "a1", platform: "x", connected: false, accessApproved: false, ...patch }) as SocialAccount;

describe("account connection status", () => {
  it("reports a connected account whose platform access is approved as connected", () => {
    expect(
      accountConnectionStatus(
        account({ connected: true, accessApproved: true }),
        undefined,
        undefined,
        NOW,
      ),
    ).toBe("Connected");
  });

  it("does not call a connected account usable before the platform access is approved", () => {
    expect(
      accountConnectionStatus(
        account({ connected: true, accessApproved: false }),
        undefined,
        undefined,
        NOW,
      ),
    ).toBe("Platform access approval required");
  });

  it("asks for a reconnection once the access has expired, even when it was approved", () => {
    expect(
      accountConnectionStatus(
        account({ connected: true, accessApproved: true, expiresAt: NOW - 1 }),
        undefined,
        undefined,
        NOW,
      ),
    ).toBe("Reconnection required");
  });

  it("keeps a saved account that is not connected from reading as connected", () => {
    expect(accountConnectionStatus(account(), undefined, undefined, NOW)).toBe(
      "Checking connection settings",
    );
    expect(accountConnectionStatus(account(), { configured: false }, undefined, NOW)).toBe(
      "Setup required",
    );
    expect(accountConnectionStatus(account(), { configured: true }, undefined, NOW)).toBe(
      "Ready to connect",
    );
  });

  it("follows an active flow only while the account is not connected", () => {
    const ready = { configured: true };
    expect(accountConnectionStatus(account(), ready, "waiting", NOW)).toBe(
      "Waiting for permission in the browser",
    );
    expect(accountConnectionStatus(account(), ready, "selection", NOW)).toBe(
      "Select the verified account",
    );
    expect(accountConnectionStatus(account(), ready, "failed", NOW)).toBe(
      "Connection needs a retry",
    );
    // A flow that reports waiting never overrides a connected account.
    expect(
      accountConnectionStatus(
        account({ connected: true, accessApproved: true }),
        ready,
        "waiting",
        NOW,
      ),
    ).toBe("Connected");
  });
});
