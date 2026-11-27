import { describe, expect, it, vi } from "vitest";
import { account, fixture, recipe } from "../social-browser-publishing-test-support";
import { youtubeDeleteStudioVideo, youtubeListStudioVideos } from "./youtube-video-management";

const channel = "UC" + "a".repeat(22);
const otherChannel = "UC" + "b".repeat(22);
const target = "abcdefghijk";
const otherVideo = "zyxwvutsrqp";
const origin = "https://studio.youtube.com";
const path = `/channel/${channel}/videos`;

function row(id: string, title: string) {
  return `<ytcp-video-row>
    <a id="video-title" href="/video/${id}/edit">${title}</a>
    <button aria-label="Options" data-id="${id}">Options</button>
  </ytcp-video-row>`;
}

function studio(
  options: {
    wrongChannel?: boolean;
    duplicate?: boolean;
    unchecked?: boolean;
    staleMenu?: boolean;
    silent?: boolean;
    remains?: boolean;
    unreadableReadback?: boolean;
  } = {},
) {
  const before = vi.fn(async () => {});
  const optionsFor = vi.fn();
  const submit = vi.fn();
  let removed = false;
  const f = fixture(
    recipe("youtube"),
    account("youtube", `web:youtube:${channel}`, "channel"),
    "",
    {
      render(url) {
        const pathname = new URL(url).pathname;
        const content =
          pathname === `${path}/upload`
            ? row(otherVideo, "Unrelated video")
            : pathname === `${path}/short` && !removed
              ? row(target, "Bycoda clip") + (options.duplicate ? row(target, "Duplicate") : "")
              : pathname === `${path}/short` && options.unreadableReadback
                ? row(otherVideo, "Other Short") +
                  "<ytcp-video-row>Unreadable draft</ytcp-video-row>"
                : "<ytcp-empty-state>No videos</ytcp-empty-state>";
        return `<ytcp-app><a id="channel-link" href="/channel/${options.wrongChannel ? otherChannel : channel}">Channel</a>${content}
        ${options.staleMenu ? '<ytcp-text-menu><button role="menuitem">Delete forever</button></ytcp-text-menu>' : ""}
        </ytcp-app>`;
      },
      click(element) {
        const button = element.getAttribute("data-bycoda-web-control");
        const body = f.window.document.body;
        switch (button) {
          case "youtube-video-options":
            optionsFor(element.getAttribute("data-id"));
            body.insertAdjacentHTML(
              "beforeend",
              '<ytcp-text-menu><button role="menuitem">Delete forever</button></ytcp-text-menu>',
            );
            break;
          case "youtube-video-delete-menu":
            body.insertAdjacentHTML(
              "beforeend",
              '<div role="dialog"><h2>Delete forever</h2><button role="checkbox" aria-checked="false">Deletion is permanent</button><button>Delete forever</button></div>',
            );
            break;
          case "youtube-video-delete-acknowledge":
            if (!options.unchecked) element.setAttribute("aria-checked", "true");
            break;
          case "youtube-video-delete-submit":
            submit();
            removed = !options.remains;
            if (!options.silent)
              body.insertAdjacentHTML("beforeend", '<div role="status">Video deleted</div>');
            break;
        }
      },
    },
  );
  return { ...f, ctx: { ...f.ctx, beforeYouTubeSubmission: before }, before, optionsFor, submit };
}

describe("YouTube Studio video management", () => {
  it("lists the verified channel's videos and Shorts using their exact IDs", async () => {
    const f = studio();
    await expect(youtubeListStudioVideos(f.ctx)).resolves.toEqual({
      items: [
        {
          id: otherVideo,
          title: "Unrelated video",
          url: `https://www.youtube.com/watch?v=${otherVideo}`,
        },
        { id: target, title: "Bycoda clip", url: `https://www.youtube.com/watch?v=${target}` },
      ],
    });
    expect(f.page.click).not.toHaveBeenCalled();
  });

  it("deletes only the requested Short and verifies the receipt and a fresh list", async () => {
    const f = studio();
    await expect(youtubeDeleteStudioVideo(f.ctx, target)).resolves.toEqual({
      id: target,
      deleted: true,
    });
    expect(f.optionsFor).toHaveBeenCalledExactlyOnceWith(target);
    expect(f.before).toHaveBeenCalledOnce();
    expect(f.submit).toHaveBeenCalledOnce();
    expect(f.page.goto).toHaveBeenLastCalledWith(`${origin}${path}/short`);
    expect(vi.mocked(f.before).mock.invocationCallOrder[0]).toBeLessThan(
      f.submit.mock.invocationCallOrder[0]!,
    );
  });

  it.each([
    [{ wrongChannel: true }, "denied"],
    [{ duplicate: true }, "unsupported"],
    [{ unchecked: true }, "denied"],
    [{ staleMenu: true }, "denied"],
  ] as const)("stops before submitting when Studio is unsafe (%j)", async (options, code) => {
    const f = studio(options);
    await expect(youtubeDeleteStudioVideo(f.ctx, target)).rejects.toMatchObject({ code });
    expect(f.before).not.toHaveBeenCalled();
    expect(f.submit).not.toHaveBeenCalled();
  });

  it.each([{ silent: true }, { remains: true }, { unreadableReadback: true }])(
    "holds a dispatched deletion without both confirmations (%j)",
    async (options) => {
      const f = studio(options);
      await expect(youtubeDeleteStudioVideo(f.ctx, target)).rejects.toMatchObject({
        code: "unknown",
      });
      expect(f.submit).toHaveBeenCalledOnce();
    },
  );

  it("does not dispatch after owner approval is revoked", async () => {
    const f = studio();
    f.before.mockRejectedValueOnce(new Error("Revoked"));
    await expect(youtubeDeleteStudioVideo(f.ctx, target)).rejects.toThrow("Revoked");
    expect(f.submit).not.toHaveBeenCalled();
  });
});
