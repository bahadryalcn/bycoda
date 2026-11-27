import { Text } from "../../../shared/ui/Text";
import { useState } from "react";
import { t, useLocale } from "../../../shared/i18n";
import { Alert } from "../../../shared/ui/Alert";
import { Button } from "../../../shared/ui/Button";
import { Surface } from "../../../shared/ui/Surface";
import { RadioGroup } from "../../../shared/ui/RadioGroup";
import type { CrewAgent } from "../model/crew";
import type { ProjectCrews, useProjectCrews } from "../model/crewClient";
import { libraryVersionPatch, memberLink } from "../model/crewLink";
import type { MemberAvatarTraits } from "../model/memberAvatarTraits";
import { libraryUpdate, memberFromLibrary } from "../model/crewRoster";
import { CrewLibraryProfileDialog } from "./CrewLibraryProfileDialog";
import { CrewMemberForm } from "./CrewMemberForm";
import { useMemberReviews } from "./MemberReviews";

export type CrewBusyAction = "save" | "library" | null;

/**
 * The open member row: the member form edited in place, plus one line for its library profile.
 * The pinned model is edited in the row itself.
 */
export function CrewMemberDetail({
  cwd,
  state,
  data,
  traits,
  handleError,
  agent,
  scope,
  onScopeChange,
  pending,
  pendingAction,
  showIssues,
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
  agent: CrewAgent;
  scope: "project" | "global";
  onScopeChange: (scope: "project" | "global") => void;
  pending: boolean;
  pendingAction: CrewBusyAction;
  showIssues: boolean;
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
  const reviews = useMemberReviews(state, definitionId, agent.id);
  const updatesProfile = !!source && source.projectId === projectId;
  const libraryName = link ? link.profile.name : source?.name;
  return (
    <Surface variant="card" padding="md" className="mt-1 mb-3 flex min-w-0 flex-col gap-4">
      <section
        aria-label={t("Member library")}
        className="flex min-w-0 flex-wrap items-center justify-between gap-x-3 gap-y-2"
      >
        {libraryName ? (
          <Text truncate className="min-w-0 flex-1 basis-56">
            {link
              ? t("Library: {p0}", { p0: libraryName })
              : t("From library: {p0}", { p0: libraryName })}
          </Text>
        ) : (
          <span className="flex-1" />
        )}
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
            <RadioGroup
              variant="inline"
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
      {link && editingProfile ? (
        <CrewLibraryProfileDialog
          cwd={cwd}
          state={state}
          data={data}
          saved={link.profile}
          onClose={() => setEditingProfile(false)}
        />
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
        cwd={cwd}
        agent={agent}
        onChange={onChange}
        groups={data.groupsSupported}
        identity={identity}
        tools={data.toolsSupported}
        machineId={data.machine.id}
        projectId={data.project.id}
        modelPoolsSupported={data.modelPoolsSupported}
        handleError={handleError}
        traits={traits}
        nameError={showIssues && !agent.name.trim() ? t("Add a name") : undefined}
        modelError={showIssues && !agent.candidates.length ? t("Choose a model") : undefined}
        reviews={reviews.section}
        onMoreOpen={reviews.onOpen}
      />
    </Surface>
  );
}
