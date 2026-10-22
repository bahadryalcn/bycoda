type FocusableWindow = {
  unminimize: () => Promise<void>;
  show: () => Promise<void>;
  setFocus: () => Promise<void>;
};

/** Notification clicks must reveal hidden background windows as well. */
export function restoreWindowFocus(win: FocusableWindow): Promise<void> {
  return win
    .unminimize()
    .then(() => win.show())
    .then(() => win.setFocus());
}
