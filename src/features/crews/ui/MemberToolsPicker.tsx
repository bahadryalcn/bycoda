import { t, useLocale } from "../../../shared/i18n";
import { Checkbox } from "../../../shared/ui/Checkbox";
import { InfoPopover } from "../../../shared/ui/InfoPopover";
import { TagInput } from "../../../shared/ui/TagInput";
import {
  CREW_TOOL_LIMITS,
  crewToolExtras,
  parseCrewTools,
  validCrewToolAction,
  type CrewToolExtra,
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

/**
 * The member's tool profile as combinable capabilities. It only narrows what the member's
 * sessions may use; the run's access mode and owner approvals still apply. Nothing selected is
 * read-only. Host tools, provider file-edit and shell tools (Claude, Codex), MCP servers and
 * skills are enforced by the Host.
 */
export function MemberToolsPicker({
  value,
  onChange,
}: {
  value: CrewToolProfile | undefined;
  onChange: (tools: CrewToolProfile | undefined) => void;
}) {
  useLocale();
  const code = !value || value.preset === "code" || value.preset === "custom";
  const limited = value?.preset === "custom" || value?.conversationTools !== undefined;
  const extras = value && !code ? crewToolExtras(value) : [];
  const emit = (next: {
    code: boolean;
    limited: boolean;
    extras: CrewToolExtra[];
    conversationTools?: string[];
    mcpServers?: string[];
    skills?: string[];
  }) => {
    const lists = {
      conversationTools: next.limited || !next.code ? next.conversationTools : undefined,
      mcpServers: next.mcpServers,
      skills: next.skills,
    };
    onChange(
      parseCrewTools(
        next.code
          ? { preset: next.limited ? "custom" : "code", ...lists }
          : { preset: "read-only", extras: next.extras, ...lists },
      ),
    );
  };
  const current = {
    code,
    limited,
    extras,
    conversationTools: value?.conversationTools,
    mcpServers: value?.mcpServers,
    skills: value?.skills,
  };
  const names = (values: string[]) => [
    ...new Set(
      values.map((entry) => entry.trim().slice(0, CREW_TOOL_LIMITS.nameChars)).filter(Boolean),
    ),
  ];
  const toggleExtra = (extra: CrewToolExtra, on: boolean) =>
    emit({
      ...current,
      extras: on ? [...extras, extra] : extras.filter((entry) => entry !== extra),
    });
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <div className="flex items-center gap-1">
        <h3 className="text-ui-title font-medium">{t("Tools")}</h3>
        <InfoPopover label={t("About member tools")}>
          <div className="flex flex-col gap-2 text-ui-caption">
            <p>
              {t(
                "Nothing selected means read-only: Host tools that write or start things are blocked. Choices combine and only narrow what the run's access mode allows.",
              )}
            </p>
            <p>
              {t(
                "Without Write code, Claude and Codex lose file edits and shell; other providers cannot run the member.",
              )}
            </p>
            <p>{t("Write code includes Image generation and Browser.")}</p>
            <p>
              {t(
                "MCP servers and skills: leave empty for no restriction. Listed servers are the only ones loaded (Claude, Codex, OpenCode); other skills are disabled for the member.",
              )}
            </p>
          </div>
        </InfoPopover>
      </div>
      <div className="flex flex-col gap-1.5">
        <Checkbox
          className="text-ui-body"
          label={t("Write code")}
          checked={code}
          onChange={(event) =>
            emit({
              ...current,
              code: event.target.checked,
              limited: false,
              conversationTools: undefined,
            })
          }
        />
        {code ? null : (
          <>
            <Checkbox
              className="text-ui-body"
              label={t("Image generation")}
              checked={extras.includes("design")}
              onChange={(event) => toggleExtra("design", event.target.checked)}
            />
            <Checkbox
              className="text-ui-body"
              label={t("Browser")}
              checked={extras.includes("browser")}
              onChange={(event) => toggleExtra("browser", event.target.checked)}
            />
          </>
        )}
        {code ? (
          <Checkbox
            className="text-ui-body"
            label={t("Limit Host tools to a list")}
            checked={limited}
            onChange={(event) =>
              emit({
                ...current,
                limited: event.target.checked,
                conversationTools: event.target.checked ? [] : undefined,
              })
            }
          />
        ) : null}
      </div>
      {limited ? (
        <TagInput
          label={t("Host tools")}
          placeholder={t("files.read, browser…")}
          value={value?.conversationTools ?? []}
          normalize={(values) => [
            ...new Set(values.map((entry) => entry.trim()).filter(validCrewToolAction)),
          ]}
          maxTags={CREW_TOOL_LIMITS.actions}
          onValueChange={(next) => emit({ ...current, conversationTools: next })}
        />
      ) : null}
      <TagInput
        label={t("MCP servers")}
        value={value?.mcpServers ?? []}
        normalize={names}
        maxTags={CREW_TOOL_LIMITS.names}
        onValueChange={(next) => emit({ ...current, mcpServers: next })}
      />
      <TagInput
        label={t("Skills")}
        value={value?.skills ?? []}
        normalize={names}
        maxTags={CREW_TOOL_LIMITS.names}
        onValueChange={(next) => emit({ ...current, skills: next })}
      />
    </div>
  );
}
