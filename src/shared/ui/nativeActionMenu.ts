import { isTauri } from "@tauri-apps/api/core";
import { LogicalPosition } from "@tauri-apps/api/dpi";
import { CheckMenuItem, Menu, MenuItem } from "@tauri-apps/api/menu";

export type NativeActionMenuItem = {
  id: string;
  label: string;
  disabled?: boolean;
  checked?: boolean;
};

type Resource = { close(): Promise<void> };
type RetainedMenu = { token: number; resources: Resource[] };
let revision = 0;
let retained: RetainedMenu | undefined;
let queue = Promise.resolve();
let listening = false;

async function release(menu: RetainedMenu | undefined) {
  if (!menu) return;
  // Menu first, then the item handles explicitly owned by this renderer.
  for (const resource of menu.resources) {
    try {
      await resource.close();
    } catch {
      /* The native window may already be gone. */
    }
  }
}

function discard() {
  revision++;
  const menu = retained;
  retained = undefined;
  void release(menu);
}

/**
 * Show a flat OS-native action menu for a bounded native webview.
 * The promise acknowledges showing, NOT selection/dismissal. Tauri's popup is
 * nonblocking on some platforms, so keep its resource and callbacks alive until
 * the next popup or page teardown. Only an actual item callback calls onPick.
 */
export function popupNativeActionMenu(
  anchor: HTMLElement,
  items: readonly NativeActionMenuItem[],
  onPick: (id: string) => void,
): Promise<void> {
  if (!isTauri()) return Promise.reject(new Error("Native action menus require a native window."));
  if (
    !anchor.isConnected ||
    !items.length ||
    new Set(items.map((item) => item.id)).size !== items.length
  )
    return Promise.reject(new Error("The native menu target is unavailable."));
  const rect = anchor.getBoundingClientRect();
  if (![rect.left, rect.bottom].every(Number.isFinite))
    return Promise.reject(new Error("The native menu target is unavailable."));
  if (!listening) {
    window.addEventListener("pagehide", discard);
    listening = true;
  }
  const token = ++revision;
  const choices = items.map((item) => ({ ...item }));
  let picked = false;
  const resources: Resource[] = [];
  const work = queue
    .catch(() => {})
    .then(async () => {
      if (token !== revision) return;
      const previous = retained;
      retained = undefined;
      await release(previous);
      if (token !== revision || !anchor.isConnected) return;
      try {
        const nodes = [];
        for (const choice of choices) {
          const options = {
            id: choice.id,
            text: choice.label,
            enabled: !choice.disabled,
            action: () => {
              if (picked || token !== revision || !anchor.isConnected || choice.disabled) return;
              picked = true;
              onPick(choice.id);
            },
          };
          const item =
            choice.checked === undefined
              ? await MenuItem.new(options)
              : await CheckMenuItem.new({ ...options, checked: choice.checked });
          resources.push(item);
          nodes.push(item);
        }
        const menu = await Menu.new({ items: nodes });
        resources.unshift(menu);
        if (token !== revision || !anchor.isConnected) {
          await release({ token, resources });
          return;
        }
        retained = { token, resources };
        await menu.popup(new LogicalPosition(Math.max(0, rect.left), Math.max(0, rect.bottom)));
      } catch (cause) {
        if (retained?.token === token) retained = undefined;
        await release({ token, resources });
        throw cause;
      }
    });
  queue = work.catch(() => {});
  return work;
}
