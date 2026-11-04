import { readHostFile } from "../workspace";
import { previewInlineVisual } from "../inline-visual-preview";
import type { BrowserLoader } from "../shared-browser";
import { inlineVisualSnapshot } from "../../src/features/sessions/model/inlineVisual";

const schema = {
  type: "object",
  properties: {
    title: {
      type: "string",
      minLength: 1,
      maxLength: 160,
      description:
        "Short title naming the subject, such as 'Queue flow'; omit format labels such as 'Interactive HTML'.",
    },
    html: { type: "string", minLength: 1, maxLength: 4000 },
    path: { type: "string", minLength: 1, maxLength: 4096 },
    height: { type: "integer", minimum: 160, maximum: 720 },
  },
  required: ["title"],
  additionalProperties: false,
};
export const CONVERSATION_VISUAL_TOOLS = {
  "visuals.preview": schema,
  "visuals.render": schema,
} as const;
export const isVisualConversationTool = (action: string) =>
  Object.hasOwn(CONVERSATION_VISUAL_TOOLS, action);
export function describeVisualConversationTool(action: string) {
  if (!isVisualConversationTool(action)) return;
  return "Create a visual explanation inside this conversation with self-contained HTML/CSS/SVG/JavaScript. Use proactively when a diagram, comparison, UI concept or interactive example makes the answer clearer; the owner need not explicitly request HTML. Keep simple answers as text. Use a short subject-based title, compact content and a height fitted to the content; avoid format labels, repeated headings, decorative cards and empty space. Preview with visuals.preview, inspect its screenshot, then use visuals.render with the same source. Supply exactly one of html or a workspace-relative HTML path. Read files through the authenticated working copy only. The immutable snapshot includes data: images; relative assets, network, app APIs and nested frames are unavailable. Serialized title/html/height metadata is limited to 4000 characters. Preview returns an agent-readable sandbox screenshot using this Host's existing Playwright/Chromium setup, without adding the visual to the transcript. Render returns the snapshot for the transcript. Unsupported clients/providers retain the source result. No installation or external publication.";
}
export async function callVisualConversationTool(
  root: string,
  action: string,
  input: Record<string, unknown>,
  authorized: () => boolean | Promise<boolean>,
  browserLoader?: BrowserLoader,
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
  const snapshot = inlineVisualSnapshot({
    version: 1,
    title: input.title,
    html,
    height: input.height ?? 360,
  });
  if (!snapshot)
    throw new Error(
      "Visual snapshot is invalid or exceeds the 4000 character serialized limit. Inline images must fit that limit; use a normal attachment for larger images.",
    );
  await check();
  if (action === "visuals.preview") {
    if (!browserLoader)
      throw new Error(
        "Host browser runtime is unavailable. Set up the existing Host browser, then retry.",
      );
    return await previewInlineVisual(snapshot, authorized, browserLoader);
  }
  return { bycodaInlineVisual: snapshot };
}
