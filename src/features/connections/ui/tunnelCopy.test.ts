import { expect, it } from "vitest";
import { issueCopy } from "./tunnelCopy";

it("names the sharing computer in machine-specific tunnel failures when it is another one", () => {
  expect(issueCopy("cli-missing")).toBe("The tunnel CLI is missing on this computer.");
  expect(issueCopy("cli-missing", "Home Mac")).toBe("The tunnel CLI is missing on Home Mac.");
  expect(issueCopy("origin-unreachable", "Home Mac")).toBe(
    "The local service is not listening on Home Mac.",
  );
  expect(issueCopy("approval-required", "Home Mac")).toBe(
    "Tailscale Funnel is not enabled for Home Mac yet.",
  );
  expect(issueCopy("host-update", "Home Mac")).toBe(
    "Update bycoda Host on Home Mac to manage external tunnels.",
  );
  // Failures that are not about a machine read the same everywhere.
  expect(issueCopy("startup-timeout", "Home Mac")).toBe(issueCopy("startup-timeout"));
});
