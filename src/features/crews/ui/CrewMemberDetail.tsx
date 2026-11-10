import { useState } from "react";
import { t, useLocale } from "../../../shared/i18n";
import { Alert } from "../../../shared/ui/Alert";
import { Button } from "../../../shared/ui/Button";
import { InfoPopover } from "../../../shared/ui/InfoPopover";
import { Surface } from "../../../shared/ui/Surface";
import { SegmentedControl } from "../../../shared/ui/SegmentedControl";
import type { CrewAgent, CrewPolicy, CrewRole } from "../model/crew";
import type { ProjectCrews, useProjectCrews } from "../model/crewClient";
import { libraryVersionPatch, memberLink } from "../model/crewLink";
import type { MemberAvatarTraits } from "../model/memberAvatarTraits";
import { libraryUpdate, memberFromLibrary } from "../model/crewRoster";
import { CrewLibraryProfileDialog } from "./CrewLibraryProfileDialog";
import { CrewMemberForm, roleLabel } from "./CrewMemberForm";
import { MemberPerformance } from "./MemberPerformance";

export type CrewInspection = {
  model: string;
  imageGeneration?: boolean;
  observations: { count: number; accepted: number };
}[];

export type CrewBusyAction = "save" | "start" | "add" | "inspect" | "library" | "delete" | null;

/**
 * The open member row: role, name, instructions, groups, automatic candidates and one
 * library line, edited in place. The pinned model is edited in the row itself.
 */
export function CrewMemberDetail({
  cwd,
  state,
  data,
  traits,
  handleError,
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
  state: ReturnType<typeof useProjectCrews>;
  data: ProjectCrews;
  /** The member's look resolved over the whole roster, equal to its roster face. */
  traits?: MemberAvatarTraits;
  /** A Host refusal about this member's handle. */
  handleError?: string;
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
  const [editingProfile, setEditingProfile] = useState(false);
  const identity = data.identitySupported === true;
  const link = identity ? memberLink(agent, data.agents) : undefined;
  const update = identity ? undefined : libraryUpdate(agent, data.agents);
  const source = agent.source && data.agents.find((saved) => saved.id === agent.source!.id);
  const projectId = scope === "project" ? data.project.id : undefined;
  // Observations are kept per saved crew, so the section needs the saved crew that holds this member.
  const definitionId = data.definitions.find((d) => d.agents.some((a) => a.id === agent.id))?.id;
  const updatesProfile = !!source && source.projectId === projectId;
  return (
    <Surface variant="outline" padding="md" className="mt-1 mb-3 flex min-w-0 flex-col gap-4">
      <section
        aria-label={t("Member library")}
        className="flex min-w-0 flex-wrap items-center justify-between gap-x-3 gap-y-2"
      >
        <span className="flex min-w-0 flex-1 basis-56 flex-wrap items-center gap-x-2 text-ui-caption text-(--ui-text-secondary)">
          <span className="inline-flex min-w-0 items-center gap-1">
            <span className="min-w-0 truncate">
              {link
                ? t("Library: {p0}", { p0: link.profile.name })
                : source
                  ? t("From library: {p0}", { p0: source.name })
                  : t("Member library")}
            </span>
            {link?.state === "linked" ? (
              <InfoPopover label={t("About the library profile")}>
                <p>
                  {t(
                    "Changes to the name, instructions, model, groups, avatar or handle here customize this member for this crew only.",
                  )}
                </p>
              </InfoPopover>
            ) : null}
          </span>
          {link?.state === "customized" ? <span>{t("customized")}</span> : null}
        </span>
        <div className="flex min-w-0 flex-wrap items-center justify-end gap-2">
          {link?.state === "customized" ? (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => onChange(libraryVersionPatch(link.profile))}
            >
              {t("Use library version")}
            </Button>
          ) : null}
          {link ? (
            <Button variant="secondary" size="sm" onClick={() => setEditingProfile(true)}>
              {t("Edit library profile")}
            </Button>
          ) : null}
          {updatesProfile ? null : (
            <SegmentedControl
              label={t("Library availability")}
              value={scope}
              options={[
                { value: "project", label: t("This project") },
                { value: "global", label: t("All projects") },
              ]}
              onValueChange={(value) => onScopeChange(value === "global" ? "global" : "project")}
            />
          )}
          <Button
            variant="secondary"
            size="sm"
            loading={pendingAction === "library"}
            disabled={pending || !agent.candidates.length || !agent.name.trim()}
            onClick={onSaveToLibrary}
          >
            {updatesProfile ? t("Update library profile") : t("Save to library")}
          </Button>
        </div>
      </section>
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
        <span className="text-ui-body font-medium">{t("Responsibility in the crew")}</span>
        <SegmentedControl
          label={t("Responsibility in the crew")}
          value={agent.role}
          options={(["coordinator", "specialist", "reviewer", "advisor"] as const).map((role) => ({
            value: role,
            label: roleLabel(role),
          }))}
          onValueChange={(role) => onChange({ role: role as CrewRole })}
        />
      </div>
      {link && editingProfile ? (
        <CrewLibraryProfileDialog
          cwd={cwd}
          state={state}
          data={data}
          profile={link.profile}
          groupNames={groupNames}
          onClose={() => setEditingProfile(false)}
        />
      ) : null}
      {definitionId ? (
        <MemberPerformance state={state} definitionId={definitionId} memberId={agent.id} />
      ) : null}
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
        identity={identity}
        tools={data.toolsSupported}
        machineId={data.machine.id}
        modelPoolsSupported={data.modelPoolsSupported}
        handleError={handleError}
        traits={traits}
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
    </Surface>
  );
}
