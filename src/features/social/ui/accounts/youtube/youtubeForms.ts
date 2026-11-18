import { t } from "../../../../../shared/i18n";
import type { SocialOperation } from "../../../model/social";

export type YouTubeSection =
  | "channel"
  | "videos"
  | "comments"
  | "community"
  | "subscriptions"
  | "analytics"
  | "live"
  | "review";
type FieldType =
  | "text"
  | "textarea"
  | "number"
  | "date"
  | "datetime"
  | "images"
  | "lines"
  | "links";
export type YouTubeFormField = {
  key: string;
  label: string;
  type?: FieldType;
  required?: boolean;
  emptyAllowed?: boolean;
  choices?: { value: string; label: string }[];
  multiple?: boolean;
  whenKind?: "image" | "poll";
  /** Label of the manual identifier input when `label` names what the identifier points to. */
  idLabel?: string;
  /** Rarely needed; shown inside a closed "More options" group. */
  advanced?: boolean;
  description?: string;
};
export type YouTubeForm = {
  action: string;
  label: string;
  fields?: YouTubeFormField[];
  capability?: SocialOperation;
  write?: boolean;
  danger?: boolean;
  fieldsInPatch?: string[];
  fixed?: Record<string, unknown>;
};

export function youtubeSections(browser: boolean) {
  return [
    { value: "channel", label: t("Channel profile") },
    ...(!browser ? [{ value: "videos", label: t("Videos and playlists") }] : []),
    { value: "comments", label: t("Comments") },
    ...(browser ? [{ value: "community", label: t("Community posts") }] : []),
    ...(!browser ? [{ value: "subscriptions", label: t("Subscriptions") }] : []),
    { value: "analytics", label: t("Analytics") },
    ...(!browser ? [{ value: "live", label: t("Live broadcasts") }] : []),
    { value: "review", label: t("Review") },
  ];
}

