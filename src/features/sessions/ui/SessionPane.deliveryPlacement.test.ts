import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

it("keeps the delivery notice in flow above the transcript and its Find overlay", () => {
  const pane = readFileSync(new URL("./SessionPane.tsx", import.meta.url), "utf8");
  const notice = readFileSync(new URL("./DeliveryProgressNotice.tsx", import.meta.url), "utf8");
  const paneBody = pane.slice(pane.indexOf("<div data-session-body"));
  expect(paneBody.indexOf("!reviewInQueue")).toBeGreaterThan(0);
  expect(paneBody.indexOf("<DeliveryProgressNotice")).toBeLessThan(
    paneBody.indexOf("ref={transcriptScope}"),
  );
  const slot = notice.match(/<div className="([^"]+)" data-delivery-notice-slot>/)?.[1];
  expect(slot).toContain("shrink-0");
  expect(slot).not.toMatch(/\b(?:absolute|fixed)\b/);
});
