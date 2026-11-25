import { describe, expect, it, vi } from "vitest";
import { SocialPlatformError } from "../../src/integrations/social/adapter";
import { readLinkedInBrowserProfileAnalytics } from "./social-browser-linkedin-analytics";
import { linkedinBrowserRecipe } from "./social-browser-linkedin";
import { account, fixture } from "./social-browser-publishing-test-support";

const member = account("linkedin", "web:linkedin:in:bycoda-owner");
const identity = `<div class="feed-identity-module__actor-meta"><a href="/in/bycoda-owner/">Owner</a></div>`;
const analytics = (heading: string, rows: string) =>
  `${identity}<main><section><h2>${heading}</h2>${rows}</section></main>`;

describe("LinkedIn browser profile analytics", () => {
  it("reads only visible summary labels from the connected member’s own profile", async () => {
    const f = fixture(
      linkedinBrowserRecipe,
      member,
      analytics(
        "Analytics",
        `
      <p hidden>9 profile views</p>
      <a href="/analytics/profile-views/"><strong>1,202</strong> profile views</a>
      <a href="/analytics/search-appearances/" aria-label="0 search appearances">See details</a>
      <p>250 post impressions</p>
      <p>Someone else viewed your profile</p>
    `,
      ),
    );
    await expect(readLinkedInBrowserProfileAnalytics(f.ctx)).resolves.toEqual({
      source: "browser",
      metrics: { profileViews: 1202, searchAppearances: 0 },
    });
    expect(f.page.goto).toHaveBeenCalledWith("https://www.linkedin.com/in/bycoda-owner/");
    expect(f.ctx.verifyIdentity).toHaveBeenCalledTimes(2);
    expect(f.ctx.markSubmitted).not.toHaveBeenCalled();
    expect(f.page.click).not.toHaveBeenCalled();
    expect(f.page.fill).not.toHaveBeenCalled();
    expect(f.page.cookies).not.toHaveBeenCalled();
  });

  it("accepts Turkish grouping and preserves the separate profile-appearance metric", async () => {
    const f = fixture(
      linkedinBrowserRecipe,
      member,
      analytics(
        "Analizler",
        `
      <p>1.250 profil görüntülemesi</p>
      <p>52 profil görünümü</p>
    `,
      ),
    );
    await expect(readLinkedInBrowserProfileAnalytics(f.ctx)).resolves.toMatchObject({
      metrics: { profileViews: 1250, profileAppearances: 52 },
    });
  });

  it("requires a known analytics section and consistent counts", async () => {
    const zero = fixture(
      linkedinBrowserRecipe,
      member,
      analytics("Analytics", `<p>0 profile views</p>`),
    );
    await expect(readLinkedInBrowserProfileAnalytics(zero.ctx)).resolves.toMatchObject({
      metrics: { profileViews: 0 },
    });
    for (const html of [
      analytics("Activity", `<p>100 profile views</p>`),
      analytics("Analytics", `<p>5 profile views</p><p>6 profile views</p>`),
      analytics("Analytics", `<p>1.2K profile views</p>`),
    ]) {
      const f = fixture(linkedinBrowserRecipe, member, html);
      await expect(readLinkedInBrowserProfileAnalytics(f.ctx)).rejects.toMatchObject({
        code: "needs_human",
      });
      expect(f.page.click).not.toHaveBeenCalled();
    }
  });

  it("never returns counts from a redirected profile or a changed identity", async () => {
    const redirected = fixture(
      linkedinBrowserRecipe,
      member,
      analytics("Analytics", `<p>2 profile views</p>`),
    );
    vi.mocked(redirected.page.goto).mockImplementationOnce(async () => {
      redirected.window.location.href = "https://www.linkedin.com/in/someone-else/";
    });
    await expect(readLinkedInBrowserProfileAnalytics(redirected.ctx)).rejects.toMatchObject({
      code: "needs_human",
    });
    const changed = fixture(
      linkedinBrowserRecipe,
      member,
      analytics("Analytics", `<p>2 profile views</p>`),
    );
    vi.mocked(changed.ctx.verifyIdentity)
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new SocialPlatformError("denied"));
    await expect(readLinkedInBrowserProfileAnalytics(changed.ctx)).rejects.toMatchObject({
      code: "denied",
    });
  });

  it("stops before checking identity on a verification screen", async () => {
    const f = fixture(
      linkedinBrowserRecipe,
      member,
      `<main><input autocomplete="one-time-code"></main>`,
    );
    await expect(readLinkedInBrowserProfileAnalytics(f.ctx)).rejects.toMatchObject({
      code: "needs_human",
    });
    expect(f.ctx.verifyIdentity).not.toHaveBeenCalled();
    expect(f.page.click).not.toHaveBeenCalled();
    expect(f.page.fill).not.toHaveBeenCalled();
  });
});
