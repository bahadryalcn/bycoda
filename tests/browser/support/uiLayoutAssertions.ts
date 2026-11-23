import { expect, type Page } from "@playwright/test";

/**
 * Reusable runtime layout contracts for the browser suites (UI hardening §2 "Runtime/browser
 * acceptance"). Every assertion is bound to a NAMED surface and reports `surface [check] detail`.
 * A contract is never weakened: a surface that legitimately differs declares a narrow exception
 * (a selector plus a written reason) and the exception only silences that one check.
 *
 * Checks:
 * - overflow: a constrained root (overflow hidden/clip) whose scroll size exceeds its client size
 *   by more than 1 CSS px, and a document wider than the window.
 * - clip: an actionable element or text leaf cut off by a clipping ancestor (hidden/clip).
 * - overlap: two unrelated actionable siblings whose rectangles intersect by more than 1 px, and an
 *   actionable element whose centre is covered by something that is not part of it.
 * - gap: independent adjacent controls keep 8 px, a glyph keeps 4 px from its label, members of a
 *   declared joined group touch (0 px). Tolerance is 1 px.
 * - message: one failed operation shows one visible message and is announced once.
 */

export type Theme = "light" | "dark";
export const THEMES: readonly Theme[] = ["light", "dark"];
/** Window widths that surround the 320 px pane. */
export const WINDOW_WIDTHS = [800, 1280] as const;
export const PANE_WIDTH = 320;
export const PANE_MATRIX = THEMES.flatMap((theme) =>
  WINDOW_WIDTHS.map((width) => ({ theme, width })),
);

/** A narrow, documented exception. `selector` matches the element itself or an ancestor. */
export type LayoutException = { selector: string; reason: string };

export type LayoutCheck = "overflow" | "clip" | "overlap" | "gap";

export type LayoutSurface = {
  /** Human name of the surface under test; every failure message starts with it. */
  surface: string;
  /** Root of the measured subtree. Defaults to the whole body. */
  root?: string;
  /** Checks to run. Defaults to all four. */
  checks?: readonly LayoutCheck[];
  /** Gap axis: "row" (default) along visual lines, "column" for stacks, "both". */
  axis?: "row" | "column" | "both";
  /** Elements whose members are a joined group (gap 0). */
  joined?: string;
  /**
   * Intentional exceptions, one list per check. `overflow` names code/table/terminal hosts that
   * scroll on purpose; the others name the exact elements involved.
   */
  allow?: Partial<Record<LayoutCheck, readonly LayoutException[]>>;
};

export type PaneOptions = {
  theme: Theme;
  width: number;
  /** Selector of the element that becomes the 320 px pane. */
  pane: string;
  height?: number;
};

/** Theme class used by the fixtures (`theme-light` on the document root, dark otherwise). */
export async function applyTheme(page: Page, theme: Theme) {
  await page.evaluate(
    (light) => document.documentElement.classList.toggle("theme-light", light),
    theme === "light",
  );
}

/** Waits for fonts and two animation frames so geometry is measured after layout settled. */
export async function settleLayout(page: Page) {
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    );
  });
}

/**
 * Sizes the window, applies the theme and pins `pane` to a real 320 px box. The pane is a flex
 * item of the fixture, so its own children measure against 320 px while the window stays wide.
 */
export async function openPane(page: Page, options: PaneOptions) {
  await page.setViewportSize({ width: options.width, height: options.height ?? 900 });
  await applyTheme(page, options.theme);
  await page.locator(options.pane).first().waitFor({ state: "visible" });
  await page.evaluate(
    ({ pane, width }) => {
      const node = document.querySelector<HTMLElement>(pane);
      if (!node) throw new Error(`Pane ${pane} is missing`);
      node.style.boxSizing = "border-box";
      node.style.flex = "none";
      node.style.width = `${width}px`;
      node.style.minWidth = `${width}px`;
      node.style.maxWidth = `${width}px`;
    },
    { pane: options.pane, width: PANE_WIDTH },
  );
  await settleLayout(page);
  const measured = await page.locator(options.pane).first().boundingBox();
  expect(measured?.width, `pane ${options.pane} is a real ${PANE_WIDTH}px box`).toBeCloseTo(
    PANE_WIDTH,
    0,
  );
}

