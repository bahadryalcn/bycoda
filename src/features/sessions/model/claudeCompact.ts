import type { ModelSetting } from "./models";
import { AUTO_COMPACT_WINDOWS } from "./autoCompact";

export const CLAUDE_COMPACT_SETTINGS: ModelSetting[] = [
  {
    id: "autoCompact",
    label: "Auto-compact",
    kind: "select",
    value: "default",
    description:
      "Compacts the conversation automatically when the context fills up. Claude default keeps your Claude Code /config choice. Manual /compact always works.",
    options: [
      { value: "default", label: "Default" },
      { value: "on", label: "On" },
      { value: "off", label: "Off" },
    ],
  },
  {
    id: "autoCompactWindow",
    label: "Auto-compact window",
    kind: "select",
    value: "default",
    description:
      "How many tokens the context may hold before auto-compacting. Overrides a window saved with /autocompact. Claude Code caps it at the model's context window.",
    options: [
      { value: "default", label: "Default" },
      ...AUTO_COMPACT_WINDOWS.filter((tokens) => tokens >= 100_000).map((tokens) => ({
        value: String(tokens),
        label: tokens === 1_000_000 ? "1M" : `${tokens / 1000}K`,
      })),
    ],
  },
];
