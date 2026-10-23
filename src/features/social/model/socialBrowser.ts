import { t } from "../../../shared/i18n";
import type { SocialPlatform } from "./social";
export type XProfilePatch = {
  name?: string;
  bio?: string;
  location?: string;
  website?: string;
  avatarUploadId?: string;
  bannerUploadId?: string;
};
export type XProfileState = {
  name: string;
  bio: string;
  location: string;
  website: string;
  avatarUrl?: string;
  bannerUrl?: string;
};

export const SOCIAL_BROWSER_INTENTS = ["login", "signup", "inbox", "publish", "comments"] as const;
export type SocialBrowserIntent = (typeof SOCIAL_BROWSER_INTENTS)[number];
export type SocialBrowserWorkflow = {
  id: string;
  accountId: string;
  platform: SocialPlatform;
  intent: SocialBrowserIntent;
  status:
    | "queued"
    | "awaiting_owner"
    | "window_closed"
    | "cancelled"
    | "expired"
    | "interrupted"
    | "failed";
  createdAt: number;
  updatedAt: number;
  expiresAt: number;
  /** Page navigation/window closure is not evidence of authentication or delivery. */
  outcome: "unverified";
  error?: string;
};
export type SocialBrowserState = {
  available: boolean;
  reason: string;
  workflows: SocialBrowserWorkflow[];
};
export const SOCIAL_BROWSER_LABELS: Record<SocialBrowserIntent, string> = {
  get login() {
    return t("Log in");
  },
  get signup() {
    return t("Sign up");
  },
  get inbox() {
    return t("Open inbox");
  },
  get publish() {
    return t("Open publishing screen");
  },
  get comments() {
    return t("Open comments");
  },
};

type Site = {
  origins: readonly string[];
  routes: Partial<Record<SocialBrowserIntent, string>>;
};
/** Owner-assisted routes. Their presence never grants an automated read/write capability. */
export const SOCIAL_BROWSER_SITES: Record<SocialPlatform, Site> = {
  x: {
    origins: ["https://x.com"],
    routes: {
      login: "https://x.com/login",
      signup: "https://x.com/i/flow/signup",
      inbox: "https://x.com/messages",
      publish: "https://x.com/compose/post",
    },
  },
  instagram: {
    origins: ["https://www.instagram.com"],
    routes: {
      login: "https://www.instagram.com/accounts/login/",
      signup: "https://www.instagram.com/accounts/emailsignup/",
      inbox: "https://www.instagram.com/direct/inbox/",
      publish: "https://www.instagram.com/",
    },
  },
  facebook: {
    origins: ["https://www.facebook.com"],
    routes: {
      login: "https://www.facebook.com/login/",
      signup: "https://www.facebook.com/r.php",
      inbox: "https://www.facebook.com/messages/",
      publish: "https://www.facebook.com/",
    },
  },
  linkedin: {
    origins: ["https://www.linkedin.com"],
    routes: {
      login: "https://www.linkedin.com/login",
      signup: "https://www.linkedin.com/signup",
      inbox: "https://www.linkedin.com/messaging/",
      publish: "https://www.linkedin.com/feed/",
    },
  },
  youtube: {
    origins: ["https://www.youtube.com", "https://studio.youtube.com"],
    routes: {
      login: "https://www.youtube.com/",
      signup: "https://accounts.google.com/signup",
      publish: "https://studio.youtube.com/",
    },
  },
  tiktok: {
    origins: ["https://www.tiktok.com"],
    routes: {
      login: "https://www.tiktok.com/login",
      signup: "https://www.tiktok.com/signup",
      inbox: "https://www.tiktok.com/messages",
      publish: "https://www.tiktok.com/tiktokstudio/upload",
    },
  },
  snapchat: {
    origins: ["https://web.snapchat.com", "https://www.snapchat.com"],
    routes: {
      login: "https://web.snapchat.com/",
      signup: "https://accounts.snapchat.com/accounts/signup",
      inbox: "https://web.snapchat.com/",
    },
  },
  whatsapp: {
    origins: ["https://web.whatsapp.com"],
    routes: { login: "https://web.whatsapp.com/", inbox: "https://web.whatsapp.com/" },
  },
  telegram: {
    origins: ["https://web.telegram.org"],
    routes: { login: "https://web.telegram.org/", inbox: "https://web.telegram.org/" },
  },
};

export function socialBrowserUrl(
  platform: SocialPlatform,
  intent: SocialBrowserIntent,
  target?: unknown,
): string {
  const site = SOCIAL_BROWSER_SITES[platform];
  if (!site || !SOCIAL_BROWSER_INTENTS.includes(intent))
    throw new Error("Unsupported browser workflow.");
  if (intent === "comments") {
    if (!["x", "instagram", "facebook", "linkedin", "youtube", "tiktok"].includes(platform))
      throw new Error("This platform has no supported browser comment route.");
    if (typeof target !== "string" || target.length > 2048)
      throw new Error("Enter the post's HTTPS URL.");
    const url = new URL(target);
    if (!site.origins.includes(url.origin) || url.username || url.password || url.port)
      throw new Error("The post URL must belong to the selected platform.");
    // Keep only public post addressing parameters, never authentication/query material.
    const video = platform === "youtube" ? url.searchParams.get("v") : null;
    url.search = "";
    url.hash = "";
    if (video && /^[\w-]{11}$/.test(video)) url.searchParams.set("v", video);
    const paths: Partial<Record<SocialPlatform, RegExp>> = {
      x: /^\/[\w]+\/status\/\d+\/?$/,
      instagram: /^\/(p|reel)\/[\w-]+\/?$/,
      facebook: /^\/(?:[^/]+\/posts\/[^/]+|reel\/\d+|videos\/\d+)\/?$/,
      linkedin: /^\/posts\/[^/]+\/?$|^\/feed\/update\/urn:li:activity:\d+\/?$/,
      youtube: /^\/watch$|^\/shorts\/[\w-]{11}\/?$/,
      tiktok: /^\/@[\w.]+\/video\/\d+\/?$/,
    };
    if (
      !paths[platform]?.test(url.pathname) ||
      (platform === "youtube" &&
        url.pathname === "/watch" &&
        (!video || !/^[\w-]{11}$/.test(video)))
    )
      throw new Error("Enter a supported public post URL, not an arbitrary page.");
    return url.href;
  }
  const url = site.routes[intent];
  if (!url)
    throw new Error(
      "This workflow requires the platform's mobile app or is unavailable on the web.",
    );
  return url;
}
