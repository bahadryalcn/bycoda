import { readHostFile } from "../workspaces/workspace";
import { previewInlineVisual } from "./inline-visual-preview";
import { storeInlineVisual } from "./inline-visual-store";
import type { BrowserLoader } from "../browser/shared-browser";
import {
  inlineVisualSource,
  MAX_INLINE_VISUAL_HEIGHT,
  MAX_INLINE_VISUAL_HTML_CHARS,
  MIN_INLINE_VISUAL_HEIGHT,
} from "../../src/features/sessions/model/inlineVisual";

const source = {
  title: {
    type: "string",
    minLength: 1,
    maxLength: 160,
    description:
      "Short title naming the subject, such as 'Queue flow'; omit format labels such as 'Interactive HTML'.",
  },
  html: {
    type: "string",
    minLength: 1,
    maxLength: MAX_INLINE_VISUAL_HTML_CHARS,
    description: "A complete, self-contained HTML document with inline <style> and <script>.",
  },
  path: { type: "string", minLength: 1, maxLength: 4096 },
};
const height = {
  type: "integer",
  minimum: MIN_INLINE_VISUAL_HEIGHT,
  maximum: MAX_INLINE_VISUAL_HEIGHT,
};
const previewSchema = {
  type: "object",
  properties: {
    ...source,
    width: {
      type: "integer",
      minimum: 240,
      maximum: 1600,
      description: "CSS pixels. Default 728, the transcript width. Use about 390 for phones.",
    },
    appearance: {
      type: "string",
      enum: ["dark", "light"],
      description: "Default dark.",
    },
  },
  required: ["title"],
  additionalProperties: false,
};
const renderSchema = {
  type: "object",
  properties: {
    ...source,
    height: {
      ...height,
      description: "Frame height in CSS pixels. Use contentHeight from visuals.preview.",
    },
  },
  required: ["title", "height"],
  additionalProperties: false,
};
export const CONVERSATION_VISUAL_TOOLS = {
  "visuals.preview": previewSchema,
  "visuals.render": renderSchema,
} as const;
export const isVisualConversationTool = (action: string) =>
  Object.hasOwn(CONVERSATION_VISUAL_TOOLS, action);

const PAGE_RULES =
  "Supply exactly one of html (a complete self-contained document) or a workspace-relative HTML path. Inline <style> and <script>; images must be data: URIs. Network, relative assets, app APIs, forms and nested frames are blocked. The frame is the transcript width (about 728px) on the thread background: leave html, body and the outer element without background color, outer card, border, banner title or side padding; bycoda adds an 8px html gutter. Use fluid widths, fixed pixel heights for charts, and never vh units or height:100% on html/body. Use the theme CSS variables instead of fixed colors: --background, --foreground, --muted, --card, --popover, --secondary, --border, --ring, --primary, --accent, --destructive, --warning, --success, --info, --code-background (most have a matching -foreground; accent, destructive and warning also have -surface), --chart-1 to --chart-6, --radius, --font-sans, --font-mono. The base sheet already sets background, text color and font.";

export function describeVisualConversationTool(action: string) {
  if (action === "visuals.preview")
    return `Check a visual before visuals.render. Returns a screenshot, contentHeight and console output from an isolated offline browser; nothing is added to the transcript. The first call on a Host may start a one-time pinned Playwright/Chromium download in the background and return installing: true; then call visuals.preview again in about a minute, or render with your best height estimate. ${PAGE_RULES}`;
  if (action === "visuals.render")
    return `Show a finished visual (chart, diagram, comparison, mockup, interactive example) inline in this conversation, above your reply. Use it when a visual explains better than text and whenever the owner asks to see something; keep simple answers as text. Do not restate the visual in your reply. Preview first, then render the same source with height set to the preview's contentHeight. Short subject-based title. ${PAGE_RULES} The stored snapshot is immutable; no external publication.`;
}

/** The Host's optional preview browser: the pinned runtime in host/browser/browser-runtime.ts. */
export type VisualPreviewBrowser = {
  load: BrowserLoader;
  status(): Promise<{ installed: boolean; installing: boolean; lastError?: string }>;
  setup(): Promise<unknown>;
};

export async function callVisualConversationTool(
  root: string,
  action: string,
  input: Record<string, unknown>,
  authorized: () => boolean | Promise<boolean>,
  options: { browser?: VisualPreviewBrowser; dataDir?: string } = {},
) {
  if (!isVisualConversationTool(action)) throw new Error("Unsupported visual tool.");
  const check = async () => {
    if (!(await authorized())) throw new Error("Session authority revoked.");
  };
  await check();
  if ((typeof input.html === "string") === (typeof input.path === "string"))
    throw new Error("Supply exactly one of html or path.");
  if (input.path && !/\.html?$/i.test(String(input.path)))
    throw new Error("Visual source must be an HTML file.");
  const html = typeof input.html === "string" ? input.html : await readHostFile(root, input.path);
  const visual = inlineVisualSource({
    title: input.title,
    html,
    height: input.height ?? 360,
  });
  if (!visual)
    throw new Error(
      `Visual is invalid: title 1-160 characters, HTML up to ${MAX_INLINE_VISUAL_HTML_CHARS} characters, height ${MIN_INLINE_VISUAL_HEIGHT}-${MAX_INLINE_VISUAL_HEIGHT}.`,
    );
  await check();
  if (action === "visuals.preview") {
    if (!options.browser) throw new Error("Host browser runtime is unavailable.");
    const status = await options.browser.status();
    if (!status.installed) {
      // The owner chose reference-style previews: an authorized preview may start the
      // pinned one-time setup. It runs in the background so this call never waits.
      void options.browser.setup().catch(() => undefined);
      return {
        ready: false,
        installing: true,
        ...(status.lastError ? { previousError: status.lastError } : {}),
        next: "The preview browser is being installed on this Host (one time, usually 1-3 minutes). Call visuals.preview again in about a minute, or call visuals.render now with your best height estimate.",
      };
    }
    return await previewInlineVisual(
      visual,
      {
        width: typeof input.width === "number" ? input.width : 728,
        dark: input.appearance !== "light",
      },
      authorized,
      options.browser.load,
    );
  }
  if (!options.dataDir) throw new Error("Host visual storage is unavailable.");
  const ref = await storeInlineVisual(options.dataDir, visual);
  await check();
  return { bycodaInlineVisual: ref };
}
