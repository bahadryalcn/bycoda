import { describe, expect, it } from "vitest";
import { oauthPage } from "./page";

describe("oauthPage", () => {
  it("is self-contained for every kind", () => {
    for (const kind of ["success", "failure", "cancelled", "invalid"] as const) {
      const page = oauthPage(kind, undefined);
      for (const forbidden of ["http:", "https:", "<script", "src=", "href=", "url(", "@import"]) {
        expect(page).not.toContain(forbidden);
      }
      expect(page).toContain("<svg");
    }
  });

  it("follows the most preferred Accept-Language", () => {
    expect(oauthPage("success", "tr-TR,tr;q=0.9,en;q=0.8")).toContain("Oturum açıldı");
    expect(oauthPage("success", "en-US,tr;q=0.9")).toContain("You're signed in");
  });
});
