import type { ModelSetting } from "./models";

export const CLAUDE_COMPACT_SETTINGS: ModelSetting[] = [
  {
    id: "autoCompact",
    label: "Auto-compact",
    kind: "select",
    value: "default",
    description:
      "Compacts the conversation automatically when the context fills up. Claude default keeps your Claude Code /config choice. Manual /compact always works.",
    options: [
      { value: "default", label: "Claude default" },
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
      { value: "default", label: "Claude default" },
      { value: "200000", label: "200K" },
      { value: "300000", label: "300K" },
      { value: "500000", label: "500K" },
      { value: "750000", label: "750K" },
      { value: "1000000", label: "1M" },
    ],
  },
];