export function youtubeForms(section: YouTubeSection, browser: boolean): YouTubeForm[] {
  const field = (
    key: string,
    label: string,
    type?: FieldType,
    required = false,
  ): YouTubeFormField => ({ key, label, type, required });
  const choice = (
    key: string,
    label: string,
    options: string[][],
    required = true,
  ): YouTubeFormField => ({
    ...field(key, label, undefined, required),
    choices: options.map(([value, label]) => ({ value: value!, label: label! })),
  });
  const named = (key: string, label: string, idLabel: string): YouTubeFormField => ({
    ...field(key, label, "text", true),
    idLabel,
  });
  const videoId = named("videoId", t("Video"), t("Video ID"));
  const playlistId = named("playlistId", t("Playlist"), t("Playlist ID"));
  const playlistItemId = named("playlistItemId", t("Playlist item"), t("Playlist item ID"));
  const commentId = field("commentId", t("Comment ID"), "text", true);
  const broadcastId = named("broadcastId", t("Broadcast"), t("Broadcast ID"));
  const channelId = (key: string) => field(key, t("Channel ID"), "text", true);
  const title = (required = false) => field("title", t("Title"), "text", required);
  const description = { ...field("description", t("Description"), "textarea"), emptyAllowed: true };
  const privacy = (required = false) =>
    choice(
      "privacy",
      t("Privacy"),
      [
        ["private", t("Private")],
        ["unlisted", t("Unlisted")],
        ["public", t("Public")],
      ],
      required,
    );
  const yesNo = (key: string, label: string, required = false) =>
    choice(
      key,
      label,
      [
        ["true", t("Yes")],
        ["false", t("No")],
      ],
      required,
    );
  const later = (item: YouTubeFormField): YouTubeFormField => ({ ...item, advanced: true });
  const madeForKids = (required = false) => yesNo("madeForKids", t("Made for kids"), required);
  const update = (
    action: string,
    label: string,
    capability: SocialOperation,
    fields: YouTubeFormField[],
    options: Partial<YouTubeForm> = {},
  ): YouTubeForm => ({ action, label, capability, fields, write: true, ...options });
  const remove = (
    action: string,
    label: string,
    capability: SocialOperation,
    fields: YouTubeFormField[],
  ): YouTubeForm =>
    update(action, label, capability, fields, { danger: true, fixed: { confirm: true } });
  switch (section) {
    case "channel":
      return [
        { action: "youtube.channel.read", label: t("Load channel") },
        browser
          ? update(
              "youtube.channel.update",
              t("Edit channel profile"),
              "channel.profile.update",
              [
                field("name", t("Name")),
                field("handle", t("Handle")),
                field("avatarUploadId", t("Avatar"), "images"),
                {
                  ...field("links", t("Links"), "links"),
                  description: t("One link per line in Name | https://example.com format."),
                },
              ],
              {
                fieldsInPatch: ["name", "handle", "avatarUploadId", "links"],
                fixed: { confirm: true },
              },
            )
          : update(
              "youtube.channel.update",
              t("Edit channel profile"),
              "channel.profile.update",
              [
                description,
                later({ ...field("keywords", t("Keywords")), emptyAllowed: true }),
                later(field("country", t("Country code"))),
                field("bannerUploadId", t("Banner"), "images"),
                later(madeForKids()),
              ],
              {
                fieldsInPatch: [
                  "description",
                  "keywords",
                  "country",
                  "bannerUploadId",
                  "madeForKids",
                ],
                fixed: { confirm: true },
              },
            ),
      ];
    case "videos":
      return [
        { action: "youtube.videos.list", label: t("List videos") },
        update(
          "youtube.video.update",
          t("Edit video"),
          "video.update",
          [
            videoId,
            title(),
            description,
            privacy(),
            later(field("publishAt", t("Publish time"), "datetime")),
            later(field("categoryId", t("Category ID"))),
            later(field("tags", t("Tags"), "lines")),
            later(madeForKids()),
            later(yesNo("containsSyntheticMedia", t("Contains altered or synthetic content"))),
          ],
          {
            fieldsInPatch: [
              "title",
              "description",
              "privacy",
              "publishAt",
              "categoryId",
              "tags",
              "madeForKids",
              "containsSyntheticMedia",
            ],
          },
        ),
        update("youtube.thumbnail.set", t("Set thumbnail"), "thumbnail.set", [
          videoId,
          field("uploadId", t("Thumbnail"), "images", true),
        ]),
        remove("youtube.video.delete", t("Delete video"), "delete", [videoId]),
        {
          action: "youtube.playlists.list",
          label: t("List playlists"),
          fields: [{ ...playlistId, required: false }],
        },
        update("youtube.playlist.create", t("Create playlist"), "playlists.manage", [
          title(true),
          description,
          privacy(),
        ]),
        update(
          "youtube.playlist.update",
          t("Edit playlist"),
          "playlists.manage",
          [playlistId, title(), description, privacy()],
          { fieldsInPatch: ["title", "description", "privacy"] },
        ),
        update("youtube.playlist.add", t("Add video to playlist"), "playlists.manage", [
          playlistId,
          videoId,
        ]),
        update(
          "youtube.playlist.remove",
          t("Remove video from playlist"),
          "playlists.manage",
          [playlistId, playlistItemId],
          { danger: true },
        ),
        update("youtube.playlist.move", t("Move playlist item"), "playlists.manage", [
          playlistId,
          playlistItemId,
          field("position", t("Position"), "number", true),
        ]),
        remove("youtube.playlist.delete", t("Delete playlist"), "playlists.manage", [playlistId]),
      ];
    case "comments":
      return browser
        ? [
            update("youtube.comment.react", t("React to comment"), "comment.react", [
              commentId,
              videoId,
              channelId("authorChannelId"),
              choice("reaction", t("Reaction"), [
                ["like", t("Like")],
                ["heart", t("Heart")],
              ]),
              yesNo("enabled", t("Enabled"), true),
            ]),
          ]
        : [
            {
              action: "youtube.comments.list",
              label: t("List comments"),
              fields: [
                { ...videoId, required: false },
                field("parentId", t("Parent comment ID")),
                choice(
                  "moderationStatus",
                  t("Status"),
                  [
                    ["published", t("Published")],
                    ["heldForReview", t("Held for review")],
                    ["likelySpam", t("Likely spam")],
                  ],
                  false,
                ),
              ],
            },
            update("youtube.comment.moderate", t("Moderate comment"), "comment.moderate", [
              commentId,
              choice("status", t("Status"), [
                ["heldForReview", t("Hold for review")],
                ["published", t("Publish")],
                ["rejected", t("Hide")],
              ]),
            ]),
            remove("youtube.comment.delete", t("Delete comment"), "comment.moderate", [commentId]),
          ];
    case "community": {
      const postId = field("postId", t("Community post ID"), "text", true);
      const status = choice(
        "status",
        t("Status"),
        [
          ["published", t("Published")],
          ["scheduled", t("Scheduled")],
        ],
        false,
      );
      return [
        update("youtube.community.publish", t("Publish Community post"), "community.publish", [
          choice("kind", t("Format"), [
            ["text", t("Text")],
            ["image", t("Image")],
            ["poll", t("Poll")],
          ]),
          field("text", t("Post text"), "textarea", true),
          field("publishAt", t("Publish time"), "datetime"),
          {
            ...field("choices", t("Poll options"), "lines", true),
            whenKind: "poll",
            description: t("One option per line."),
          },
          {
            ...field("imageUploadIds", t("Images"), "images", true),
            multiple: true,
            whenKind: "image",
          },
        ]),
        { action: "youtube.community.list", label: t("List Community posts"), fields: [status] },
        update("youtube.community.edit", t("Edit Community post"), "community.publish", [
          postId,
          status,
          field("editedText", t("Post text"), "textarea", true),
        ]),
        remove("youtube.community.delete", t("Delete Community post"), "community.publish", [
          postId,
          status,
        ]),
      ];
    }
    case "subscriptions": {
      const target = [
        channelId("targetChannelId"),
        choice("action", t("Action"), [
          ["subscribe", t("Subscribe")],
          ["unsubscribe", t("Unsubscribe")],
        ]),
      ];
      return [
        {
          action: "youtube.subscriptions.list",
          label: t("List subscriptions"),
          fields: [
            choice("direction", t("Type"), [
              ["outgoing", t("Subscriptions")],
              ["incoming", t("Subscribers")],
            ]),
          ],
        },
        {
          action: "youtube.subscription.preview",
          label: t("Preview subscription change"),
          fields: target,
        },
        update("youtube.subscription.change", t("Change subscription"), "subscribe", target),
      ];
    }
    case "analytics":
      return browser
        ? [{ action: "youtube.monetization.status", label: t("Read monetization status") }]
        : [
            {
              action: "youtube.analytics.report",
              label: t("Run report"),
              fields: [
                choice("kind", t("Report"), [
                  ["overview", t("Overview")],
                  ["daily", t("Daily")],
                  ["traffic", t("Traffic sources")],
                  ["earnings", t("Estimated earnings")],
                ]),
                field("startDate", t("Start date"), "date", true),
                field("endDate", t("End date"), "date", true),
                field("currency", t("Currency code")),
              ],
            },
            { action: "youtube.quota.status", label: t("Check quota usage") },
          ];
    case "live":
      return [
        { action: "youtube.broadcasts.list", label: t("List broadcasts") },
        update("youtube.broadcast.create", t("Create broadcast"), "live.manage", [
          title(true),
          description,
          privacy(true),
          field("scheduledStartTime", t("Start time"), "datetime", true),
          madeForKids(true),
        ]),
        update("youtube.broadcast.transition", t("Change broadcast state"), "live.manage", [
          broadcastId,
          choice("status", t("Status"), [
            ["testing", t("Testing")],
            ["live", t("Live")],
            ["complete", t("End broadcast")],
          ]),
        ]),
        { action: "youtube.liveChat.list", label: t("Read live chat"), fields: [broadcastId] },
        update("youtube.liveChat.send", t("Send live chat message"), "live.chat", [
          broadcastId,
          field("message", t("Message"), "textarea", true),
          {
            ...field("replyToMessageId", t("Reply to message")),
            idLabel: t("Reply to message ID"),
          },
        ]),
        update(
          "youtube.liveChat.delete",
          t("Delete live chat message"),
          "live.chat",
          [broadcastId, named("messageId", t("Chat message"), t("Message ID"))],
          { danger: true },
        ),
        update(
          "youtube.liveChat.ban",
          t("Ban live chat user"),
          "live.chat",
          [
            broadcastId,
            channelId("channelId"),
            field("durationSeconds", t("Duration (seconds)"), "number"),
          ],
          { danger: true },
        ),
        update("youtube.liveChat.unban", t("Unban live chat user"), "live.chat", [
          broadcastId,
          field("banId", t("Ban ID"), "text", true),
        ]),
        { action: "youtube.superChats.list", label: t("List Super Chats") },
      ];
    case "review":
      return [{ action: "youtube.operations.list", label: t("List YouTube operations") }];
  }
}

