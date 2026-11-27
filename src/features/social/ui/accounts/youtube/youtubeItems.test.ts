import { describe, expect, it } from "vitest";
import { withDefaults } from "./YouTubeFormFields";
import { listRows, rowSummary } from "./YouTubeResult";
import {
  isBrowseForm,
  youtubeForms,
  youtubeRefSource,
  youtubeViewForms,
  youtubeViews,
} from "./youtubeForms";
import { youtubeChanged, youtubePick, youtubePrefill, youtubeRefOptions } from "./youtubeItems";

describe("YouTube list picking", () => {
  it("fills the video id and opens the video edit task", () => {
    expect(
      youtubePick("videos", "videos", {}, { id: "v1", title: "Summer release", privacy: "public" }),
    ).toEqual({
      values: { videoId: "v1" },
      action: "youtube.video.update",
      baseline: { title: "Summer release", privacy: "public" },
      title: "Summer release",
    });
  });

  it("prefills the video edit form from the row, including tags and flags", () => {
    expect(
      youtubePrefill("youtube.video.update", {
        id: "v1",
        title: "Summer release",
        description: "",
        privacy: "unlisted",
        categoryId: "22",
        tags: ["a", "b", 3],
        madeForKids: false,
        publishAt: "2026-12-01T10:00:00Z",
      }),
    ).toEqual({
      title: "Summer release",
      description: "",
      privacy: "unlisted",
      categoryId: "22",
      tags: "a\nb",
      madeForKids: "false",
    });
  });

  it("prefills the playlist and channel edit forms and ignores other actions", () => {
    expect(
      youtubePrefill("youtube.playlist.update", {
        id: "pl1",
        title: "Shorts",
        description: "All shorts",
        privacy: "private",
      }),
    ).toEqual({
      title: "Shorts",
      description: "All shorts",
      privacy: "private",
    });
    expect(
      youtubePrefill("youtube.channel.update", {
        name: "Fixture",
        description: "About",
        keywords: "a b",
        country: "TR",
        madeForKids: true,
      }),
    ).toEqual({
      description: "About",
      keywords: "a b",
      country: "TR",
      madeForKids: "true",
    });
    expect(youtubePrefill("youtube.comment.moderate", { title: "x" })).toEqual({});
  });

  it("sends only the prefilled values the owner changed", () => {
    expect(
      youtubeChanged(
        {
          videoId: "v1",
          title: "Summer release",
          description: "New notes",
          privacy: "public",
        },
        {
          title: "Summer release",
          description: "Old notes",
          privacy: "public",
        },
      ),
    ).toEqual({ videoId: "v1", description: "New notes" });
  });

  it("drills into a playlist, then picks one of its items", () => {
    const playlist = youtubePick("videos", "playlists", {}, { id: "pl1", title: "Shorts" });
    expect(playlist?.values).toEqual({ playlistId: "pl1" });
    expect(playlist?.action).toBe("youtube.playlist.update");
    const item = youtubePick(
      "videos",
      "playlists",
      { playlistId: "pl1" },
      { id: "it1", title: "A" },
    );
    expect(item?.values).toEqual({ playlistItemId: "it1" });
    expect(item?.action).toBe("youtube.playlist.move");
  });

  it("copies the post text and state of a Community post", () => {
    expect(
      youtubePick("community", undefined, {}, { id: "p1", text: "Hello", status: "scheduled" }),
    ).toMatchObject({
      values: { postId: "p1", editedText: "Hello", status: "scheduled" },
      action: "youtube.community.edit",
    });
  });

  it("uses the channel id of a subscription and the author of a chat message", () => {
    expect(
      youtubePick("subscriptions", undefined, {}, { id: "s1", channelId: "UC1", title: "Fan" })
        ?.values,
    ).toEqual({ targetChannelId: "UC1" });
    expect(
      youtubePick("live", "chat", {}, { id: "m1", authorChannelId: "UC2", text: "Hi" })?.values,
    ).toEqual({ messageId: "m1", channelId: "UC2" });
  });

  it("ignores rows without an id and views that only inform", () => {
    expect(youtubePick("videos", "videos", {}, { title: "No id" })).toBeUndefined();
    expect(youtubePick("live", "superchats", {}, { id: "x" })).toBeUndefined();
  });

  it("offers the current value even when the list does not contain it", () => {
    const rows = [{ id: "a", title: "Alpha" }, { id: "b" }];
    expect(youtubeRefOptions(rows, "typed")).toEqual([
      { value: "typed", label: "typed" },
      { value: "a", label: "Alpha" },
      { value: "b", label: "b" },
    ]);
    expect(youtubeRefOptions(undefined, "")).toEqual([]);
  });

  it("finds the list that feeds an identifier and waits for its parent", () => {
    expect(youtubeRefSource("videoId", {})?.action).toBe("youtube.videos.list");
    expect(youtubeRefSource("playlistItemId", {})).toBeUndefined();
    expect(youtubeRefSource("playlistItemId", { playlistId: "pl1" })).toEqual({
      action: "youtube.playlists.list",
      input: { playlistId: "pl1" },
    });
    expect(youtubeRefSource("messageId", { broadcastId: "b1" })?.action).toBe(
      "youtube.liveChat.list",
    );
    expect(youtubeRefSource("commentId", {})).toBeUndefined();
  });

  it("reads list results and summarizes rows without raw ids as the headline", () => {
    expect(listRows({ comments: [{ id: "c1" }, 3] })).toEqual([{ id: "c1" }]);
    expect(listRows({ status: "ok" })).toBeUndefined();
    expect(rowSummary({ id: "c1", text: "Great video", authorName: "Ada" })).toEqual({
      title: "Great video",
      meta: ["Ada"],
    });
    expect(rowSummary({ id: "only-id" }).title).toBe("only-id");
  });
});

describe("YouTube section structure", () => {
  it("splits video and live sections into views with their own forms", () => {
    expect(youtubeViews("videos").map(({ value }) => value)).toEqual(["videos", "playlists"]);
    expect(youtubeViews("videos", true)).toEqual([]);
    expect(youtubeViewForms("videos", true, "videos").map(({ action }) => action)).toEqual([
      "youtube.videos.list",
      "youtube.video.delete",
    ]);
    expect(youtubeViews("live").map(({ value }) => value)).toEqual([
      "broadcasts",
      "chat",
      "superchats",
    ]);
    expect(youtubeViews("comments")).toEqual([]);
    const playlistForms = youtubeViewForms("videos", false, "playlists");
    expect(playlistForms.every(({ action }) => action.startsWith("youtube.playlist"))).toBe(true);
    expect(playlistForms.filter(isBrowseForm).map(({ action }) => action)).toEqual([
      "youtube.playlists.list",
    ]);
  });

  it("opens reads and reports on their first choice but makes writes choose", () => {
    const [list] = youtubeForms("subscriptions", false);
    expect(withDefaults(list!, {}).direction).toBe("outgoing");
    const moderate = youtubeForms("comments", false).find(
      ({ action }) => action === "youtube.comment.moderate",
    )!;
    expect(withDefaults(moderate, {}).status).toBeUndefined();
  });
});