type Violation = { check: LayoutCheck | "root"; detail: string };

function requireReasons(surface: LayoutSurface) {
  for (const [check, list] of Object.entries(surface.allow ?? {}))
    for (const entry of list ?? [])
      if (!entry.selector.trim() || entry.reason.trim().length < 8)
        throw new Error(
          `${surface.surface}: the ${check} exception "${entry.selector}" needs a written reason`,
        );
}

/** Collects every violation of the requested checks for one surface. Does not assert. */
export async function collectLayoutViolations(page: Page, surface: LayoutSurface) {
  requireReasons(surface);
  const args = {
    root: surface.root ?? "body",
    checks: surface.checks ?? (["overflow", "clip", "overlap", "gap"] as const),
    axis: surface.axis ?? "row",
    joined: surface.joined ?? "[data-joined], [data-ui-joined], [data-segmented]",
    allow: {
      overflow: surface.allow?.overflow?.map((entry) => entry.selector) ?? [],
      clip: surface.allow?.clip?.map((entry) => entry.selector) ?? [],
      overlap: surface.allow?.overlap?.map((entry) => entry.selector) ?? [],
      gap: surface.allow?.gap?.map((entry) => entry.selector) ?? [],
    },
  };
  return page.evaluate((input): Violation[] => {
    const root = document.querySelector<HTMLElement>(input.root);
    if (!root) return [{ check: "root", detail: `root ${input.root} is missing` }];
    const out: Violation[] = [];
    const ACTIONABLE =
      'a[href], button, input:not([type="hidden"]), select, textarea, summary, [role="button"], [role="link"], [role="menuitem"], [role="menuitemcheckbox"], [role="menuitemradio"], [role="tab"], [role="switch"], [role="checkbox"], [role="radio"], [role="combobox"], [role="slider"], [tabindex]:not([tabindex="-1"])';
    const allowed = (el: Element, check: LayoutCheck) =>
      input.allow[check].some((selector) => el.closest(selector));
    const label = (el: Element) => {
      const name =
        el.getAttribute("aria-label") ??
        el.getAttribute("data-testid") ??
        (el.textContent ?? "").trim().replace(/\s+/g, " ").slice(0, 32);
      return `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ""}[${name}]`;
    };
    const rendered = (el: Element) => {
      const style = getComputedStyle(el);
      if (style.display === "none" || style.visibility === "hidden") return false;
      if (Number(style.opacity) === 0) return false;
      if (el.closest('[inert], [aria-hidden="true"]')) return false;
      const rect = el.getBoundingClientRect();
      return rect.width > 2 && rect.height > 2;
    };
    const clips = (style: CSSStyleDeclaration) =>
      ["hidden", "clip"].includes(style.overflowX) || ["hidden", "clip"].includes(style.overflowY);
    const scrolls = (style: CSSStyleDeclaration) =>
      ["auto", "scroll"].includes(style.overflowX) || ["auto", "scroll"].includes(style.overflowY);
    /** Rectangle intersected with every clipping or scrolling ancestor; null when nothing shows. */
    const visibleRect = (el: Element) => {
      let { left, top, right, bottom } = el.getBoundingClientRect();
      let parent = el.parentElement;
      while (parent && parent !== document.documentElement) {
        const style = getComputedStyle(parent);
        if (clips(style) || scrolls(style)) {
          const box = parent.getBoundingClientRect();
          left = Math.max(left, box.left);
          top = Math.max(top, box.top);
          right = Math.min(right, box.right);
          bottom = Math.min(bottom, box.bottom);
        }
        parent = parent.parentElement;
      }
      return right - left > 2 && bottom - top > 2 ? { left, top, right, bottom } : null;
    };

    const all = [root, ...root.querySelectorAll<HTMLElement>("*")];
    const candidates = [...root.querySelectorAll<HTMLElement>(ACTIONABLE)]
      .filter((el) => rendered(el))
      .filter((el, _, list) => !list.some((other) => other !== el && other.contains(el)));

    if (input.checks.includes("overflow")) {
      if (input.root === "body" && document.documentElement.scrollWidth > innerWidth + 1)
        out.push({
          check: "overflow",
          detail: `document scrolls horizontally (${document.documentElement.scrollWidth} > ${innerWidth})`,
        });
      for (const el of all) {
        const style = getComputedStyle(el);
        if (!clips(style) || style.textOverflow === "ellipsis" || !rendered(el)) continue;
        if (allowed(el, "overflow")) continue;
        if (style.webkitLineClamp !== "none" && style.webkitLineClamp !== "") continue;
        if (
          ["hidden", "clip"].includes(style.overflowX) &&
          el.scrollWidth > el.clientWidth + 1
        )
          out.push({
            check: "overflow",
            detail: `${label(el)} scrollWidth ${el.scrollWidth} > clientWidth ${el.clientWidth}`,
          });
        if (
          ["hidden", "clip"].includes(style.overflowY) &&
          el.clientHeight > 0 &&
          el.scrollHeight > el.clientHeight + 1
        )
          out.push({
            check: "overflow",
            detail: `${label(el)} scrollHeight ${el.scrollHeight} > clientHeight ${el.clientHeight}`,
          });
      }
    }

    if (input.checks.includes("clip")) {
      const leaves = all.filter(
        (el) =>
          [...el.childNodes].some(
            (node) => node.nodeType === Node.TEXT_NODE && node.textContent?.trim(),
          ) && !el.matches(ACTIONABLE),
      );
      for (const el of [...candidates, ...leaves]) {
        if (!rendered(el) || allowed(el, "clip")) continue;
        const box = el.getBoundingClientRect();
        const position = getComputedStyle(el).position;
        if (position === "fixed") continue;
        let parent = el.parentElement;
        // An absolutely positioned element escapes ancestors between it and its containing block.
        if (position === "absolute") {
          const containing = (el as HTMLElement).offsetParent;
          while (parent && parent !== containing) parent = parent.parentElement;
        }
        let ellipsis = getComputedStyle(el).textOverflow === "ellipsis";
        for (; parent && parent !== document.documentElement; parent = parent.parentElement) {
          const style = getComputedStyle(parent);
          if (style.textOverflow === "ellipsis" || style.webkitLineClamp !== "none")
            ellipsis = true;
          if (!clips(style) || scrolls(style)) continue;
          const bounds = parent.getBoundingClientRect();
          const cut =
            (["hidden", "clip"].includes(style.overflowX) &&
              (box.right > bounds.right + 1 || box.left < bounds.left - 1)) ||
            (["hidden", "clip"].includes(style.overflowY) &&
              (box.bottom > bounds.bottom + 1 || box.top < bounds.top - 1));
          // Truncated labels are an intentional, readable-by-tooltip contract; actions never are.
          if (cut && !(ellipsis && !el.matches(ACTIONABLE))) {
            out.push({ check: "clip", detail: `${label(el)} is cut off by ${label(parent)}` });
            break;
          }
        }
      }
    }

    if (input.checks.includes("overlap")) {
      const boxes = candidates.map((el) => ({ el, rect: visibleRect(el) }));
      for (let i = 0; i < boxes.length; i++) {
        const a = boxes[i];
        if (!a.rect) continue;
        for (let j = i + 1; j < boxes.length; j++) {
          const b = boxes[j];
          if (!b.rect || a.el.contains(b.el) || b.el.contains(a.el)) continue;
          if (allowed(a.el, "overlap") || allowed(b.el, "overlap")) continue;
          const width = Math.min(a.rect.right, b.rect.right) - Math.max(a.rect.left, b.rect.left);
          const height = Math.min(a.rect.bottom, b.rect.bottom) - Math.max(a.rect.top, b.rect.top);
          if (width > 1 && height > 1)
            out.push({
              check: "overlap",
              detail: `${label(a.el)} overlaps ${label(b.el)} by ${width.toFixed(1)}x${height.toFixed(1)}`,
            });
        }
        if (allowed(a.el, "overlap")) continue;
        // Hit-test the centre: another control or surface sitting on top makes it unreachable.
        const x = (a.rect.left + a.rect.right) / 2;
        const y = (a.rect.top + a.rect.bottom) / 2;
        if (x < 0 || y < 0 || x > innerWidth || y > innerHeight) continue;
        const top = document.elementFromPoint(x, y);
        const labelled = a.el.closest("label");
        if (
          top &&
          !a.el.contains(top) &&
          !top.contains(a.el) &&
          !(labelled && labelled.contains(top))
        )
          out.push({ check: "overlap", detail: `${label(a.el)} is covered by ${label(top)}` });
      }
    }

    if (input.checks.includes("gap")) {
      type Box = { el: HTMLElement; rect: { left: number; top: number; right: number; bottom: number } };
      const boxes: Box[] = [];
      for (const el of candidates) {
        const rect = visibleRect(el);
        if (rect) boxes.push({ el, rect });
      }
      const joinedOf = (el: Element) => el.closest(input.joined);
      const check = (a: Box, b: Box, gap: number, axis: string) => {
        if (gap < -1 && !(joinedOf(a.el) && joinedOf(a.el) === joinedOf(b.el))) return;
        if (allowed(a.el, "gap") || allowed(b.el, "gap")) return;
        const group = joinedOf(a.el);
        if (group && group === joinedOf(b.el)) {
          if (Math.abs(gap) > 1)
            out.push({
              check: "gap",
              detail: `${axis} ${label(a.el)} -> ${label(b.el)} in a joined group is ${gap.toFixed(1)}px, expected 0`,
            });
          return;
        }
        if (gap < 7)
          out.push({
            check: "gap",
            detail: `${axis} ${label(a.el)} -> ${label(b.el)} are ${gap.toFixed(1)}px apart, expected 8`,
          });
      };
      if (input.axis !== "column") {
        const used = new Set<number>();
        const byTop = boxes.map((entry, index) => ({ ...entry, index })).sort(
          (x, y) => x.rect.top - y.rect.top,
        );
        for (const first of byTop) {
          if (used.has(first.index)) continue;
          const line = byTop.filter((entry) => {
            const center = (entry.rect.top + entry.rect.bottom) / 2;
            return !used.has(entry.index) && center >= first.rect.top && center <= first.rect.bottom;
          });
          for (const entry of line) used.add(entry.index);
          line.sort((x, y) => x.rect.left - y.rect.left);
          for (let i = 1; i < line.length; i++)
            check(line[i - 1], line[i], line[i].rect.left - line[i - 1].rect.right, "row");
        }
      }
      if (input.axis !== "row") {
        const used = new Set<number>();
        const byLeft = boxes.map((entry, index) => ({ ...entry, index })).sort(
          (x, y) => x.rect.left - y.rect.left,
        );
        for (const first of byLeft) {
          if (used.has(first.index)) continue;
          const column = byLeft.filter((entry) => {
            const overlap =
              Math.min(entry.rect.right, first.rect.right) -
              Math.max(entry.rect.left, first.rect.left);
            const narrow = Math.min(
              entry.rect.right - entry.rect.left,
              first.rect.right - first.rect.left,
            );
            return !used.has(entry.index) && overlap > narrow / 2;
          });
          for (const entry of column) used.add(entry.index);
          column.sort((x, y) => x.rect.top - y.rect.top);
          for (let i = 1; i < column.length; i++)
            check(column[i - 1], column[i], column[i].rect.top - column[i - 1].rect.bottom, "column");
        }
      }
      // Glyph to label: the icon and its text inside one control sit 4 px apart.
      for (const { el } of boxes) {
        if (allowed(el, "gap")) continue;
        const glyph = [...el.querySelectorAll<Element>("svg, img")].find((node) => rendered(node));
        if (!glyph) continue;
        const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
        let text: Range | null = null;
        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
          if (!node.textContent?.trim() || glyph.contains(node)) continue;
          text = document.createRange();
          text.selectNodeContents(node);
          break;
        }
        if (!text) continue;
        const g = glyph.getBoundingClientRect();
        const t = text.getBoundingClientRect();
        if (t.width === 0 || Math.min(g.bottom, t.bottom) - Math.max(g.top, t.top) <= 0) continue;
        const gap = g.right <= t.left + 1 ? t.left - g.right : g.left >= t.right - 1 ? g.left - t.right : null;
        if (gap !== null && Math.abs(gap - 4) > 1)
          out.push({
            check: "gap",
            detail: `glyph -> label in ${label(el)} is ${gap.toFixed(1)}px, expected 4`,
          });
      }
    }
    return out;
  }, args);
}

