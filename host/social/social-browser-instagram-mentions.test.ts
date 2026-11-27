import { expect, it, vi } from "vitest";
import { instagramBrowserMentions } from "./social-browser-instagram-mentions";
import { metaBrowserRecipes } from "./social-browser-meta";
import { account, fixture } from "./social-browser-publishing-test-support";

const control = '<nav><button aria-label="Notifications">Activity</button></nav>';
const instagram = metaBrowserRecipes.find((recipe) => recipe.platform === "instagram")!;
const signedIn = () => account("instagram", "123", "business");

it("reads visible mentions and excludes unrelated and cross-origin notifications", async () => {
  const f = fixture(instagram, signedIn(), control, {
    click() {
      f.window.document.body.innerHTML = `
        <aside aria-label="Notifications">
          <ul>
            <li><a href="/ada/">ada</a> mentioned you in a comment
                <a href="/p/Fit-123/?comment_id=42">View</a>
                <time datetime="2026-11-18T09:00:00Z"></time></li>
            <li>grace liked your photo <a href="/p/like123/">View</a></li>
            <li>mallory mentioned you <a href="https://elsewhere.example/p/demo/">View</a></li>
          </ul>
        </aside>`;
    },
  });
  f.ctx.verifyIdentity = vi.fn(async () => {});
  await expect(instagramBrowserMentions(f.ctx)).resolves.toEqual({
    coverage: "visible_notifications",
    mentions: [
      {
        url: "https://www.instagram.com/p/Fit-123/",
        username: "ada",
        text: "ada mentioned you in a comment View",
        at: Date.parse("2026-11-18T09:00:00Z"),
      },
    ],
  });
  expect(f.page.click).toHaveBeenCalledOnce();
  expect(f.page.fill).not.toHaveBeenCalled();
  expect(f.ctx.verifyIdentity).toHaveBeenCalledTimes(3);
});

it("stops for a verification code before opening notifications", async () => {
  const f = fixture(instagram, signedIn(), `${control}<input autocomplete="one-time-code">`);
  await expect(instagramBrowserMentions(f.ctx)).rejects.toMatchObject({ code: "needs_human" });
  expect(f.page.click).not.toHaveBeenCalled();
  expect(f.page.fill).not.toHaveBeenCalled();
});
