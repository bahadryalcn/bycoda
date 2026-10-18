import { decorativeMotionEnabled } from "./decorativeMotion";

let active: ViewTransition | undefined;
let revision = 0;

/** Crossfade a theme change without letting a superseded snapshot apply stale state. */
export function runThemeTransition(update: () => void, changed: boolean): void {
  const current = ++revision;
  active?.skipTransition();
  active = undefined;
  const root = document.documentElement;
  delete root.dataset.themeTransition;

  if (!changed || !decorativeMotionEnabled() || !document.startViewTransition) {
    update();
    return;
  }

  let applied = false;
  const apply = () => {
    if (current !== revision || applied) return;
    applied = true;
    update();
  };

  root.dataset.themeTransition = "fade";
  try {
    const transition = document.startViewTransition(apply);
    active = transition;
    // Skipped/unsupported snapshots reject ready even though their update still runs.
    void transition.ready.catch(() => {});
    void transition.finished.catch(apply).finally(() => {
      if (current !== revision) return;
      active = undefined;
      delete root.dataset.themeTransition;
    });
  } catch {
    delete root.dataset.themeTransition;
    apply();
  }
}
