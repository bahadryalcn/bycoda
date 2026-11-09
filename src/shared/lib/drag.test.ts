// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";
import {
  announceDrag,
  clearDropFeedback,
  createDragPreview,
  createListGap,
  clearDropIndicator,
  setDropFeedback,
  setDropIndicator,
  setGrabbing,
} from "./drag";

const pointer = { clientX: 100, clientY: 100 };
const hint = () => document.querySelector<HTMLElement>(".pointer-drop-hint");
const region = () => document.querySelector<HTMLElement>("[data-drag-announcer]");

function row() {
  const element = document.createElement("div");
  document.body.append(element);
  return element;
}

afterEach(() => {
  setGrabbing(false);
  clearDropFeedback();
  document.body.replaceChildren();
});

describe("drop feedback badge", () => {
  it("keeps one badge, names the subject once and does not rewrite identical text", () => {
    setDropFeedback("move", pointer, "Release to group", "Build notes");
    const first = hint()!;
    const subject = first.querySelector(".pointer-drop-hint-subject")!;
    setDropFeedback("move", { clientX: 140, clientY: 120 }, "Release to group", "Build notes");
    expect(document.querySelectorAll(".pointer-drop-hint")).toHaveLength(1);
    expect(hint()).toBe(first);
    expect(first.querySelector(".pointer-drop-hint-subject")).toBe(subject);
    expect(first.textContent).toBe("Build notesRelease to group");
    expect(first.getAttribute("aria-hidden")).toBe("true");
  });

  it("uses a neutral blocked state with a default reason", () => {
    setDropFeedback("blocked", pointer);
    expect(hint()!.dataset.action).toBe("blocked");
    expect(hint()!.textContent).toBe("Cannot drop here");
    expect(document.body.style.cursor).toBe("not-allowed");
  });
});

describe("drop indicator", () => {
  it("marks exactly one element and moves the mark instead of stacking it", () => {
    const [a, b] = [row(), row()];
    setDropIndicator(a, "before");
    setDropIndicator(b, "after", "x");
    expect(a.dataset.dropIndicator).toBeUndefined();
    expect(b.dataset.dropIndicator).toBe("after");
    expect(b.dataset.dropAxis).toBe("x");
    setDropIndicator(b, "inside");
    expect(b.dataset.dropIndicator).toBe("inside");
    expect(b.dataset.dropAxis).toBeUndefined();
    expect(document.querySelectorAll("[data-drop-indicator]")).toHaveLength(1);
  });

  it("clears with a null placement or clearDropIndicator", () => {
    const a = row();
    setDropIndicator(a, "group");
    setDropIndicator(a, null);
    expect(a.dataset.dropIndicator).toBeUndefined();
    setDropIndicator(a, "split-end");
    clearDropIndicator();
    expect(a.dataset.dropIndicator).toBeUndefined();
  });

  it.each([
    ["Escape", () => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }))],
    ["pointercancel", () => window.dispatchEvent(new Event("pointercancel"))],
    ["blur", () => window.dispatchEvent(new Event("blur"))],
  ])("clears a stranded mark and badge on %s", (_name, strand) => {
    const a = row();
    setDropIndicator(a, "before");
    setDropFeedback("move", pointer);
    strand();
    expect(a.dataset.dropIndicator).toBeUndefined();
    expect(hint()).toBeNull();
  });

  it("ignores other keys and stops listening once nothing is shown", () => {
    const a = row();
    setDropIndicator(a, "before");
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "a" }));
    expect(a.dataset.dropIndicator).toBe("before");
    clearDropIndicator();
    setDropIndicator(a, "after");
    clearDropFeedback();
    expect(a.dataset.dropIndicator).toBeUndefined();
    // After the mark is gone, a later Escape must not touch a fresh gesture's cursor.
    setGrabbing(true);
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(document.body.style.cursor).toBe("grabbing");
  });

  it("keeps the grabbing cursor when feedback is cleared mid-gesture and drops it at the end", () => {
    setGrabbing(true);
    setDropFeedback("move", pointer);
    clearDropFeedback();
    expect(document.body.style.cursor).toBe("grabbing");
    setGrabbing(false);
    expect(document.body.style.cursor).toBe("");
    expect(document.documentElement.classList.contains("is-grabbing")).toBe(false);
  });
});

