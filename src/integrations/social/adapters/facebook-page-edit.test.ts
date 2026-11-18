import { describe, expect, it, vi } from "vitest";
import { SocialHttp } from "../adapter";
import { parseFacebookPagePatch, updateFacebookPage } from "./facebook-page-edit";

describe("Facebook Page settings", () => {
  it.each([
    { name: "Only the browser supports Page names" },
    { about: "a".repeat(101) },
    { website: "https://user:secret@example.org" },
    { phone: "not-a-phone" },
    { emails: ["invalid"] },
    { coverPhotoId: "../other" },
    { hours: { mon_1_open: "09:30" } },
    { hours: { moon_1_open: "09:30", moon_1_close: "18:00" } },
  ])("rejects unsupported or malformed settings before dispatch (%j)", async (patch) => {
    const fetcher = vi.fn();
    await expect(
      updateFacebookPage(new SocialHttp(fetcher), "v25.0", "123", "secret", patch),
    ).rejects.toMatchObject({
      code: "rejected",
      detail: { reasonCode: "facebook.page_invalid_settings" },
    });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("allows field clearing and normalizes valid overnight and 24-hour ranges", () => {
    expect(
      parseFacebookPagePatch({
        about: "",
        emails: [],
        hours: {
          mon_1_open: "00:00",
          mon_1_close: "24:00",
          sat_1_open: "20:00",
          sat_1_close: "5:59",
        },
      }),
    ).toEqual({
      about: "",
      emails: [],
      hours: {
        mon_1_open: "00:00",
        mon_1_close: "24:00",
        sat_1_open: "20:00",
        sat_1_close: "05:59",
      },
    });
  });

  it("uses documented settings, cover and profile-picture endpoints on the selected Page", async () => {
    const fetcher = vi.fn(async () => Response.json({ success: true }));
    await expect(
      updateFacebookPage(new SocialHttp(fetcher), "v25.0", "123", "secret", {
        about: "About",
        coverPhotoId: "234",
        avatarPhotoId: "345",
      }),
    ).resolves.toEqual({ status: "updated", updated: ["about", "coverPhotoId", "avatarPhotoId"] });
    expect(fetcher).toHaveBeenNthCalledWith(
      1,
      "https://graph.facebook.com/v25.0/123",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          about: "About",
          cover: "234",
          no_feed_story: true,
          no_notification: true,
        }),
      }),
    );
    expect(fetcher).toHaveBeenNthCalledWith(
      2,
      "https://graph.facebook.com/v25.0/123/picture",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ photo: "345", suppress_stories: true }),
      }),
    );
  });

  it("reports an uncertain later write as partial without resubmitting either write", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ success: true }))
      .mockRejectedValueOnce(new Error("synthetic network failure"));
    await expect(
      updateFacebookPage(new SocialHttp(fetcher), "v25.0", "123", "secret", {
        website: "https://example.org",
        avatarPhotoId: "345",
      }),
    ).resolves.toMatchObject({
      status: "partial",
      updated: ["website"],
      unconfirmed: ["avatarPhotoId"],
      failure: { code: "unknown" },
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("stops after an unconfirmed first write", async () => {
    const fetcher = vi.fn(async () => Response.json({ success: false }));
    await expect(
      updateFacebookPage(new SocialHttp(fetcher), "v25.0", "123", "secret", {
        about: "About",
        avatarPhotoId: "345",
      }),
    ).rejects.toMatchObject({ code: "unknown" });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
