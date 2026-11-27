import { t } from "../../../shared/i18n";
import { Button } from "../../../shared/ui/Button";
import { ChevronLeft } from "../../../shared/ui/icons";
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
  onBack,
}: {
  cwd: string;
  data: ProjectCrews;
  additions: CrewAdditions;
  onBack: () => void;
}) {
  const { newMember, issues } = additions;
  return (
    <>
      {/* The dialog title names this page; entering it moves focus to the way back. */}
      <div className="flex items-center">
        <Button variant="ghost" startIcon={<ChevronLeft />} onClick={onBack} data-page-heading>
          {t("Back to team")}
        </Button>
      </div>
      <CrewMemberPicker
        cwd={cwd}
        data={data}
        mode={additions.mode}
        onModeChange={additions.setMode}
        selected={additions.picked}
        onSelectedChange={additions.setPicked}
        draft={newMember}
        onDraftChange={(patch) => additions.setNewMember((current) => ({ ...current, ...patch }))}
        nameError={issues && !newMember.name.trim() ? t("Add a name") : undefined}
        modelError={issues && !newMember.candidates.length ? t("Choose a model") : undefined}
      />
    </>
  );
}

export function CrewEditorAddFooter({
  data,
  additions,
  pending,
  onAdd,
}: {
  data: ProjectCrews;
  additions: CrewAdditions;
  pending: boolean;
  onAdd: () => void;
}) {
  const { mode, newMember } = additions;
  const { livePicked } = liveAdditions(data, additions);
  return (
    <div className="flex min-w-0 flex-wrap justify-end gap-2">
      {mode === "new" && memberDraftStarted(newMember) ? (
        <Button
          variant="ghost"
          disabled={pending}
          onClick={() => {
            additions.setNewMember(blankMember(data));
            additions.setIssues(false);
          }}
        >
          {t("Discard draft")}
        </Button>
      ) : null}
      <Button
        variant="primary"
        disabled={pending || (mode === "library" && !livePicked.length)}
        disabledReason={
          mode === "library" && !livePicked.length
            ? t("Select at least one member first.")
            : undefined
        }
        onClick={onAdd}
      >
        {mode !== "library"
          ? t("Add to crew")
          : livePicked.length === 0
            ? t("Add members")
            : livePicked.length === 1
              ? t("Add 1 member")
              : t("Add {p0} members", { p0: livePicked.length })}
      </Button>
    </div>
  );
}
