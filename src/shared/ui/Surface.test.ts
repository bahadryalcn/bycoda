// @vitest-environment jsdom
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { Surface, surfaceAttributes, type SurfaceAppearance, type SurfaceVariant } from "./Surface";
import styles from "./Surface.module.css";

const css = readFileSync("src/shared/ui/Surface.module.css", "utf8");
it.each(["stroke", "card"] as const)(
  "divides direct children with the %s frame token",
  (dividers) => {
    expect(surfaceAttributes({ dividers })["data-surface-dividers"]).toBe(dividers);
    expect(renderToStaticMarkup(createElement(Surface, { dividers }))).toContain(
      `data-surface-dividers="${dividers}"`,
    );
    expect(css).toContain(`[data-surface-dividers="${dividers}"]`);
    const token = dividers === "stroke" ? "--color-stroke" : "--ui-card-border";
    const dividerRule = css.match(
      new RegExp(`\\[data-surface-dividers="${dividers}"\\][^{]*\\{([^}]+)\\}`),
    );
    expect(dividerRule?.[1]).toContain(`border-color: var(${token})`);
    expect(css).toMatch(/> :where\(:not\(:last-child\)\)/);
    expect(css).toContain("border-block-end-width: 1px");
  },
);
it("shares adjacent-row separators without adding a frame to the first row", () => {
  expect(surfaceAttributes({ separator: "block" })["data-surface-separator"]).toBe("block");
  expect(renderToStaticMarkup(createElement(Surface, { separator: "block" }))).toContain(
    'data-surface-separator="block"',
  );
  expect(css).toMatch(
    /\[data-surface-separator="block"\]\s*\+\s*:is\(.surface, .appearance\)\[data-surface-separator="block"\]/,
  );
});
const roles = readFileSync("src/styles/surface-roles.css", "utf8").replace(/\s+/g, "");

it("keeps the existing default markup and adds no opt-in attributes", () => {
  expect(renderToStaticMarkup(createElement(Surface, null, "body"))).toBe(
    `<div data-variant="plain" data-padding="md" class="${styles.surface}">body</div>`,
  );
  expect(css).toContain("border: 1px solid transparent");
  expect(css).toContain("border-radius: var(--ui-radius-card)");
  expect(css).toContain(".surface .surface");
});

it("partial appearance adds no layout, frame, padding or implicit role", () => {
  const attributes = surfaceAttributes({}, "flex gap-2");
  expect(attributes.className).toBe(`${styles.appearance} flex gap-2`);
  expect(
    Object.entries(attributes).filter(([key, value]) => key !== "className" && value !== undefined),
  ).toEqual([]);
  expect(css).not.toMatch(/\.appearance\s*\{[^}]*(?:display|padding|border:|min-inline-size)/s);
});

const variants: [SurfaceVariant, string][] = [
  ["canvas", "--ui-workspace-canvas"],
  ["workspace-panel", "--ui-workspace-panel"],
  ["canvas-chat", "--ui-workspace-canvas-chat"],
  ["canvas-surface", "--ui-workspace-canvas-surface"],
  ["reading-base", "--ui-workspace-reading-base"],
  ["navigation-quiet", "--ui-navigation-quiet"],
  ["selected", "--ui-surface-selected"],
  ["transparent", "transparent"],
  ["danger", "--ui-surface-danger"],
  ["danger-floating", "--ui-surface-danger-floating"],
  ["translucent", "--ui-surface-translucent"],
  ["effort", "--ui-effort-fill"],
  ["effort-ultra", "--ui-effort-ultra-fill"],
  ["base", "--color-background-base"],
  ["panel", "--ui-surface-panel"],
  ["floating", "--ui-surface-floating"],
  ["fill-subtle", "--ui-fill-subtle"],
];
it.each(variants)("paints %s through the existing semantic ground", (variant, token) => {
  expect(surfaceAttributes({ variant })["data-surface-variant"]).toBe(variant);
  expect(renderToStaticMarkup(createElement(Surface, { variant }))).toContain(
    `data-variant="${variant}"`,
  );
  const block = css.slice(css.indexOf(`.surface[data-variant="${variant}"]`)).split("}")[0];
  expect(block).toContain(token);
  expect(block).not.toMatch(/padding|display|height|opacity/);
});

