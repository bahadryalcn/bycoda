import { t, useLocale } from "../../../shared/i18n";
import { SegmentedControl } from "../../../shared/ui/SegmentedControl";
import { TagInput } from "../../../shared/ui/TagInput";
import {
  CREW_TOOL_LIMITS,
  CREW_TOOL_PRESETS,
  crewToolPreset,
  parseCrewTools,
  validCrewToolAction,
  type CrewToolPreset,
  type CrewToolProfile,
} from "../model/crewTools";

export const crewToolPresetLabel = (preset: CrewToolPreset) =>
  ({
    "read-only": t("Read-only"),
    code: t("Code"),
    design: t("Design"),
    browser: t("Browser"),
    custom: t("Custom"),
  })[preset];

function presetHint(preset: CrewToolPreset) {
  return {
    "read-only": t("Reads and inspects. Host tools that write or start things are blocked."),
    code: t("Every Host tool the run's access mode allows. This is the default."),
    design: t("Read-only plus image generation and visual previews."),
    browser: t("Read-only plus the browser tools."),
    custom: t("Only the Host tools you list, within the run's access mode."),
  }[preset];
}

/** What a preset does to the provider's own tools (file edits, shell); `code` changes nothing. */
function nativeNote(preset: CrewToolPreset) {
  if (preset === "code") return undefined;
  return preset === "custom"
    ? t("Provider tools (file edits, shell) stay as the run's access mode allows.")
    : t(
        "Provider tools: Claude and Codex lose file edits and shell; other providers cannot run this member.",
      );
}

/**
 * The member's tool profile. It only narrows what the member's sessions may use; the run's
 * access mode and owner approvals still apply. Host tools, provider file-edit and shell
 * tools (Claude, Codex), MCP servers and skills are enforced by the Host.
 */
export function MemberToolsPicker({
  value,
  onChange,
}: {
  value: CrewToolProfile | undefined;
  onChange: (tools: CrewToolProfile | undefined) => void;
}) {
  useLocale();
  const preset = crewToolPreset(value);
  const emit = (next: CrewToolProfile) => onChange(parseCrewTools(next));
  const names = (values: string[]) => [
    ...new Set(
      values.map((entry) => entry.trim().slice(0, CREW_TOOL_LIMITS.nameChars)).filter(Boolean),
    ),
  ];
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <span className="text-ui-body font-medium">{t("Tools")}</span>
      <SegmentedControl
        label={t("Tools")}
        value={preset}
        options={CREW_TOOL_PRESETS.map((option) => ({
          value: option,
          label: crewToolPresetLabel(option),
        }))}
        onValueChange={(next) =>
          emit(next === "custom" ? { ...value, preset: next } : { preset: next as CrewToolPreset })
        }
      />
      <p className="text-ui-caption text-(--ui-text-secondary)">{presetHint(preset)}</p>
      {nativeNote(preset) ? (
        <p className="text-ui-caption text-(--ui-text-secondary)">{nativeNote(preset)}</p>
      ) : null}
      {preset === "custom" ? (
        <>
          <TagInput
            label={t("Host tools")}
            placeholder={t("files.read, browser…")}
            value={value?.conversationTools ?? []}
            normalize={(values) => [
              ...new Set(values.map((entry) => entry.trim()).filter(validCrewToolAction)),
            ]}
            maxTags={CREW_TOOL_LIMITS.actions}
            description={t("Action ids or groups such as files or browser.*. Others are blocked.")}
            onValueChange={(next) => emit({ preset, ...value, conversationTools: next })}
          />
          <TagInput
            label={t("MCP servers")}
            value={value?.mcpServers ?? []}
            normalize={names}
            maxTags={CREW_TOOL_LIMITS.names}
            description={t(
              "Only these servers load for this member (Claude, Codex, OpenCode); other providers refuse it.",
            )}
            onValueChange={(next) => emit({ preset, ...value, mcpServers: next })}
          />
          <TagInput
            label={t("Skills")}
            value={value?.skills ?? []}
            normalize={names}
            maxTags={CREW_TOOL_LIMITS.names}
            description={t(
              "Other skills are disabled for this member. Claude blocks them at launch; other providers are told not to use them.",
            )}
            onValueChange={(next) => emit({ preset, ...value, skills: next })}
          />
        </>
      ) : null}
    </div>
  );
}
