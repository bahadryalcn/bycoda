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
      "Agent's choice uses your subagent model only for agents that set no model. Override all uses it for every agent, including Explore and Plan. Requires Claude Code 2.1.257 or later. Forks and skills with model: inherit keep the main model.",
    options: [
      { value: "fallback", label: "Agent's choice" },
      { value: "force", label: "Override all" },
    ],
  },
];
