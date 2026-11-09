import { t, useLocale } from "../../../shared/i18n";
import { Alert } from "../../../shared/ui/Alert";
import { Button } from "../../../shared/ui/Button";
import { Surface } from "../../../shared/ui/Surface";
import { SegmentedControl } from "../../../shared/ui/SegmentedControl";
import type { CrewAgent, CrewPolicy } from "../model/crew";
import type { ProjectCrews } from "../model/crewClient";
import { libraryUpdate, memberFromLibrary } from "../model/crewRoster";
import { CrewMemberForm } from "./CrewMemberForm";

export type CrewInspection = {
  model: string;
  imageGeneration?: boolean;
  observations: { count: number; accepted: number };
}[];

export type CrewBusyAction = "save" | "start" | "add" | "inspect" | "library" | "delete" | null;

/**
 * The open member row: name, instructions, groups, automatic candidates and the library
 * actions, edited in place. Role and the pinned model are edited in the row itself.
 */
export function CrewMemberDetail({
  cwd,
  data,
  crewSaved,
  policy,
  agent,
  groupNames,
  scope,
  onScopeChange,
  pending,
  pendingAction,
  showIssues,
  inspection,
  onInspect,
  onSaveToLibrary,
  onChange,
}: {
  cwd: string;
  data: ProjectCrews;
  crewSaved: boolean;
  policy: CrewPolicy;
  agent: CrewAgent;
  groupNames: string[];
  scope: "project" | "global";
  onScopeChange: (scope: "project" | "global") => void;
  pending: boolean;
  pendingAction: CrewBusyAction;
  showIssues: boolean;
  inspection?: CrewInspection;
  onInspect: () => void;
  onSaveToLibrary: () => void;
  onChange: (patch: Partial<CrewAgent>) => void;
}) {
  useLocale();
  const update = libraryUpdate(agent, data.agents);
  const source = agent.source && data.agents.find((saved) => saved.id === agent.source!.id);
  const projectId = scope === "project" ? data.project.id : undefined;
  const updatesProfile = !!source && source.projectId === projectId;
  return (
    <Surface variant="outline" padding="md" className="mt-1 mb-3 flex min-w-0 flex-col gap-4">
      {update ? (
        <Alert tone="info">
          <p>
            {t("The library profile {p0} changed after this member was added.", {
              p0: update.name,
            })}
          </p>
          <Button
            onClick={() => onChange({ ...memberFromLibrary(update, agent.role), id: agent.id })}
          >
            {t("Update from library")}
          </Button>
        </Alert>
      ) : null}
      <CrewMemberForm
        compact
        cwd={cwd}
        catalog={data.catalog}
        agent={agent}
        policy={policy}
        onChange={onChange}
        groups={data.groupsSupported}
        groupSuggestions={groupNames}
        nameError={showIssues && !agent.name.trim() ? t("Add a name") : undefined}
        modelError={showIssues && !agent.candidates.length ? t("Choose a model") : undefined}
        advancedExtra={
          crewSaved ? (
            <div className="flex flex-col gap-1">
              <Button
                variant="ghost"
                className="self-start"
                disabled={pending}
                loading={pendingAction === "inspect"}
                onClick={onInspect}
              >
                {t("Inspect saved capabilities")}
              </Button>
              {inspection?.map((c) => (
                <p key={c.model} className="text-ui-caption text-(--ui-text-secondary)">
                  {c.model} · {t("Image generation")}:{" "}
                  {t(
                    c.imageGeneration === true
                      ? "Available"
                      : c.imageGeneration === false
                        ? "Unavailable"
                        : "Unknown",
                  )}{" "}
                  ·{" "}
                  {t("{p0} reviews · {p1} accepted", {
                    p0: c.observations.count,
                    p1: c.observations.accepted,
                  })}
                </p>
              ))}
            </div>
          ) : null
        }
      />
      <section
        aria-label={t("Member library")}
        className="flex min-w-0 flex-wrap items-center gap-2"
      >
        <span className="min-w-0 flex-1 text-ui-body">
          <span className="block font-medium">{t("Member library")}</span>
          <span className="block text-ui-caption text-(--ui-text-secondary)">
            {source
              ? t("From library: {p0}", { p0: source.name })
              : t("Reuse this member in other crews.")}
          </span>
        </span>
        <SegmentedControl
          label={t("Library availability")}
          value={scope}
          options={[
            { value: "project", label: t("This project") },
            { value: "global", label: t("All projects") },
          ]}
          onValueChange={(value) => onScopeChange(value === "global" ? "global" : "project")}
        />
        <Button
          variant="secondary"
          loading={pendingAction === "library"}
          disabled={pending || !agent.candidates.length || !agent.name.trim()}
          onClick={onSaveToLibrary}
        >
          {updatesProfile ? t("Update library profile") : t("Save to library")}
        </Button>
      </section>
    </Surface>
  );
}
