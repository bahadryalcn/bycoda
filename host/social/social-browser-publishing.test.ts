import { expect, it } from "vitest";
import { linkedInCreatedId } from "./social-browser-publishing";
import { recipe } from "./social-browser-publishing-test-support";
it("does not advertise arbitrary DM initiation for publishing surfaces", () => {
  expect(recipe("linkedin").operations).toContain("message.start");
  expect(recipe("youtube").operations).not.toContain("message.reply");
  expect(recipe("tiktok").operations).not.toContain("message.start");
  expect(recipe("snapchat").operations).not.toContain("message.start");
  expect(
    linkedInCreatedId(JSON.stringify({ value: { entityUrn: "urn:li:person:123" } })),
  ).toBeUndefined();
});