describe("drag announcements", () => {
  it("uses one polite status region and repeats an identical message", () => {
    announceDrag("Picked up Terminal 1, position 1 of 3. Escape cancels.");
    const live = region()!;
    expect(live.getAttribute("role")).toBe("status");
    expect(live.getAttribute("aria-live")).toBe("polite");
    expect(live.textContent).toBe("Picked up Terminal 1, position 1 of 3. Escape cancels.");
    announceDrag("Moved Terminal 1 to position 2 of 3");
    announceDrag("Moved Terminal 1 to position 2 of 3");
    expect(document.querySelectorAll("[data-drag-announcer]")).toHaveLength(1);
    expect(region()!.textContent).toBe("Moved Terminal 1 to position 2 of 3​");
  });

  it("creates the region when a gesture starts so the first message is spoken", () => {
    setGrabbing(true);
    expect(region()).not.toBeNull();
    expect(region()!.textContent).toBe("");
  });

  it("ignores an empty message", () => {
    announceDrag("");
    expect(region()?.textContent ?? "").toBe("");
  });
});

describe("drag preview", () => {
  it("follows the pointer without ids or list markers, labels the copy, and removes it on settle", () => {
    const source = row();
    source.id = "source";
    source.dataset.sessionCard = "one";
    source.innerHTML = '<span id="inner">Title</span>';
    const preview = createDragPreview(source, { clientX: 10, clientY: 10 });
    const copy = document.querySelector<HTMLElement>(".pointer-drag-preview")!;
    expect(copy.id).toBe("");
    expect(copy.querySelector("#inner")).toBeNull();
    expect(copy.dataset.sessionCard).toBeUndefined();
    expect(copy.getAttribute("aria-hidden")).toBe("true");
    preview.move({ clientX: 30, clientY: 50 }, { label: "Release to group" });
    expect(copy.style.transform).toBe("translate3d(20px, 40px, 0)");
    expect(copy.querySelector(".pointer-drag-preview-label")?.textContent).toBe("Release to group");
    preview.move({ clientX: 30, clientY: 50 });
    expect(copy.querySelector(".pointer-drag-preview-label")).toBeNull();
    preview.settleTo(null);
    expect(document.querySelector(".pointer-drag-preview")).toBeNull();
  });
});

describe("list gap", () => {
  it("collapses the source, spaces the target and removes every inline style on release", () => {
    const list = document.createElement("ul");
    const [a, b] = ["a", "b"].map(() => document.createElement("li"));
    list.append(a, b);
    document.body.append(list);
    a.getBoundingClientRect = () => new DOMRect(0, 0, 100, 40);
    const gap = createListGap(a);
    gap.open(b, "after");
    expect(a.style.getPropertyValue("height")).toBe("0px");
    // Padding, not margin: a windowed list measures border boxes, so only padding moves the rows
    // after the target instead of sliding the target over them.
    expect(b.style.getPropertyValue("padding-block-end")).toBe("40px");
    expect(b.style.getPropertyValue("margin-block-end")).toBe("");
    gap.open(b, "before");
    expect(b.style.getPropertyValue("padding-block-end")).toBe("0px");
    expect(b.style.getPropertyValue("padding-block-start")).toBe("40px");
    gap.open(null);
    expect(a.style.getPropertyValue("height")).toBe("40px");
    expect(b.style.getPropertyValue("padding-block-start")).toBe("0px");
    gap.release();
    expect(a.hasAttribute("style")).toBe(false);
    expect(b.hasAttribute("style")).toBe(false);
  });
});
