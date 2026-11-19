/**
 * Composer-owned pickers that take keyboard focus. Shortcut handlers and focus
 * restore outside the composer must yield to these; a new composer picker is
 * added here so every consumer stops at the same list.
 */
export const COMPOSER_PICKER_SELECTOR =
  "[data-skill-picker], [data-session-folder-picker], [data-mention-picker], [data-mcp-picker]";
