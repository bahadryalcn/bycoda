type PointerPress = { button: "left" | "middle" | "right"; clickCount?: number };

type BrowserInputPage = {
  evaluate?: <T, A>(callback: (arg: A) => T, arg: A) => Promise<T>;
  mouse: {
    click(x: number, y: number): Promise<void>;
    wheel(x: number, y: number): Promise<void>;
    move?(x: number, y: number): Promise<void>;
    down?(options: PointerPress): Promise<void>;
    up?(options: PointerPress): Promise<void>;
  };
  keyboard: {
    type(text: string): Promise<void>;
    insertText?(text: string): Promise<void>;
    press(key: string): Promise<void>;
    down?(key: string): Promise<void>;
    up?(key: string): Promise<void>;
  };
};

const NAMED_KEYS = new Set([
  "Enter",
  "Tab",
  "Escape",
  "Backspace",
  "Delete",
  "Insert",
  "Home",
  "End",
  "PageUp",
  "PageDown",
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "Space",
  "ContextMenu",
  "Pause",
  "PrintScreen",
  "Backquote",
  "Minus",
  "Equal",
  "BracketLeft",
  "BracketRight",
  "Backslash",
  "Semicolon",
  "Quote",
  "Comma",
  "Period",
  "Slash",
  ...Array.from({ length: 12 }, (_, index) => `F${index + 1}`),
]);

/** Named keys and single letter/digit shortcuts; everything printable arrives as text. */
export function browserKeyAllowed(key: unknown): key is string {
  return typeof key === "string" && (NAMED_KEYS.has(key) || /^[A-Z0-9]$/.test(key));
}

function inputModifiers(value: unknown): string[] {
  const modifiers = value ?? [];
  if (
    !Array.isArray(modifiers) ||
    modifiers.length > 4 ||
    new Set(modifiers).size !== modifiers.length ||
    modifiers.some((key) => !["Control", "Alt", "Shift", "Meta"].includes(key))
  )
    throw new Error("Unsupported browser key modifiers");
  return modifiers;
}

/** Temporarily holds modifiers for a mouse event and releases every key even on failure. */
async function withMouseModifiers(
  keyboard: BrowserInputPage["keyboard"],
  modifiers: string[],
  work: () => Promise<void>,
) {
  if (modifiers.length && (!keyboard.down || !keyboard.up))
    throw new Error("Pointer modifiers are unavailable on this host browser");
  const held: string[] = [];
  try {
    for (const key of modifiers) {
      await keyboard.down!(key);
      held.push(key);
    }
    await work();
  } finally {
    for (const key of held.reverse()) await keyboard.up!(key).catch(() => {});
  }
}

const CURSORS = new Set(
  "default pointer text wait progress help move grab grabbing crosshair not-allowed no-drop copy alias cell context-menu vertical-text zoom-in zoom-out all-scroll col-resize row-resize n-resize e-resize s-resize w-resize ne-resize nw-resize se-resize sw-resize ew-resize ns-resize nesw-resize nwse-resize none".split(
    " ",
  ),
);

/** The CSS cursor keyword the page shows at a point; never a page-supplied image URL. */
async function cursorAt(page: BrowserInputPage, x: number, y: number) {
  try {
    const cursor = await page.evaluate?.(
      (point) => {
        const view = globalThis as any;
        const element = view.document.elementFromPoint(point.x, point.y);
        if (!element) return "default";
        const value = String(view.getComputedStyle(element).cursor).split(",").pop()!.trim();
        return value === "auto" ? (element.isContentEditable ? "text" : "default") : value;
      },
      { x, y },
    );
    return typeof cursor === "string" && CURSORS.has(cursor) ? cursor : "default";
  } catch {
    // The document changed under the pointer; the next move reports it.
    return undefined;
  }
}

function position(
  params: Record<string, unknown>,
  viewport: { width: number; height: number },
  message: string,
) {
  const x = Number(params.x),
    y = Number(params.y);
  if (!(x >= 0 && x < viewport.width && y >= 0 && y < viewport.height)) throw new Error(message);
  return { x, y };
}

/** Applies one validated pointer, scroll, text or key action; pointer actions report the cursor. */
export async function applyBrowserInput(
  page: BrowserInputPage,
  params: Record<string, unknown>,
  viewport: { width: number; height: number },
) {
  if (params.kind === "click") {
    const { x, y } = position(params, viewport, "Invalid click position");
    await page.mouse.click(x, y);
  } else if (params.kind === "pointer") {
    const { x, y } = position(params, viewport, "Invalid pointer position");
    const button = params.button ?? "left";
    if (button !== "left" && button !== "middle" && button !== "right")
      throw new Error("Invalid pointer button");
    if (!["move", "down", "up"].includes(String(params.action)))
      throw new Error("Unsupported pointer action");
    const clickCount = params.clickCount;
    if (clickCount !== undefined && clickCount !== 1 && clickCount !== 2 && clickCount !== 3)
      throw new Error("Invalid pointer click count");
    const modifiers = inputModifiers(params.modifiers);
    if (
      !page.mouse.move ||
      (params.action === "down" && !page.mouse.down) ||
      (params.action === "up" && !page.mouse.up)
    )
      throw new Error("Pointer input is unavailable on this host browser");
    const options = { button, ...(clickCount === undefined ? {} : { clickCount }) } as PointerPress;
    await withMouseModifiers(page.keyboard, modifiers, async () => {
      await page.mouse.move!(x, y);
      if (params.action === "down") await page.mouse.down!(options);
      else if (params.action === "up") await page.mouse.up!(options);
    });
    return cursorAt(page, x, y);
  } else if (params.kind === "scroll") {
    const y = Number(params.y);
    const x = params.x === undefined ? 0 : Number(params.x);
    if (!Number.isFinite(x) || Math.abs(x) > 2000 || !Number.isFinite(y) || Math.abs(y) > 2000)
      throw new Error("Invalid scroll distance");
    await withMouseModifiers(page.keyboard, inputModifiers(params.modifiers), () =>
      page.mouse.wheel(x, y),
    );
  } else if (params.kind === "text") {
    if (typeof params.text !== "string" || params.text.length > 4096 || params.text.includes("\0"))
      throw new Error("Invalid browser text");
    if (page.keyboard.insertText) await page.keyboard.insertText(params.text);
    else await page.keyboard.type(params.text);
  } else if (params.kind === "key") {
    if (!browserKeyAllowed(params.key)) throw new Error("Unsupported browser key");
    const modifiers = inputModifiers(params.modifiers);
    await page.keyboard.press([...modifiers, params.key].join("+"));
  } else throw new Error("Unsupported browser input");
  return undefined;
}
