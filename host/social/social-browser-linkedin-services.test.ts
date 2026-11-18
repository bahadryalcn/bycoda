import { expect, it } from "vitest";
import { linkedInProfileDestination } from "./social-browser-linkedin-services";

it("points to the exact account for owner-managed profile, Page and Services edits", () => {
  expect(linkedInProfileDestination("web:linkedin:in:owner", "experience")).toMatchObject({
    url: "https://www.linkedin.com/in/owner/",
    section: "experience",
    requiresOwner: true,
  });
  expect(linkedInProfileDestination("web:linkedin:company:145372363", "services")).toMatchObject({
    url: "https://www.linkedin.com/company/145372363/admin/",
    section: "services",
    requiresOwner: true,
  });
  expect(linkedInProfileDestination("urn:li:organization:145372363", "details").url).toBe(
    "https://www.linkedin.com/company/145372363/admin/",
  );
  expect(linkedInProfileDestination("web:linkedin:company:bycoda-inc", "details").url).toBe(
    "https://www.linkedin.com/company/bycoda-inc/admin/",
  );
});

it("denies injected targets and sections that the account type cannot own", () => {
  for (const [id, section] of [
    ["web:linkedin:in:owner/?steal=1", "links"],
    ["urn:li:person:owner", "services"],
    ["web:linkedin:in:owner", "details"],
    ["web:linkedin:company:145372363", "experience"],
  ] as const)
    expect(() => linkedInProfileDestination(id, section)).toThrow();
});