it.each([
  "none",
  "pane",
  "card",
  "stroke",
  "neutral",
  "settings",
  "frosted",
  "transparent",
  "danger",
  "accent",
  "editor",
] as const)("supports opt-in frame %s", (frame) => {
  expect(surfaceAttributes({ frame })["data-surface-frame"]).toBe(frame);
  expect(renderToStaticMarkup(createElement(Surface, { frame }))).toContain(
    `data-surface-frame="${frame}"`,
  );
  expect(css).toContain(`[data-surface-frame="${frame}"]`);
});

it.each([
  ["transparent", "transparent"],
  ["danger", "var(--ui-tone-danger-border)"],
  ["accent", "var(--ui-tone-accent-border)"],
  ["editor", "var(--ui-editor-border)"],
] as const)("preserves the %s frame colour and reserved geometry", (frame, colour) => {
  const block = css.slice(css.indexOf(`.surface[data-surface-frame="${frame}"]`)).split("}")[0];
  expect(block).toContain(`border: 1px solid ${colour}`);
});

it.each([
  "all",
  "block-start",
  "block-end",
  "inline-start",
  "inline-end",
  "block",
  "inline",
  "top",
  "bottom",
  "left",
  "right",
] as const)("keeps the requested frame edges %s", (edge) => {
  expect(surfaceAttributes({ frame: "pane", edge })["data-surface-edge"]).toBe(edge);
  expect(renderToStaticMarkup(createElement(Surface, { edge }))).toContain(
    `data-surface-edge="${edge}"`,
  );
  if (edge !== "all") expect(css).toContain(`border-${edge}-width: 1px`);
});

it.each(["none", "xs", "sm", "row", "control", "card", "panel", "popup", "pill"] as const)(
  "keeps explicit radius %s separate from layout",
  (radius) => {
    expect(surfaceAttributes({ radius })["data-surface-radius"]).toBe(radius);
    expect(renderToStaticMarkup(createElement(Surface, { radius }))).toContain(
      `data-surface-radius="${radius}"`,
    );
    expect(css).toContain(`[data-surface-radius="${radius}"]`);
  },
);

it("moves a responsive start frame with the owning layout's stacked flag", () => {
  expect(
    surfaceAttributes({ frame: "stroke", edge: "responsive-start" })["data-surface-edge"],
  ).toBe("responsive-start");
  expect(
    renderToStaticMarkup(createElement(Surface, { frame: "stroke", edge: "responsive-start" })),
  ).toContain('data-surface-edge="responsive-start"');
  const block = css
    .slice(css.indexOf('[data-surface-edge="responsive-start"]'))
    .split("}")[0]!
    .replace(/\s+/g, "");
  expect(block).toContain("border-width:0");
  expect(block).toContain(
    "border-inline-start-width:calc((1-var(--surface-frame-stacked,0))*1px*var(--surface-frame-visible,1))",
  );
  expect(block).toContain(
    "border-block-start-width:calc(var(--surface-frame-stacked,0)*1px*var(--surface-frame-visible,1))",
  );
});

it.each(["solid", "dashed"] as const)(
  "supports border style %s without changing width",
  (borderStyle) => {
    const appearance: SurfaceAppearance = { borderStyle };
    expect(surfaceAttributes(appearance)["data-surface-border-style"]).toBe(borderStyle);
    expect(renderToStaticMarkup(createElement(Surface, appearance))).toContain(
      `data-surface-border-style="${borderStyle}"`,
    );
    expect(css).toContain(`border-style: ${borderStyle}`);
  },
);