/** Asserts every requested layout contract for one named surface. */
export async function expectLayoutContracts(page: Page, surface: LayoutSurface) {
  await settleLayout(page);
  const violations = await collectLayoutViolations(page, surface);
  expect(
    violations.map((entry) => `${surface.surface} [${entry.check}] ${entry.detail}`),
    `${surface.surface} keeps its layout contracts`,
  ).toEqual([]);
}

export type FailureMessage = {
  surface: string;
  /** Exact visible copy of the failure. */
  message: string;
  /** How many distinct operations produced it (each keeps its own action). Defaults to 1. */
  expected?: number;
  /** Scope of the search. Defaults to the body, so portals and toasts count too. */
  scope?: string;
  /** History records stay silent: elements inside these selectors are not counted. */
  history?: readonly string[];
};

/** Counts visible elements that show `message`, counting the deepest element only. */
export async function countVisibleMessages(page: Page, options: FailureMessage) {
  return page.evaluate(
    ({ message, scope, history }) => {
      const root = document.querySelector(scope) ?? document.body;
      const normalize = (value: string | null) => (value ?? "").replace(/\s+/g, " ").trim();
      const hit = (el: Element) => normalize(el.textContent).includes(message);
      const shown = (el: Element) => {
        const style = getComputedStyle(el);
        const rect = el.getBoundingClientRect();
        return (
          style.display !== "none" &&
          style.visibility !== "hidden" &&
          Number(style.opacity) > 0 &&
          rect.width > 0 &&
          rect.height > 0 &&
          !el.closest('[aria-hidden="true"], [inert]') &&
          !history.some((selector) => el.closest(selector))
        );
      };
      return [...root.querySelectorAll("*")].filter(
        (el) => hit(el) && shown(el) && ![...el.children].some((child) => hit(child)),
      ).length;
    },
    { message: options.message, scope: options.scope ?? "body", history: options.history ?? [] },
  );
}

