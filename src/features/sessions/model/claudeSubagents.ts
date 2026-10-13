import type { ModelSetting } from "./models";

export const CLAUDE_SUBAGENT_SETTINGS: ModelSetting[] = [
  {
    id: "subagentModel",
    label: "Subagent model",
    kind: "select",
    value: "default",
    description:
      "Chooses the default model for delegated work. Agent definitions and per-call choices can override it. Aliases use the version configured by Claude Code.",
    options: [
      { value: "default", label: "Claude default" },
      { value: "haiku", label: "Haiku" },
      { value: "sonnet", label: "Sonnet" },
      { value: "opus", label: "Opus" },
      { value: "fable", label: "Fable" },
    ],
  },
  {
    id: "subagentPolicy",
    label: "Subagent model policy",
    kind: "select",
    value: "fallback",
    description:
      "Force overrides agent model choices, including Explore and Plan. Requires Claude Code 2.1.257 or later. Forks and skills with model: inherit keep the main model. Account restrictions still apply.",
    options: [
      { value: "fallback", label: "Use as default" },
      { value: "force", label: "Apply to all subagents" },
    ],
  },
];