it("keeps theme recipes exact and derives them from existing grounds", () => {
  expect(roles).toContain("color-mix(insrgb,var(--ui-tone-danger-subtle)45%,var(--ui-surface))");
  expect(roles).toContain(
    "color-mix(insrgb,var(--ui-tone-danger-subtle)45%,var(--ui-surface-floating))",
  );
  expect(roles).toContain("color-mix(inoklab,var(--color-background-base)45%,transparent)");
  expect(roles).not.toMatch(/#[0-9a-f]|rgba?\(/i);
});

it("keeps an icon well at the existing large radius without changing its box", () => {
  expect(surfaceAttributes({ radius: "well" })["data-surface-radius"]).toBe("well");
  const block = css.slice(css.indexOf('[data-surface-radius="well"]')).split("}")[0];
  expect(block).toContain("border-radius: var(--radius-2xl, 1rem)");
  expect(block).not.toMatch(/padding|height|width/);
});

it("draws a circle radius as 50% without a frame or size change", () => {
  expect(surfaceAttributes({ radius: "circle" })["data-surface-radius"]).toBe("circle");
  expect(renderToStaticMarkup(createElement(Surface, { radius: "circle" }))).toContain(
    'data-surface-radius="circle"',
  );
  const block = css.slice(css.indexOf('[data-surface-radius="circle"]')).split("}")[0];
  expect(block).toContain("border-radius: 50%");
  expect(block).not.toMatch(/border(?!-radius)|padding|width|height/);
});

const tones = ["neutral", "accent", "info", "success", "warning", "danger"] as const;
it.each(tones)("paints the %s tone as its subtle fill token only", (tone) => {
  expect(surfaceAttributes({ tone })["data-surface-tone"]).toBe(tone);
  expect(renderToStaticMarkup(createElement(Surface, { tone }))).toContain(
    `data-surface-tone="${tone}"`,
  );
  const block = css.slice(css.indexOf(`[data-surface-tone="${tone}"]`)).split("}")[0];
  expect(block).toContain(`background: var(--ui-tone-${tone}-subtle)`);
  expect(block).not.toMatch(/border|padding|box-shadow/);
});

it.each(tones)("paints the %s tone solid only when toneFill says so", (tone) => {
  expect(surfaceAttributes({ tone, toneFill: "solid" })["data-surface-tone-fill"]).toBe("solid");
  expect(surfaceAttributes({ tone })["data-surface-tone-fill"]).toBeUndefined();
  const block = css
    .slice(css.indexOf(`[data-surface-tone-fill="solid"][data-surface-tone="${tone}"]`))
    .split("}")[0];
  expect(block).toContain(`background: var(--ui-tone-${tone}-solid)`);
});

it("leaves a tone fill undrawn when the caller's state is off", () => {
  const off = surfaceAttributes({ tone: undefined }, "flex");
  expect(off["data-surface-tone"]).toBeUndefined();
});

it("floats a static panel with the shared elevation token", () => {
  expect(surfaceAttributes({ elevation: "floating" })["data-surface-elevation"]).toBe("floating");
  expect(renderToStaticMarkup(createElement(Surface, { elevation: "floating" }))).toContain(
    'data-surface-elevation="floating"',
  );
  expect(css).toContain("box-shadow: var(--ui-elevation-floating)");
});

const rings = [
  ["stroke", "--color-stroke"],
  ["accent", "--ui-border-accent"],
  ["tone-accent", "--ui-tone-accent-border"],
  ["tone-neutral", "--ui-tone-neutral-border"],
] as const;
it.each(rings)("draws the %s ring as an inset one-pixel box-shadow", (ring, token) => {
  expect(surfaceAttributes({ ring })["data-surface-ring"]).toBe(ring);
  expect(renderToStaticMarkup(createElement(Surface, { ring }))).toContain(
    `data-surface-ring="${ring}"`,
  );
  const block = css.slice(css.indexOf(`[data-surface-ring="${ring}"]`)).split("}")[0];
  expect(block).toContain(`box-shadow: inset 0 0 0 1px var(${token})`);
});

it("draws a pane outer ring without adding frame geometry", () => {
  expect(surfaceAttributes({ ring: "pane-outer" })["data-surface-ring"]).toBe("pane-outer");
  const block = css.slice(css.indexOf('[data-surface-ring="pane-outer"]')).split("}")[0];
  expect(block).toContain("box-shadow: 0 0 0 1px var(--ui-pane-border)");
  expect(block).not.toMatch(/border:|padding|height|width/);
});

const bars = [
  ["pane", "--ui-pane-border"],
  ["neutral", "--ui-tone-neutral-border"],
  ["accent", "--ui-border-accent"],
  ["info", "--ui-tone-info-fg"],
  ["success", "--ui-tone-success-border"],
] as const;
it.each(bars)("draws the %s bar on the inline-start edge only", (bar, token) => {
  expect(surfaceAttributes({ bar })["data-surface-bar"]).toBe(bar);
  expect(renderToStaticMarkup(createElement(Surface, { bar }))).toContain(
    `data-surface-bar="${bar}"`,
  );
  const block = css.slice(css.indexOf(`[data-surface-bar="${bar}"]`)).split("}")[0];
  expect(block).toContain(`border-inline-start: 2px solid var(${token})`);
  expect(block).not.toMatch(/border-(block|top|bottom|left|right|inline-end)|border: /);
});

it("keeps the new roles out of the default render", () => {
  expect(renderToStaticMarkup(createElement(Surface, null, "body"))).not.toMatch(
    /data-surface-(tone|elevation|ring|bar)/,
  );
});

it("supports the pane divider token without changing stroke or card", () => {
  expect(surfaceAttributes({ dividers: "pane" })["data-surface-dividers"]).toBe("pane");
  expect(css).toMatch(
    /\[data-surface-dividers="pane"\][^{]*\{[^}]*border-color: var\(--ui-pane-border\)/,
  );
});

it("uses the settings group border for settings group dividers", () => {
  expect(surfaceAttributes({ dividers: "settings-group" })["data-surface-dividers"]).toBe(
    "settings-group",
  );
  expect(css).toMatch(
    /\[data-surface-dividers="settings-group"\][^{]*\{[^}]*border-color: var\(--ui-settings-group-border\)/,
  );
});

it("supports opt-in mixed settings rows and nested advanced boundaries", () => {
  expect(surfaceAttributes({ layout: "settings-group" })["data-surface-layout"]).toBe(
    "settings-group",
  );
  expect(css).toContain('[data-surface-layout="settings-group"]');
  expect(css).toContain('data-settings-part="advanced-content"');
  expect(css).toContain("border-block-start: 1px solid var(--ui-settings-hairline)");
  expect(css).toContain("calc(var(--ui-radius-card) - 0.0625rem)");
});

it("supports a combined logical start corner frame", () => {
  expect(surfaceAttributes({ frame: "pane", edge: "start" })["data-surface-edge"]).toBe("start");
  expect(css).toMatch(
    /\[data-surface-edge="start"\][^{]*\{[^}]*border-width: 0;[^}]*border-block-start-width: 1px;[^}]*border-inline-start-width: 1px/s,
  );
});

it("provides the faint fill without changing other surface variants", () => {
  expect(surfaceAttributes({ variant: "fill-faint" })["data-surface-variant"]).toBe("fill-faint");
  expect(css).toMatch(
    /\[data-surface-variant="fill-faint"\][^{]*\{[^}]*background: var\(--ui-fill-faint\)/,
  );
});

it("preserves subtle work item metadata fill and divider", () => {
  expect(
    surfaceAttributes({ variant: "neutral-metadata", frame: "neutral-metadata" })[
      "data-surface-variant"
    ],
  ).toBe("neutral-metadata");
  expect(css.replace(/\s/g, "")).toContain(
    "background:color-mix(inoklab,var(--ui-tone-neutral-solid)4.5%,transparent)",
  );
  expect(css.replace(/\s/g, "")).toContain(
    "border:1pxsolidcolor-mix(inoklab,var(--ui-tone-neutral-border)7%,transparent)",
  );
});

it("rounds the top of a dock while leaving its bottom square", () => {
  expect(surfaceAttributes({ radius: "dock-top" })["data-surface-radius"]).toBe("dock-top");
  expect(css).toMatch(
    /\[data-surface-radius="dock-top"\][^{]*\{[^}]*border-radius: var\(--radius-xl\) var\(--radius-xl\) 0 0/,
  );
});

it("supports the 1.5px base cutout frame", () => {
  expect(surfaceAttributes({ frame: "base-cutout" })["data-surface-frame"]).toBe("base-cutout");
  expect(css).toMatch(
    /\[data-surface-frame="base-cutout"\][^{]*\{[^}]*border: 1\.5px solid var\(--color-background-base\)/,
  );
});

it("supports an inset keyboard focus ring on a scrollable surface", () => {
  expect(surfaceAttributes({ focusRing: "inset" })["data-surface-focus-ring"]).toBe("inset");
  expect(css).toMatch(
    /\[data-surface-focus-ring="inset"\]:focus-visible[^{}]*\{[^}]*outline: 2px solid var\(--ui-focus-ring-color\);[^}]*outline-offset: -2px/s,
  );
});

it("keeps activity dock glass and opaque accessibility fallbacks", () => {
  expect(surfaceAttributes({ variant: "activity-dock" })["data-surface-variant"]).toBe(
    "activity-dock",
  );
  expect(css).toContain("var(--ui-activity-dock-glass)");
  expect(css).toContain("var(--ui-activity-dock-filter)");
  expect(css).toContain("[data-performance-no-blur]");
  expect(css).toContain('[data-session-streaming="true"]');
  expect(css).toContain("(prefers-reduced-transparency: reduce)");
});

it("keeps an explicit card frame on button surfaces", () => {
  expect(css).toMatch(
    /button\.appearance\[data-surface-frame="card"\][^{]*\{[^}]*border: 1px solid var\(--ui-card-border\)/,
  );
});

it("supports the field radius and flat settings group corners", () => {
  expect(
    surfaceAttributes({ radius: "field", layout: "settings-group-flat" })["data-surface-radius"],
  ).toBe("field");
  expect(css).toMatch(
    /\[data-surface-radius="field"\][^{]*\{[^}]*border-radius: var\(--radius-control\)/,
  );
  expect(css).toContain('data-surface-layout="settings-group-flat"');
});

it("supports pane-to-stroke responsive physical left boundaries", () => {
  const attrs = surfaceAttributes({ frame: "pane-stroke", edge: "responsive-left" });
  expect(attrs["data-surface-frame"]).toBe("pane-stroke");
  expect(attrs["data-surface-edge"]).toBe("responsive-left");
  expect(css).toContain("border-left-color: var(--ui-pane-border)");
  expect(css).toContain("border-top-color: var(--color-stroke)");
  expect(css).toContain('[data-surface-edge="responsive-left"]');
});

it("supports workspace reading panels and transparency checkerboards", () => {
  expect(surfaceAttributes({ variant: "reading-panel" })["data-surface-variant"]).toBe(
    "reading-panel",
  );
  expect(surfaceAttributes({ variant: "transparency-grid" })["data-surface-variant"]).toBe(
    "transparency-grid",
  );
  expect(css).toContain("background: var(--ui-workspace-reading-panel)");
  expect(css).toContain("background-image: var(--ui-transparency-grid-image)");
  expect(css).toContain("background-size: 16px 16px");
  expect(css.replace(/\s/g, "")).toContain("background-position:00,8px8px");
});

it("preserves composer glass and forced-colors opaque fallback", () => {
  expect(surfaceAttributes({ variant: "composer-glass" })["data-surface-variant"]).toBe(
    "composer-glass",
  );
  expect(css).toContain('data-surface-variant="composer-glass"');
  expect(css).toContain("var(--ui-composer-surface)");
  expect(css).toContain("(forced-colors: active)");
});

it("outlines a selected document cell without altering focus state", () => {
  expect(surfaceAttributes({ selectionRing: "document" })["data-surface-selection-ring"]).toBe(
    "document",
  );
  expect(css).toMatch(
    /\[data-surface-selection-ring="document"\]\[aria-selected="true"\][^{]*\{[^}]*outline: 2px solid var\(--color-accent, currentColor\);[^}]*outline-offset: -2px/s,
  );
});

it("supports pane hairlines between adjacent opted-in rows", () => {
  expect(surfaceAttributes({ separator: "pane-block" })["data-surface-separator"]).toBe(
    "pane-block",
  );
  expect(css).toMatch(
    /\[data-surface-separator="pane-block"\][^{]*\{[^}]*border-block-start: 1px solid var\(--ui-pane-border\)/,
  );
});

it("supports adjacent settings rows without group corners", () => {
  expect(surfaceAttributes({ layout: "settings-rows" })["data-surface-layout"]).toBe(
    "settings-rows",
  );
  expect(css).toContain('data-surface-layout="settings-rows"');
});

it("supports account-list dividers without dividing empty-to-editor", () => {
  expect(surfaceAttributes({ layout: "settings-account-list" })["data-surface-layout"]).toBe(
    "settings-account-list",
  );
  expect(css).toContain('data-surface-layout="settings-account-list"');
  expect(css).toContain('data-settings-part="account-empty"');
});
it("allows responsive start frame to be hidden by the owning layout", () => {
  const block = css.slice(css.indexOf('[data-surface-edge="responsive-start"]')).split("}")[0];
  expect(block).toContain("var(--surface-frame-visible, 1)");
});

it.each([
  ["neutral-hover", "--ui-tone-neutral-hover"],
  ["info-foreground", "--ui-tone-info-fg"],
] as const)("uses existing %s fill", (variant, token) => {
  expect(surfaceAttributes({ variant })["data-surface-variant"]).toBe(variant);
  expect(css).toMatch(
    new RegExp(`\\[data-surface-variant="${variant}"\\][^{]*\\{[^}]*background: var\\(${token}\\)`),
  );
});
it("frames a detaching surface with the existing focus color", () => {
  expect(surfaceAttributes({ frame: "focus" })["data-surface-frame"]).toBe("focus");
  expect(css).toMatch(
    /\[data-surface-frame="focus"\][^{]*\{[^}]*border: 1px solid var\(--ui-focus-ring-color\)/,
  );
});

it("keeps a sticky top mask in the base background without adding layout", () => {
  expect(surfaceAttributes({ elevation: "sticky-mask" })["data-surface-elevation"]).toBe(
    "sticky-mask",
  );
  const block = css.slice(css.indexOf('[data-surface-elevation="sticky-mask"]')).split("}")[0];
  expect(block).toContain("box-shadow: 0 -4px 0 0 var(--color-background-base)");
  expect(block).not.toMatch(/padding|margin|height|display/);
});

it("supports responsive end frames and muted marker frames", () => {
  expect(surfaceAttributes({ frame: "muted", edge: "responsive-end" })["data-surface-edge"]).toBe(
    "responsive-end",
  );
  expect(css).toMatch(
    /\[data-surface-frame="muted"\][^{]*\{[^}]*border: 1px solid var\(--ui-text-muted\)/,
  );
  const block = css.slice(css.indexOf('[data-surface-edge="responsive-end"]')).split("}")[0];
  expect(block).toContain("border-inline-end-width");
  expect(block).toContain("border-block-end-width");
  expect(block).toContain("--surface-frame-stacked");
});

it("supports an example quote's user-accent bar and right control corners", () => {
  const attrs = surfaceAttributes({ bar: "user-accent", radius: "right-control" });
  expect(attrs["data-surface-bar"]).toBe("user-accent");
  expect(attrs["data-surface-radius"]).toBe("right-control");
  expect(css).toMatch(
    /\[data-surface-bar="user-accent"\][^{]*\{[^}]*border-inline-start: 2px solid var\(--accent\)/,
  );
  expect(css).toMatch(
    /\[data-surface-radius="right-control"\][^{]*\{[^}]*border-radius: 0 var\(--radius-control\) var\(--radius-control\) 0/,
  );
});

it.each([
  [
    "attachment",
    "color-mix(in srgb, var(--ui-attachment-ink, var(--ui-tone-accent-fg)) 14%, transparent)",
  ],
  ["accent-marker", "var(--color-accent)"],
  ["selection", "var(--color-selection)"],
] as const)("preserves %s existing consumer fill", (variant, value) => {
  expect(surfaceAttributes({ variant })["data-surface-variant"]).toBe(variant);
  const block = css.slice(css.indexOf(`[data-surface-variant="${variant}"]`)).split("}")[0];
  expect(block.replace(/\s/g, "")).toContain(`background:${value}`.replace(/\s/g, ""));
});
it("preserves the two-pixel base outer cutout", () => {
  expect(surfaceAttributes({ ring: "base-outer" })["data-surface-ring"]).toBe("base-outer");
  const block = css.slice(css.indexOf('[data-surface-ring="base-outer"]')).split("}")[0];
  expect(block).toContain("box-shadow: 0 0 0 2px var(--color-background-base)");
});

it("supports token-based inset focus for interactive previews", () => {
  expect(surfaceAttributes({ focusRing: "preview-inset" })["data-surface-focus-ring"]).toBe(
    "preview-inset",
  );
  expect(css).toMatch(
    /\[data-surface-focus-ring="preview-inset"\]:focus-visible[^{}]*\{[^}]*outline: var\(--ui-focus-width\) solid var\(--ui-focus-ring-color\);[^}]*outline-offset: calc\(var\(--ui-focus-offset\) \* -1\)/s,
  );
});

it("supports an outer focus outline for the gradient dial", () => {
  expect(surfaceAttributes({ focusRing: "outer" })["data-surface-focus-ring"]).toBe("outer");
  expect(css).toMatch(
    /\[data-surface-focus-ring="outer"\]:focus-visible[^{}]*\{[^}]*outline: var\(--ui-focus-width\) solid var\(--ui-focus-ring-color\);[^}]*outline-offset: 2px/s,
  );
});

it("frames color stops with the strong content boundary", () => {
  expect(surfaceAttributes({ frame: "content-strong" })["data-surface-frame"]).toBe(
    "content-strong",
  );
  expect(css).toMatch(
    /\[data-surface-frame="content-strong"\][^{]*\{[^}]*border: 2px solid var\(--color-content\)/s,
  );
});

it.each([
  ["on-solid", "--color-on-solid"],
  ["user-color", "--surface-user-color"],
] as const)("supports %s static ground", (variant, token) => {
  expect(surfaceAttributes({ variant })["data-surface-variant"]).toBe(variant);
  expect(css).toContain(`background: var(${token});`);
});

it.each(["chat-start", "chat-end"] as const)("preserves %s message corner roles", (radius) => {
  expect(surfaceAttributes({ radius })["data-surface-radius"]).toBe(radius);
  expect(css).toContain(`[data-surface-radius="${radius}"]`);
});

it("supports the settings preview corner", () => {
  expect(surfaceAttributes({ radius: "preview" })["data-surface-radius"]).toBe("preview");
  expect(css).toMatch(
    /\[data-surface-radius="preview"\][^{]*\{[^}]*border-radius: var\(--ui-preview-card-radius\)/s,
  );
});

it.each(["chat-control-start", "chat-control-end"] as const)(
  "preserves %s message corner role",
  (radius) => {
    expect(surfaceAttributes({ radius })["data-surface-radius"]).toBe(radius);
    expect(css).toContain(`[data-surface-radius="${radius}"]`);
  },
);

it("supports settings search reveal and marked provider sibling boundaries", () => {
  expect(surfaceAttributes({ reveal: "row" })["data-surface-reveal"]).toBe("row");
  expect(css).toContain('[data-settings-part="account-list"]:not([hidden])');
  expect(css).toContain('[data-settings-part="narrow-picker"]');
  expect(css).toContain("settings-surface-reveal");
  expect(css).toContain("var(--ui-surface-selected)");
});

it("uses terminal border for terminal splits", () => {
  expect(surfaceAttributes({ frame: "terminal" })["data-surface-frame"]).toBe("terminal");
  expect(css).toMatch(
    /\[data-surface-frame="terminal"\][^{]*\{[^}]*border: 1px solid var\(--terminal-border\)/s,
  );
});

it("divides neutral evidence rows using the neutral boundary token", () => {
  expect(surfaceAttributes({ dividers: "neutral" })["data-surface-dividers"]).toBe("neutral");
  expect(css).toMatch(
    /\[data-surface-dividers="neutral"\][^{]*\{[^}]*border-color: var\(--ui-tone-neutral-border\)/s,
  );
});

it("supports evidence rails and marked source lines", () => {
  expect(
    surfaceAttributes({
      variant: "neutral-boundary",
      frame: "neutral-marker",
      bar: "diagnostic-danger",
    }),
  ).toMatchObject({
    "data-surface-variant": "neutral-boundary",
    "data-surface-frame": "neutral-marker",
    "data-surface-bar": "diagnostic-danger",
  });
  expect(css).toContain("border-left: 2px solid var(--ui-tone-danger-border)");
  expect(css).toContain("border: 1.5px solid var(--ui-tone-neutral-border)");
});

it.each([
  ["drop-line", "--ui-drop-line"],
  ["drop-blocked", "--ui-drop-blocked"],
] as const)("supports %s pane drop indicator", (variant, token) => {
  expect(surfaceAttributes({ variant })["data-surface-variant"]).toBe(variant);
  expect(css).toContain(`background: var(${token});`);
});

it.each([
  ["diff-add", "--color-diff-add"],
  ["diff-delete", "--color-diff-del"],
] as const)("uses %s measurement fill", (variant, token) => {
  expect(surfaceAttributes({ variant })["data-surface-variant"]).toBe(variant);
  expect(css).toContain(`background: var(${token});`);
});
it("uses base ground only while layout requests an overlay", () => {
  expect(surfaceAttributes({ variant: "adaptive-base" })["data-surface-variant"]).toBe(
    "adaptive-base",
  );
  expect(css).toContain("--surface-base-visible");
});

it("preserves the panel-colored two-pixel face cutout", () => {
  expect(surfaceAttributes({ ring: "panel-outer" })["data-surface-ring"]).toBe("panel-outer");
  expect(css).toContain("box-shadow: 0 0 0 2px var(--ui-surface-panel)");
});
