import type { AgentModel, ModelSetting } from "./models";

/** 200K through 1M in 50K steps; smaller windows compact too often to be useful. */
export const AUTO_COMPACT_WINDOWS = Array.from({ length: 17 }, (_, index) => (index + 4) * 50_000);

/**
 * The window the provider compacts at when the session leaves it at Default: the model's
 * context window, following the Claude Context choice when the model has one.
 */
export function defaultAutoCompactWindow(
  model: AgentModel,
  values: Record<string, string>,
): number | undefined {
  const context =
    values.context ?? model.settings?.find((setting) => setting.id === "context")?.value;
  if (context === "1m") return 1_000_000;
  if (context === "200k") return 200_000;
  return model.contextWindow;
}

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
  const windows = AUTO_COMPACT_WINDOWS.filter(
    (tokens) => !model.contextWindow || tokens <= model.contextWindow,
  );
  // A model smaller than the 200K floor keeps its provider default with nothing to adjust.
  if (!windows.length) return model;
  const setting: ModelSetting = {
    id: "autoCompactWindow",
    label: "Auto-compact window",
    kind: "select",
    value: "default",
    description:
      "Automatically compact at this token count. Default follows your provider settings. The model's context window remains the limit.",
    options: [
      { value: "default", label: "Default" },
      ...windows.map((tokens) => ({
        value: String(tokens),
        label: tokens === 1_000_000 ? "1M" : `${tokens / 1000}K`,
      })),
    ],
  };
  if (model.settings?.some((extra) => extra.id === setting.id)) return model;
  return { ...model, settings: [...(model.settings ?? []), setting] };
}
