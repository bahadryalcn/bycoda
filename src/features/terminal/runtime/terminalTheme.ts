import type { ISearchOptions } from "@xterm/addon-search";
import type { IDisposable, Terminal } from "@xterm/xterm";
import { themePalette } from "../../../shared/theme/palette";
import {
  loadAppearancePreferences,
  terminalFontFamily,
} from "../../settings/model/appearancePreferences";
import { isLightScheme, SCHEME_CHANGE_EVENT } from "../../settings/model/appearance";
import { isOscColorQuery, oscColorReply } from "../model/terminalChrome";
import { resolveTerminalCanvas, terminalRenderingPolicy } from "../model/terminalRenderingPolicy";

function cssColor(expr: string, fallback: string, scope?: HTMLElement): string {
  const probe = document.createElement("span");
  probe.style.color = expr;
  (scope ?? document.body).appendChild(probe);
  const color = getComputedStyle(probe).color;
  probe.remove();
  if (!color) return fallback;
  // xterm's parser and OSC replies need sRGB channels, including for modern
  // theme colors such as color-mix() and oklch().
  if (/^(?:color|oklch|oklab|lab|lch)\(/.test(color)) {
    const context = document.createElement("canvas").getContext("2d");
    if (!context) return fallback;
    context.fillStyle = color;
    context.fillRect(0, 0, 1, 1);
    const [r, g, b, a] = context.getImageData(0, 0, 1, 1).data;
    return `rgba(${r}, ${g}, ${b}, ${a / 255})`;
  }
  return color;
}

function cssHexColor(expr: string, fallback: string, scope?: HTMLElement): string {
  const color = cssColor(expr, fallback, scope);
  if (/^#[\da-f]{6}$/i.test(color)) return color;
  const channels = color
    .match(/[\d.]+/g)
    ?.slice(0, 3)
    .map(Number);
  if (!channels || channels.length < 3 || channels.some(Number.isNaN)) {
    return fallback;
  }
  return `#${channels
    .map((channel) =>
      Math.round(Math.min(255, Math.max(0, channel)))
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;
}

const ANSI_DARK = {
  black: themePalette.hex1d2428,
  red: themePalette.dangerDark,
  green: themePalette.successDark,
  yellow: themePalette.warningDark,
  blue: themePalette.infoDark,
  magenta: themePalette.featureDark,
  cyan: themePalette.hex22d3ee,
  white: themePalette.hexe8eef2,
  brightBlack: themePalette.hex64748b,
  brightRed: themePalette.hexfca5a5,
  brightGreen: themePalette.hex86efac,
  brightYellow: themePalette.hexfde68a,
  brightBlue: themePalette.search,
  brightMagenta: themePalette.hexd8b4fe,
  brightCyan: themePalette.hex67e8f9,
  brightWhite: themePalette.hexf8fafc,
};

// One-Light-family palette tuned for a near-white canvas.
const ANSI_LIGHT = {
  black: themePalette.hex383a42,
  red: themePalette.hexe45649,
  green: themePalette.hex50a14f,
  yellow: themePalette.hexc18401,
  blue: themePalette.hex4078f2,
  magenta: themePalette.hexa626a4,
  cyan: themePalette.hex0184bc,
  white: themePalette.hexfafafa,
  brightBlack: themePalette.hex7c8591,
  brightRed: themePalette.hexdf6b60,
  brightGreen: themePalette.hex68b567,
  brightYellow: themePalette.hexd19a2f,
  brightBlue: themePalette.hex5c89f5,
  brightMagenta: themePalette.hexb54bb3,
  brightCyan: themePalette.hex1f9cc9,
  brightWhite: themePalette.solidInk,
};

export function terminalColors(light: boolean, scope: HTMLElement) {
  const fallbackCanvas = cssColor(
    "var(--color-background-base, var(--ui-surface))",
    light ? themePalette.hexfafafa : themePalette.hex171717,
    scope,
  );
  const policy = terminalRenderingPolicy({
    canvas: resolveTerminalCanvas(scope, (color) => cssColor(color, "", scope)),
    fallbackCanvas,
    foreground: cssColor(
      "var(--terminal-text, var(--color-content))",
      light ? themePalette.hex2e2e2e : themePalette.hexe8eef2,
      scope,
    ),
    cursor: cssColor(
      "var(--ui-focus-ring-color)",
      light ? themePalette.hex4078f2 : themePalette.hex4da3f5,
      scope,
    ),
    selectionBackground: cssColor(
      "var(--ui-text-selection-background)",
      themePalette.accent,
      scope,
    ),
    selectionForeground: cssColor("var(--ui-text-selection-foreground)", themePalette.scrim, scope),
  });
  const { minimumContrastRatio, canvasResolved, ...theme } = policy;
  // The slider follows the app's scrollbar tokens (Appearance > Interface > Scrollbars).
  const scrollbar = (token: string) => cssColor(`var(${token})`, "transparent", scope);
  return {
    minimumContrastRatio,
    canvasResolved,
    theme: {
      ...theme,
      ...(light ? ANSI_LIGHT : ANSI_DARK),
      scrollbarSliderBackground: scrollbar("--ui-scrollbar-thumb"),
      scrollbarSliderHoverBackground: scrollbar("--ui-scrollbar-thumb-hover"),
      scrollbarSliderActiveBackground: scrollbar("--ui-scrollbar-thumb-active"),
    },
    searchDecorations: {
      matchBorder: cssHexColor("var(--ui-focus-ring-color)", themePalette.accent, scope),
      activeMatchBorder: cssHexColor("var(--ui-focus-ring-color)", themePalette.accent, scope),
      matchOverviewRuler: cssHexColor("var(--ui-focus-ring-color)", themePalette.accent, scope),
      activeMatchColorOverviewRuler: cssHexColor(
        "var(--ui-focus-ring-color)",
        themePalette.accent,
        scope,
      ),
    } satisfies ISearchOptions["decorations"],
  };
}

export function monoFont(): string {
  const font = terminalFontFamily(loadAppearancePreferences());
  if (font) return `${JSON.stringify(font)}, monospace`;
  const fromCss = getComputedStyle(document.documentElement).getPropertyValue("--font-mono").trim();
  // Chromium on Windows skips ui-monospace and lands on thin Consolas; Cascadia
  // Mono ships with Windows 11 and is absent (skipped) elsewhere.
  return `"Cascadia Mono", ${fromCss || "ui-monospace, SFMono-Regular, Menlo, Monaco, monospace"}`;
}

function oscColors(scope: HTMLElement) {
  const light = isLightScheme();
  const { theme } = terminalColors(light, scope);
  return {
    fg: cssHexColor(
      theme.foreground,
      light ? themePalette.hex2e2e2e : themePalette.hexebebeb,
      scope,
    ),
    bg: cssHexColor(
      theme.cursorAccent,
      light ? themePalette.hexf7f7f7 : themePalette.hex171717,
      scope,
    ),
    cursor: cssHexColor(
      theme.cursor,
      light ? themePalette.hex4078f2 : themePalette.hex4da3f5,
      scope,
    ),
  };
}

/** OSC 10/11/12 color queries answered from the resolved terminal theme. */
export function registerTerminalOscColorReplies(
  term: Terminal,
  outer: HTMLElement,
  write: (reply: string) => void,
): IDisposable {
  const replyOsc = (code: 10 | 11 | 12, hex: string) => {
    const reply = oscColorReply(code, hex);
    if (reply) {
      write(reply);
    }
    return true;
  };
  const oscFg = term.parser.registerOscHandler(10, (data) =>
    isOscColorQuery(data) ? replyOsc(10, oscColors(outer).fg) : false,
  );
  const oscBg = term.parser.registerOscHandler(11, (data) =>
    isOscColorQuery(data) ? replyOsc(11, oscColors(outer).bg) : false,
  );
  const oscCursor = term.parser.registerOscHandler(12, (data) =>
    isOscColorQuery(data) ? replyOsc(12, oscColors(outer).cursor) : false,
  );
  return {
    dispose() {
      oscFg.dispose();
      oscBg.dispose();
      oscCursor.dispose();
    },
  };
}

/** Inline declarations that move or size a box and cannot change a color. */
const GEOMETRY_PROPERTY =
  /^(?:grid-template-(?:rows|columns|areas)|(?:min-|max-)?(?:width|height|inline-size|block-size)|left|top|right|bottom|inset(?:-.+)?|transform|translate|flex(?:-basis|-grow|-shrink)?|cursor|(?:-webkit-)?user-select)$/;

function paletteDeclarations(style: string | null): string {
  return (style ?? "")
    .split(";")
    .map((declaration) => declaration.trim())
    .filter((declaration) => {
      const name = declaration.slice(0, declaration.indexOf(":")).trim().toLowerCase();
      return declaration && !GEOMETRY_PROPERTY.test(name);
    })
    .join(";");
}

/**
 * A panel drag rewrites an ancestor's inline size on every frame. Only a class
 * change, or a style change beyond geometry, can alter the terminal palette.
 */
export function mayChangePalette(record: MutationRecord): boolean {
  if (record.attributeName !== "style") return true;
  const current = (record.target as Element).getAttribute("style");
  return paletteDeclarations(record.oldValue) !== paletteDeclarations(current);
}

/**
 * Live theme updates. Root class/style mutations (drag, resize, sliders) arrive
 * in bursts and mostly leave the palette alone: probe once per frame, assign
 * only a change (it repaints and rebuilds the WebGL atlas), and defer hidden
 * terminals until they are visible again.
 */
export function createTerminalTheme(options: {
  term: Terminal;
  outer: HTMLElement;
  canRender: () => boolean;
  onSearchDecorations: (decorations: ISearchOptions["decorations"]) => void;
}) {
  const { term, outer, canRender, onSearchDecorations } = options;
  let appliedTheme = "";
  let stale = false;
  let frame = 0;
  let disposed = false;
  const apply = () => {
    stale = false;
    const next = terminalColors(isLightScheme(), outer);
    const key = JSON.stringify(next);
    if (key === appliedTheme) return;
    appliedTheme = key;
    term.options.minimumContrastRatio = next.minimumContrastRatio;
    term.options.theme = next.theme;
    outer.dataset.terminalCanvas = next.canvasResolved ? "resolved" : "unresolved-backdrop";
    onSearchDecorations(next.searchDecorations);
  };
  const onSchemeChange = () => {
    if (!canRender()) {
      stale = true;
      return;
    }
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      if (!disposed) apply();
    });
  };
  window.addEventListener(SCHEME_CHANGE_EVENT, onSchemeChange);
  const media = ["(prefers-reduced-transparency: reduce)", "(forced-colors: active)"]
    .map((query) => window.matchMedia?.(query))
    .filter((query): query is MediaQueryList => !!query);
  for (const query of media) query.addEventListener?.("change", onSchemeChange);
  const observer = new MutationObserver((records) => {
    if (records.some(mayChangePalette)) onSchemeChange();
  });
  for (let node: HTMLElement | null = outer; node; node = node.parentElement) {
    observer.observe(node, {
      attributes: true,
      attributeFilter: ["class", "style"],
      attributeOldValue: true,
    });
  }
  return {
    /** Called when the terminal becomes visible again. */
    applyIfStale() {
      if (stale) apply();
    },
    dispose() {
      disposed = true;
      window.removeEventListener(SCHEME_CHANGE_EVENT, onSchemeChange);
      for (const query of media) query.removeEventListener?.("change", onSchemeChange);
      observer.disconnect();
      if (frame) cancelAnimationFrame(frame);
    },
  };
}
