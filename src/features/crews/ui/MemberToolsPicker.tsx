import { Text } from "../../../shared/ui/Text";
import { t, useLocale } from "../../../shared/i18n";
import { Heading } from "../../../shared/ui/Heading";
import { RadioGroup } from "../../../shared/ui/RadioGroup";
import { SearchableSelect } from "../../../shared/ui/SearchableSelect";
import {
  crewHostToolChoices,
  useCrewToolCatalogs,
  withSelectedChoices,
  type CrewToolCatalog,
  type CrewToolChoice,
} from "../model/crewToolCatalog";
import {
  CREW_TOOL_LIMITS,
  CREW_TOOL_PROFILE_CHOICES,
  crewToolProfileChoice,
  crewToolProfileFor,
  parseCrewTools,
  validCrewToolAction,
  type CrewToolProfile,
  type CrewToolProfileChoice,
} from "../model/crewTools";

const profileText = (choice: CrewToolProfileChoice) =>
  ({
    full: {
      label: t("Full access"),
      description: t("Every tool the run allows. Right for most members."),
    },
    developer: {
      label: t("Developer"),
      description: t("Code, files, Git, terminals, dev servers, browser, tasks and pull requests."),
    },
    designer: {
      label: t("Designer"),
      description: t("Code and files, image generation, visual previews, browser and dev servers."),
    },
    tester: {
      label: t("Tester"),
      description: t("Code and files, dev servers, browser, simulators and desktop apps."),
    },
    custom: {
      label: t("Custom"),
      description: t("Choose the Host tools, MCP servers and skills yourself."),
    },
  })[choice];

/** Short name of a member's tool profile, for rows and summaries. */
export const crewToolProfileLabel = (tools: CrewToolProfile | undefined) =>
  profileText(crewToolProfileChoice(tools)).label;

/**
 * The member's tools as one ready-made profile. Full access (nothing saved) is the default; the
 * other profiles only choose which Host tool groups the member sees, and every one can write
 * code. Custom opens the lists: Host tools from the Host's own catalog, MCP servers and skills
 * installed on this computer, typed names where a list is unknown. A profile only narrows; the
 * run's access mode and owner approvals still apply.
 */
export function MemberToolsPicker({
  value,
  onChange,
  cwd,
  machineId,
  projectId,
}: {
  value: CrewToolProfile | undefined;
  onChange: (tools: CrewToolProfile | undefined) => void;
  /** Project folder whose MCP servers and skills are offered. */
  cwd: string;
  /** Host and project that report the Host tool list (`data.machine.id`, `data.project.id`). */
  machineId?: string;
  projectId?: string;
}) {
  useLocale();
  const choice = crewToolProfileChoice(value);
  const custom = choice === "custom";
  const catalogs = useCrewToolCatalogs({ cwd, machineId, projectId, active: custom });
  const set = (next: CrewToolProfile | undefined) =>
    onChange(next === undefined ? undefined : parseCrewTools(next));
  const lists = { ...(value ?? { preset: "custom" as const }) };
  const names = (values: string[]) => [
    ...new Set(
      values.map((entry) => entry.trim().slice(0, CREW_TOOL_LIMITS.nameChars)).filter(Boolean),
    ),
  ];
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <Heading size="section" level={3}>
        {t("Tools")}
      </Heading>
      <RadioGroup
        label={t("Tool profile")}
        compact
        value={choice}
        options={CREW_TOOL_PROFILE_CHOICES.map((option) => ({
          value: option,
          ...profileText(option),
        }))}
        onValueChange={(next) => set(crewToolProfileFor(next as CrewToolProfileChoice, value))}
      />
      {custom ? (
        <div className="flex min-w-0 flex-col gap-2">
          {value && value.preset !== "custom" ? (
            <Text as="p" tone="inherit">
              {t(
                "This member is read-only from an earlier setting. Choose a profile to change it.",
              )}
            </Text>
          ) : null}
          <ToolNamesField
            label={t("Host tools")}
            placeholder={t("All Host tools")}
            catalog={catalogs.hostTools}
            choices={(tools) =>
              crewHostToolChoices(tools, {
                all: (count) => t("Every tool in this group ({p0})", { p0: count }),
                reads: t("Reads"),
                writes: t("Writes or starts"),
              })
            }
            unavailable={t("Update and connect this project's Host to choose Host tools.")}
            empty={t("This Host does not list its tools yet. Update the Host to choose them.")}
            value={value?.conversationTools ?? []}
            normalize={(entries) => [
              ...new Set(entries.map((entry) => entry.trim()).filter(validCrewToolAction)),
            ]}
            max={CREW_TOOL_LIMITS.actions}
            onChange={(next) => set({ ...lists, conversationTools: next })}
          />
          <ToolNamesField
            label={t("MCP servers")}
            placeholder={t("All MCP servers")}
            catalog={catalogs.mcpServers}
            choices={(rows) => rows}
            unavailable={t("MCP servers can be chosen for projects on this computer.")}
            empty={t("No MCP servers are set up on this computer.")}
            value={value?.mcpServers ?? []}
            normalize={names}
            max={CREW_TOOL_LIMITS.names}
            onChange={(next) => set({ ...lists, mcpServers: next })}
          />
          <ToolNamesField
            label={t("Skills")}
            placeholder={t("All skills")}
            catalog={catalogs.skills}
            choices={(rows) => rows}
            unavailable={t("Skills can be chosen for projects on this computer.")}
            empty={t("No skills are installed on this computer.")}
            value={value?.skills ?? []}
            normalize={names}
            max={CREW_TOOL_LIMITS.names}
            onChange={(next) => set({ ...lists, skills: next })}
          />
          <Text as="p" tone="inherit">
            {t("Empty lists mean no limit.")}
          </Text>
        </div>
      ) : null}
    </div>
  );
}

/**
 * A list of names picked from a catalog, never typed. Saved names the catalog does not know stay
 * shown so they can be removed; a list this project cannot read explains why instead.
 */
function ToolNamesField<T>({
  label,
  placeholder,
  catalog,
  choices,
  unavailable,
  empty,
  value,
  normalize,
  max,
  onChange,
}: {
  label: string;
  placeholder: string;
  catalog: CrewToolCatalog<T>;
  choices: (rows: T[]) => CrewToolChoice[];
  /** Why this project cannot list it. */
  unavailable: string;
  /** Shown when the list is read and empty. */
  empty: string;
  value: string[];
  normalize: (values: string[]) => string[];
  max: number;
  onChange: (next: string[]) => void;
}) {
  return (
    <SearchableSelect
      multiple
      showSelectedValues
      label={label}
      placeholder={placeholder}
      options={withSelectedChoices(catalog.data ? choices(catalog.data) : [], value).map(
        (choice) => ({
          value: choice.value,
          label: choice.value,
          description: choice.description,
          meta: choice.meta,
          group: choice.group,
        }),
      )}
      value={value}
      loading={catalog.loading}
      loadingLabel={t("Loading…")}
      error={catalog.error}
      onRetry={catalog.retry}
      noOptionsLabel={catalog.available ? empty : unavailable}
      description={catalog.available ? undefined : unavailable}
      onChange={(next) => onChange(normalize(next).slice(0, max))}
    />
  );
}
