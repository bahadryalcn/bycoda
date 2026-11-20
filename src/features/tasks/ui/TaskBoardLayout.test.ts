import { expect, it } from "vitest";
import { readFileSync } from "node:fs";

const read = (file: string) => readFileSync(new URL(file, import.meta.url), "utf8");
const goalsCss = read("./task-goals.css");
const opsCss = read("./task-ops.css");
const shellCss = read("./tasks-shell.css");
const boardCss = read("./task-board.css");
const columnsSource = read("./TaskBoardColumns.tsx");

/** The declarations of the first rule whose selector text is exactly `selector`. */
function block(css: string, selector: string): string {
  const start = css.indexOf(`${selector} {`);
  if (start < 0) throw new Error(`Missing rule ${selector}`);
  return css.slice(start, css.indexOf("}", start));
}

/** The declarations of the first rule for `selector`. */
function rule(css: string, selector: string): string {
  const match = css.match(
    new RegExp(`(?<![\\w-])${selector.replace(".", "\\.")}\\s*\\{([^}]*)\\}`),
  );
  if (!match) throw new Error(`Missing rule ${selector}`);
  return match[1]!;
}

// happy-dom computes no layout, so the short-window contract is pinned in the stylesheets.
it("lets the Stewards panel shrink while it keeps scrolling its own content", () => {
  const panel = rule(opsCss, ".task-ops-panel");
  expect(panel).toMatch(/flex:\s*0 1 auto/);
  expect(panel).not.toMatch(/flex-shrink:\s*0/);
  expect(panel).toMatch(/min-block-size:/);
  expect(panel).toMatch(/overflow-y:\s*auto/);
});

it("caps the open goals list by the window height as well as by 18rem", () => {
  const list = rule(goalsCss, ".goal-list");
  expect(list).toMatch(/max-block-size:\s*min\(18rem,\s*\d+dvh\)/);
  expect(list).toMatch(/overflow-y:\s*auto/);
});

it("gives the board area a floor so the panels above it shrink first", () => {
  const area = rule(shellCss, ".task-board-area");
  expect(area).toMatch(/min-block-size:\s*min\(\d+rem,\s*\d+dvh\)/);
});

// #1157: lanes are drop targets for their whole height and keep one width.
it("stretches every lane to the board height so the whole column accepts a drop", () => {
  const lane = block(boardCss, ".task-board-columns > section.bycoda-task-column");
  expect(lane).toMatch(/align-self:\s*stretch/);
  expect(boardCss).not.toMatch(/align-self:\s*start/);
});

it("gives empty lanes the same width as lanes with cards", () => {
  expect(boardCss).not.toContain("7.5rem");
  expect(boardCss).not.toMatch(/data-empty\]\s*\{[^}]*flex:/);
});

// #1158: in the narrow board every status stays reachable as a drop target while dragging.
it("keeps every lane full-width in the narrow board so a drop never reflows the others", () => {
  const lane = block(boardCss, ".task-board-columns > section");
  expect(lane).toMatch(/grid-column:\s*1\s*\/\s*-1/);
});

it("shows the other statuses as header strips while a card is dragged", () => {
  const strip = block(
    boardCss,
    ".task-board-columns[data-dragging] > section:not([data-compact-selected])",
  );
  expect(strip).toMatch(/display:\s*flex/);
  expect(strip).toMatch(/order:\s*-1/);
  const hiddenNote = block(
    boardCss,
    ".task-board-columns[data-dragging] > section:not([data-compact-selected]) > ul",
  );
  expect(hiddenNote).toMatch(/display:\s*none/);
});

it("exposes the drag state on the board container that the stylesheet reads", () => {
  expect(boardCss).toContain(".task-board-columns[data-dragging]");
  expect(columnsSource).toMatch(/data-dragging=\{draggedKey !== null \|\| undefined\}/);
});
