import { t } from "../../../shared/i18n";
import { Button } from "../../../shared/ui/Button";
import { ChevronLeft } from "../../../shared/ui/icons";
import type { CrewRole } from "../model/crew";
import type { ProjectCrews } from "../model/crewClient";
import { blankMember } from "../model/crewEditorDraft";
import { memberDraftStarted } from "../model/crewRoster";
import { CrewMemberPicker } from "./CrewMemberPicker";
import type { CrewAdditions } from "./useCrewAdditions";

/** Picks that still exist in the library, and whether anything unfinished is being kept. */
export function liveAdditions(data: ProjectCrews, additions: CrewAdditions) {
  const livePicked = additions.picked.filter((id) => data.agents.some((agent) => agent.id === id));
  return {
    livePicked,
    unfinished: livePicked.length > 0 || memberDraftStarted(additions.newMember),
  };
}

export function CrewEditorAddPage({
  cwd,
  data,
  additions,
  role,
  onBack,
}: {
  cwd: string;
  data: ProjectCrews;
  additions: CrewAdditions;
  role?: CrewRole;
  onBack: () => void;
}) {
  const { newMember, issues } = additions;
  return (
    <>
      <div className="flex items-center gap-2">
        <Button variant="ghost" startIcon={<ChevronLeft />} onClick={onBack}>
          {t("Back to team")}
        </Button>
        <h3 tabIndex={-1} data-page-heading className="text-ui-title font-medium">
          {t("Add members")}
        </h3>
      </div>
      <CrewMemberPicker
        cwd={cwd}
        data={data}
        mode={additions.mode}
        onModeChange={additions.setMode}
        selected={additions.picked}
        onSelectedChange={(next) => {
          if (!additions.picked.length && next.length) additions.setPickedFor(role);
          additions.setPicked(next);
        }}
        draft={newMember}
        onDraftChange={(patch) => additions.setNewMember((current) => ({ ...current, ...patch }))}
        role={role}
        nameError={issues && !newMember.name.trim() ? t("Add a name") : undefined}
        modelError={issues && !newMember.candidates.length ? t("Choose a model") : undefined}
        libraryScope={additions.scope}
        onLibraryScopeChange={additions.setScope}
        saveToLibrary={additions.saveToLibrary}
        onSaveToLibraryChange={additions.setSaveToLibrary}
      />
    </>
  );
}

export function CrewEditorAddFooter({
  data,
  additions,
  role,
  pending,
  adding,
  onAdd,
}: {
  data: ProjectCrews;
  additions: CrewAdditions;
  role?: CrewRole;
  pending: boolean;
  adding: boolean;
  onAdd: () => void;
}) {
  const { mode, newMember, issues } = additions;
  const { livePicked } = liveAdditions(data, additions);
  return (
    <>
      <div role="status" className="flex min-w-0 flex-col gap-0.5">
        {mode === "new" && issues && (!newMember.name.trim() || !newMember.candidates.length) ? (
          <span className="min-w-0 break-words text-ui-caption text-danger">
            {t("Every member needs a name and a model.")}
          </span>
        ) : null}
        {mode === "library" && livePicked.length ? (
          // The picker names the picks and what its filter hides; the add keeps every pick.
          <span className="min-w-0 break-words text-ui-caption text-(--ui-text-secondary)">
            {t("Adds all {p0} picked members, including any the filter hides.", {
              p0: livePicked.length,
            })}
          </span>
        ) : null}
      </div>
      <div className="flex min-w-0 flex-wrap justify-end gap-2">
        {mode === "new" && memberDraftStarted(newMember) ? (
          <Button
            variant="ghost"
            disabled={pending}
            onClick={() => {
              additions.setNewMember(blankMember(data, role));
              additions.setSaveToLibrary(false);
              additions.setIssues(false);
            }}
          >
            {t("Discard draft")}
          </Button>
        ) : null}
        <Button
          variant="primary"
          loading={adding}
          disabled={pending || (mode === "library" && !livePicked.length)}
          onClick={onAdd}
        >
          {mode === "library"
            ? livePicked.length === 1
              ? t("Add 1 member")
              : t("Add {p0} members", { p0: livePicked.length })
            : t("Add to crew")}
        </Button>
      </div>
    </>
  );
}
