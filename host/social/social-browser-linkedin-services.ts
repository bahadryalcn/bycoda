import { SocialPlatformError } from "../../src/integrations/social/adapter";

export const LINKEDIN_PROFILE_OWNER_SECTIONS = [
  "photo",
  "banner",
  "experience",
  "links",
  "details",
  "services",
] as const;
export type LinkedInProfileOwnerSection = (typeof LINKEDIN_PROFILE_OWNER_SECTIONS)[number];

/**
 * Owner handoff for profile and Service Page controls without an automated recipe.
 * Use the verified account identity, never a URL or slug supplied by a tool caller.
 */
export function linkedInProfileDestination(
  platformId: string,
  section: LinkedInProfileOwnerSection,
) {
  if (!LINKEDIN_PROFILE_OWNER_SECTIONS.includes(section))
    throw new SocialPlatformError("unsupported");
  const member = /^web:linkedin:in:([\w-]{1,100})$/.exec(platformId)?.[1];
  const page =
    /^web:linkedin:company:([a-z0-9][a-z0-9-]{0,99})$/.exec(platformId)?.[1] ??
    /^urn:li:organization:([1-9]\d{0,24})$/.exec(platformId)?.[1];
  if (member && section !== "details")
    return { url: `https://www.linkedin.com/in/${member}/`, section, requiresOwner: true as const };
  if (
    page &&
    (section === "photo" || section === "banner" || section === "details" || section === "services")
  )
    return {
      url: `https://www.linkedin.com/company/${page}/admin/`,
      section,
      requiresOwner: true as const,
    };
  throw new SocialPlatformError("unsupported");
}