/** One failed operation shows its message once across form, transcript and portal/toast. */
export async function expectFailureShownOnce(page: Page, options: FailureMessage) {
  const expected = options.expected ?? 1;
  await expect
    .poll(() => countVisibleMessages(page, options), {
      message: `${options.surface} shows "${options.message}" ${expected}x`,
    })
    .toBe(expected);
}

/** Starts counting live-region insertions that mention `message`. Call before the failure. */
export async function watchAnnouncements(page: Page, message: string) {
  await page.evaluate((text) => {
    const w = window as unknown as { __announced?: string[] };
    w.__announced = [];
    const LIVE = '[role="alert"], [role="status"], [role="log"], [aria-live]:not([aria-live="off"])';
    const normalize = (value: string | null) => (value ?? "").replace(/\s+/g, " ").trim();
    new MutationObserver((records) => {
      for (const record of records) {
        const nodes =
          record.type === "characterData"
            ? [record.target.parentElement]
            : [...record.addedNodes].map((node) =>
                node instanceof Element ? node : node.parentElement,
              );
        for (const node of nodes) {
          if (!node || !normalize(node.textContent).includes(text)) continue;
          const region = node.closest(LIVE) ?? node.querySelector(LIVE);
          if (region && normalize(region.textContent).includes(text))
            w.__announced!.push(normalize(region.textContent));
        }
      }
    }).observe(document.body, { subtree: true, childList: true, characterData: true });
  }, message);
}

/** Each distinct operation announces once; history and rerenders add no announcement. */
export async function expectAnnouncedOnce(page: Page, surface: string, expected = 1) {
  await settleLayout(page);
  const announced = await page.evaluate(
    () => (window as unknown as { __announced?: string[] }).__announced ?? [],
  );
  expect(announced.length, `${surface} announces ${expected}x: ${JSON.stringify(announced)}`).toBe(
    expected,
  );
}
