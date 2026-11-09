import type { Locator, Page } from "@playwright/test";

export type FakeFile = { name: string; type: string };
export type DragType = "dragenter" | "dragover" | "dragleave" | "drop";

/**
 * Synthesizes an HTML5 file drag on `target`: a real DataTransfer carrying the files, dispatched as
 * a DragEvent at the centre of the target (or at `at`). Fixture evidence only: it is not an OS
 * drag and never reaches the native webview event path.
 */
export async function fileDrag(
  target: Locator,
  type: DragType,
  files: FakeFile[] = [{ name: "shot.png", type: "image/png" }],
  at?: { x: number; y: number },
) {
  await target.evaluate(
    (element, { type, files, at }) => {
      const data = new DataTransfer();
      for (const file of files) data.items.add(new File(["x"], file.name, { type: file.type }));
      const rect = element.getBoundingClientRect();
      element.dispatchEvent(
        new DragEvent(type, {
          bubbles: true,
          cancelable: true,
          composed: true,
          dataTransfer: data,
          clientX: at?.x ?? rect.left + rect.width / 2,
          clientY: at?.y ?? rect.top + rect.height / 2,
        }),
      );
    },
    { type, files, at },
  );
}

/** A plain-text drag, which none of the file receivers may react to. */
export async function textDrag(target: Locator, type: DragType) {
  await target.evaluate((element, type) => {
    const data = new DataTransfer();
    data.setData("text/plain", "some text");
    const rect = element.getBoundingClientRect();
    element.dispatchEvent(
      new DragEvent(type, {
        bubbles: true,
        cancelable: true,
        composed: true,
        dataTransfer: data,
        clientX: rect.left + rect.width / 2,
        clientY: rect.top + rect.height / 2,
      }),
    );
  }, type);
}

export const dropBadge = (page: Page) => page.locator(".pointer-drop-hint");
export const dropMarks = (page: Page) => page.locator("[data-drop-indicator]");
export const dropAnnouncer = (page: Page) => page.locator("[data-drag-announcer]");

export function files(count: number, type = "image/png"): FakeFile[] {
  return Array.from({ length: count }, (_, index) => ({ name: `file${index}.png`, type }));
}