export type YouTubeView = "videos" | "playlists" | "broadcasts" | "chat" | "superchats";

const viewOf: Record<string, YouTubeView> = {
  "youtube.videos.list": "videos",
  "youtube.video.update": "videos",
  "youtube.thumbnail.set": "videos",
  "youtube.video.delete": "videos",
  "youtube.playlists.list": "playlists",
  "youtube.playlist.create": "playlists",
  "youtube.playlist.update": "playlists",
  "youtube.playlist.add": "playlists",
  "youtube.playlist.remove": "playlists",
  "youtube.playlist.move": "playlists",
  "youtube.playlist.delete": "playlists",
  "youtube.broadcasts.list": "broadcasts",
  "youtube.broadcast.create": "broadcasts",
  "youtube.broadcast.transition": "broadcasts",
  "youtube.liveChat.list": "chat",
  "youtube.liveChat.send": "chat",
  "youtube.liveChat.delete": "chat",
  "youtube.liveChat.ban": "chat",
  "youtube.liveChat.unban": "chat",
  "youtube.superChats.list": "superchats",
};

/** Reads that fill the browse area of a section; every other form is a task the owner runs. */
const browseActions = new Set([
  "youtube.channel.read",
  "youtube.videos.list",
  "youtube.playlists.list",
  "youtube.comments.list",
  "youtube.subscriptions.list",
  "youtube.broadcasts.list",
  "youtube.liveChat.list",
  "youtube.superChats.list",
  "youtube.community.list",
  "youtube.quota.status",
  "youtube.monetization.status",
  "youtube.operations.list",
]);
export const isBrowseForm = (form: YouTubeForm) => !form.write && browseActions.has(form.action);

