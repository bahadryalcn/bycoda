/** Fallback checks; known Git changes and manual refresh bypass these ages. */
export const ACTIVE_PROJECT_REFRESH_MS = 3 * 60_000;
export const BACKGROUND_PROJECT_REFRESH_MS = 20 * 60_000;
export const GIT_PANEL_ENTRY_FRESH_MS = 2 * 60_000;
/** User interaction checks local changes promptly without rereading on every click. */
export const GIT_PANEL_FOCUS_FRESH_MS = 5_000;
export const GITHUB_PR_FRESH_MS = 10 * 60_000;
