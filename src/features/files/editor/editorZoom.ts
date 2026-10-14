import { Compartment, Prec } from "@codemirror/state";
import { EditorView, ViewPlugin } from "@codemirror/view";

const STORAGE_KEY = "bycoda.editorFontSize";
const DEFAULT_SIZE = 13;
const MIN_SIZE = 8;
const MAX_SIZE = 32;
const listeners = new Set<(size: number) => void>();

function loadSize(): number {
  try {
    const size = Number(localStorage.getItem(STORAGE_KEY));
    if (Number.isInteger(size) && size >= MIN_SIZE && size <= MAX_SIZE) return size;
  } catch {
    // Zoom remains available when storage is blocked.
  }
  return DEFAULT_SIZE;
}

const fontTheme = (size: number) =>
  Prec.highest(EditorView.theme({ "&": { fontSize: `${size}px` } }));

/** Shared font zoom for file editors, including both read-only and editable diff panes. */
export function editorZoom() {
  const font = new Compartment();
  return [
    font.of(fontTheme(loadSize())),
    ViewPlugin.fromClass(
      class {
        private size = loadSize();

        constructor(private readonly view: EditorView) {
          listeners.add(this.setSize);
          view.dom.addEventListener("wheel", this.onWheel, { passive: false, capture: true });
        }

        private readonly setSize = (size: number) => {
          if (size === this.size) return;
          this.size = size;
          this.view.dispatch({ effects: font.reconfigure(fontTheme(size)) });
        };

        private readonly onWheel = (event: WheelEvent) => {
          if (event.defaultPrevented || !event.ctrlKey || event.deltaY === 0) return;
          // Cancel native page zoom even when the font has reached a limit.
          event.preventDefault();
          const size = Math.max(MIN_SIZE, Math.min(MAX_SIZE, this.size - Math.sign(event.deltaY)));
          if (size === this.size) return;
          try {
            localStorage.setItem(STORAGE_KEY, String(size));
          } catch {
            // Open editors still synchronize without persistence.
          }
          for (const update of listeners) update(size);
        };

        destroy() {
          listeners.delete(this.setSize);
          this.view.dom.removeEventListener("wheel", this.onWheel, true);
        }
      },
    ),
  ];
}