/** Sub-views of a section that groups unrelated lists (videos and playlists, broadcasts and chat). */
export function youtubeViews(section: YouTubeSection): { value: YouTubeView; label: string }[] {
  if (section === "videos")
    return [
      { value: "videos", label: t("Videos") },
      { value: "playlists", label: t("Playlists") },
    ];
  if (section === "live")
    return [
      { value: "broadcasts", label: t("Broadcasts") },
      { value: "chat", label: t("Live chat") },
      { value: "superchats", label: t("Super Chats") },
    ];
  return [];
}

/** The forms of one view of a section; a section without views returns all of its forms. */
export function youtubeViewForms(
  section: YouTubeSection,
  browser: boolean,
  view: YouTubeView | undefined,
): YouTubeForm[] {
  const forms = youtubeForms(section, browser);
  return view ? forms.filter((form) => viewOf[form.action] === view) : forms;
}

/** Keys that hold a platform identifier; the owner picks them from a list and types them only as a fallback. */
export const youtubeIdKeys = new Set([
  "videoId",
  "playlistId",
  "playlistItemId",
  "commentId",
  "broadcastId",
  "messageId",
  "replyToMessageId",
  "banId",
  "channelId",
  "authorChannelId",
  "targetChannelId",
  "postId",
  "parentId",
]);

export type YouTubeDraft = Record<string, string | File[]>;
export type YouTubeRefSource = { action: string; input?: Record<string, string> };

/** The list action whose rows can fill an identifier field, when one exists for the draft so far. */
export function youtubeRefSource(key: string, draft: YouTubeDraft): YouTubeRefSource | undefined {
  const text = (name: string) => (typeof draft[name] === "string" ? draft[name] : "");
  switch (key) {
    case "videoId":
      return { action: "youtube.videos.list" };
    case "playlistId":
      return { action: "youtube.playlists.list" };
    case "playlistItemId":
      return text("playlistId")
        ? { action: "youtube.playlists.list", input: { playlistId: text("playlistId") } }
        : undefined;
    case "broadcastId":
      return { action: "youtube.broadcasts.list" };
    case "messageId":
    case "replyToMessageId":
      return text("broadcastId")
        ? { action: "youtube.liveChat.list", input: { broadcastId: text("broadcastId") } }
        : undefined;
    default:
      return undefined;
  }
}
