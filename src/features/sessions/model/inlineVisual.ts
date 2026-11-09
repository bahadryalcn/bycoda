import fallbackTheme from "./inlineVisualFallbackTheme.json";
/** Validated visual content: title, self-contained HTML and frame height. */
export type InlineVisualSource = {
  title: string;
  html: string;
  height: number;
};
/** Legacy snapshot that carried its HTML inside the tool result. Never a path, live URL or native capability. */
export type InlineVisualSnapshot = InlineVisualSource & { version: 1 };
/** Content-addressed reference to a Host-stored source; the tool result stays small. */
export type InlineVisualRef = {
  version: 2;
  id: string;
  title: string;
  height: number;
};
export type InlineVisual = InlineVisualSnapshot | InlineVisualRef;

// Legacy v1 snapshots had to fit the retained 8,000 character tool output.
export const MAX_INLINE_VISUAL_CHARS = 4000;
export const MAX_INLINE_VISUAL_HTML_CHARS = 512_000;
export const MIN_INLINE_VISUAL_HEIGHT = 80;
export const MAX_INLINE_VISUAL_HEIGHT = 2000;
export const INLINE_VISUAL_ID = /^[0-9a-f]{64}$/;

export function isInlineVisualRenderTool(title: string | undefined): boolean {
  return /(?:^|[\s:])(?:mcp__[^\s]+__)?conversation_visuals_render(?:$|\s|\()/.test(title ?? "");
}

const validTitle = (value: unknown): value is string =>
  typeof value === "string" && !!value.trim() && value.length <= 160;
const validHeight = (value: unknown): value is number =>
  typeof value === "number" &&
  Number.isInteger(value) &&
  value >= MIN_INLINE_VISUAL_HEIGHT &&
  value <= MAX_INLINE_VISUAL_HEIGHT;

export function inlineVisualSource(value: unknown): InlineVisualSource | undefined {
  if (!value || typeof value !== "object") return;
  const item = value as Record<string, unknown>;
  if (
    !validTitle(item.title) ||
    typeof item.html !== "string" ||
    !item.html.trim() ||
    item.html.length > MAX_INLINE_VISUAL_HTML_CHARS ||
    item.html.includes("\0") ||
    !validHeight(item.height)
  )
    return;
  return { title: item.title, html: item.html, height: item.height };
}

/** Validates a persisted or provider-supplied visual of either version. */
export function inlineVisualValue(value: unknown): InlineVisual | undefined {
  if (!value || typeof value !== "object") return;
  const item = value as Record<string, unknown>;
  if (item.version === 2) {
    if (
      typeof item.id !== "string" ||
      !INLINE_VISUAL_ID.test(item.id) ||
      !validTitle(item.title) ||
      !validHeight(item.height)
    )
      return;
    return { version: 2, id: item.id, title: item.title, height: item.height };
  }
  if (item.version !== 1) return;
  const source = inlineVisualSource(item);
  if (!source) return;
  const snapshot: InlineVisualSnapshot = { version: 1, ...source };
  if (JSON.stringify(snapshot).length > MAX_INLINE_VISUAL_CHARS) return;
  return snapshot;
}

/** MCP text and structured results vary by provider. Ordinary HTML is never executed. */
export function inlineVisualFromResult(detail: string | undefined): InlineVisual | undefined {
  if (!detail || detail.length > 8000) return;
  function read(value: unknown, depth: number): InlineVisual | undefined {
    if (depth > 8 || value == null) return;
    if (typeof value === "string") {
      try {
        return read(JSON.parse(value), depth + 1);
      } catch {
        return;
      }
    }
    if (Array.isArray(value)) {
      for (const part of value) {
        const found = read(part, depth + 1);
        if (found) return found;
      }
      return;
    }
    if (typeof value !== "object") return;
    const record = value as Record<string, unknown>;
    if (record.isError === true) return;
    const visual = inlineVisualValue(record.bycodaInlineVisual);
    if (visual) return visual;
    for (const key of ["content", "text", "result", "structuredContent"]) {
      const found = read(record[key], depth + 1);
      if (found) return found;
    }
  }
  return read(detail, 0);
}

/** Visual-facing theme variables and the app token each one reads. */
export const INLINE_VISUAL_THEME_TOKENS = {
  "--background": "--ui-chat-canvas",
  "--foreground": "--color-content",
  "--muted": "--ui-fill-muted",
  "--muted-foreground": "--ui-text-muted",
  "--card": "--ui-surface-raised",
  "--card-foreground": "--color-content",
  "--popover": "--ui-surface-floating",
  "--popover-foreground": "--color-content",
  "--secondary": "--ui-fill-subtle",
  "--secondary-foreground": "--ui-text-secondary",
  "--border": "--color-stroke",
  "--ring": "--ui-tone-accent-border",
  "--primary": "--ui-tone-accent-solid",
  "--primary-foreground": "--ui-tone-accent-on-solid",
  "--accent": "--ui-tone-accent-fg",
  "--accent-foreground": "--ui-tone-accent-on-solid",
  "--accent-surface": "--ui-tone-accent-subtle",
  "--destructive": "--ui-tone-danger-fg",
  "--destructive-foreground": "--ui-tone-danger-on-solid",
  "--destructive-surface": "--ui-tone-danger-subtle",
  "--warning": "--ui-tone-warning-fg",
  "--warning-foreground": "--ui-tone-warning-on-solid",
  "--warning-surface": "--ui-tone-warning-subtle",
  "--success": "--ui-tone-success-fg",
  "--success-foreground": "--ui-tone-success-on-solid",
  "--info": "--ui-tone-info-fg",
  "--info-foreground": "--ui-tone-info-on-solid",
  "--code-background": "--ui-surface-muted",
  "--chart-1": "--ui-tone-accent-fg",
  "--chart-2": "--ui-tone-success-fg",
  "--chart-3": "--ui-tone-warning-fg",
  "--chart-4": "--ui-tone-info-fg",
  "--chart-5": "--ui-tone-danger-fg",
  "--chart-6": "--color-skill",
  "--radius": "--radius-panel",
  "--font-sans": "--font-sans",
  "--font-mono": "--font-mono",
} as const;
export type InlineVisualTheme = Partial<Record<keyof typeof INLINE_VISUAL_THEME_TOKENS, string>>;

// Used where no app stylesheet exists, such as the Host preview browser.
const FALLBACK_THEME: Record<"dark" | "light", InlineVisualTheme> = fallbackTheme;
const FALLBACK_SHARED: InlineVisualTheme = {
  "--radius": "0.75rem",
  "--font-sans": "ui-sans-serif, system-ui, sans-serif",
  "--font-mono": "ui-monospace, SFMono-Regular, Menlo, monospace",
};

/** Theme values cannot close the style element or inject markup. */
const safeThemeValue = (value: string | undefined) =>
  value && value.length <= 400 && !/[<>{};\\]/.test(value) ? value.trim() : undefined;

/** Base sheet: theme variables plus defaults the visual may override. */
export function inlineVisualBaseCss(dark: boolean, theme: InlineVisualTheme = {}): string {
  const fallback = {
    ...FALLBACK_SHARED,
    ...FALLBACK_THEME[dark ? "dark" : "light"],
  };
  const value = (name: keyof InlineVisualTheme) => safeThemeValue(theme[name]) ?? fallback[name];
  const variables = (Object.keys(INLINE_VISUAL_THEME_TOKENS) as (keyof InlineVisualTheme)[])
    .map((name) => `${name}:${value(name)}`)
    .join(";");
  // Body defaults use resolved values; the variables above stay available to the page.
  return `:root{${variables};color-scheme:${dark ? "dark" : "light"}}html{padding:0.5rem}html,body{margin:0}body{background:${value("--background")};color:${value("--foreground")};font-family:${value("--font-sans")};font-size:0.8125rem;line-height:1.5}`;
}

/** A stricter policy than file previews: self-contained content cannot contact a host. */
export function sandboxedInlineVisual(
  source: string,
  dark: boolean,
  theme?: InlineVisualTheme,
): string {
  // Anything before the doctype would force quirks mode, so the doctype leads.
  const body = source.replace(/^\s*<!doctype[^>]*>/i, "");
  return `<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; font-src data:; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'"><meta name="color-scheme" content="${dark ? "dark" : "light"}"><style>${inlineVisualBaseCss(dark, theme)}</style>${body}`;
}
