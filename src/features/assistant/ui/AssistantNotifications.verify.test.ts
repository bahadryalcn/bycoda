import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

const source = readFileSync(new URL("./AssistantNotifications.tsx", import.meta.url), "utf8");

// #316: re-verifying a notification before delivery reads the cached snapshot instead of
// requesting a 100-item snapshot from the Host per notification.
it("verifies a notification against the cached snapshot, not a Host snapshot request", () => {
  expect(source).toContain(
    "current: async (id) => currentNotification(latestAssistantSnapshot(), id)",
  );
  expect(source).not.toMatch(/op:\s*"snapshot"/);
  expect(source).not.toContain("limit: 100");
});
