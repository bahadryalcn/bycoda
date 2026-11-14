import type { AgentModel, ModelSetting } from "./models";

export const AUTO_COMPACT_WINDOWS = Array.from({ length: 20 }, (_, index) => (index + 1) * 50_000);

/** Catalog owners call this only after verifying isolated native support. */
export function withAutoCompactToggle(model: AgentModel): AgentModel {
  if (model.settings?.some((setting) => setting.id === "autoCompact")) return model;
  return {
    ...model,
    settings: [
      ...(model.settings ?? []),
      {
        id: "autoCompact",
        label: "Auto-compact",
        kind: "select",
        value: "default",
        description:
          "Automatically compact when context fills up. Default follows your provider settings. Manual compaction remains available.",
        options: [
          { value: "default", label: "Default" },
          { value: "on", label: "On" },
          { value: "off", label: "Off" },
        ],
      },
    ],
  };
}

/** Only expose native controls with a session-scoped transport in the adapter. */
export function withAutoCompactSettings(model: AgentModel): AgentModel {
  if (model.harness !== "codex") return model;
  const setting: ModelSetting = {
    id: "autoCompactWindow",
    label: "Auto-compact window",
    kind: "select",
    value: "default",
    description:
      "Automatically compact at this token count. Default follows your provider settings. The model's context window remains the limit.",
    options: [
      { value: "default", label: "Default" },
      ...AUTO_COMPACT_WINDOWS.filter(
        (tokens) => !model.contextWindow || tokens <= model.contextWindow,
      ).map((tokens) => ({
        value: String(tokens),
        label: tokens === 1_000_000 ? "1M" : `${tokens / 1000}K`,
      })),
    ],
  };
  if (model.settings?.some((extra) => extra.id === setting.id)) return model;
  return { ...model, settings: [...(model.settings ?? []), setting] };
}
