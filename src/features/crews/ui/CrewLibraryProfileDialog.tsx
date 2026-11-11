import { useState } from "react";
import { FieldGroup } from "../../../shared/ui/FieldGroup";
import { t, useLocale } from "../../../shared/i18n";
import { Alert } from "../../../shared/ui/Alert";
import { Button } from "../../../shared/ui/Button";
import { InfoPopover } from "../../../shared/ui/InfoPopover";
import { Modal } from "../../../shared/ui/Modal";
import type { CrewAgent, SavedCrewAgent } from "../model/crew";
import type { ProjectCrews, useProjectCrews } from "../model/crewClient";
import { CrewMemberForm } from "./CrewMemberForm";

/**
 * Edits one library profile from inside a crew. The Host carries the change into every
 * linked member that is not customized, so an open crew editor picks it up on refresh.
 */
export function CrewLibraryProfileDialog({
  cwd,
  state,
  data,
  profile,
  groupNames,
  onClose,
}: {
  cwd: string;
  state: ReturnType<typeof useProjectCrews>;
  data: ProjectCrews;
  profile: SavedCrewAgent;
  groupNames: string[];
  onClose: () => void;
}) {
  useLocale();
  const [agent, setAgent] = useState<CrewAgent>(() => {
    const { projectId: _scope, updatedAt: _updated, ...rest } = structuredClone(profile);
    return rest;
  });
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [showIssues, setShowIssues] = useState(false);
  const valid = !!agent.name.trim() && agent.candidates.length > 0;
  const save = () => {
    if (!valid) return setShowIssues(true);
    setPending(true);
    setError("");
    state
      .call("crews.agent.save", {
        agent: { ...agent, name: agent.name.trim(), id: profile.id, projectId: profile.projectId },
        expectedUpdatedAt: profile.updatedAt,
      })
      .then(onClose, (reason: unknown) => {
        setError(reason instanceof Error ? reason.message : String(reason));
        setPending(false);
      });
  };
  return (
    <Modal
      title={t("Edit library profile")}
      context={profile.name}
      size="md"
      onClose={() => {
        if (!pending) onClose();
      }}
      footer={
        <>
          <span className="min-w-0 flex-1">
            <InfoPopover>
              {t(
                "Crews that use this profile unchanged follow it; customized members keep their own edits.",
              )}
            </InfoPopover>
          </span>
          <Button variant="ghost" disabled={pending} onClick={onClose}>
            {t("Cancel")}
          </Button>
          <Button variant="primary" loading={pending} onClick={save}>
            {t("Save")}
          </Button>
        </>
      }
    >
      <FieldGroup variant="bare" disabled={pending}>
        <div className="flex min-w-0 flex-col gap-3">
          {error ? <Alert tone="danger">{error}</Alert> : null}
          <CrewMemberForm
            cwd={cwd}
            catalog={data.catalog}
            agent={agent}
            identity={data.identitySupported}
            tools={data.toolsSupported}
            handleError={/handle/i.test(error) ? error : undefined}
            onChange={(patch) => setAgent((current) => ({ ...current, ...patch }))}
            groups={data.groupsSupported}
            groupSuggestions={groupNames}
            nameError={showIssues && !agent.name.trim() ? t("Add a name") : undefined}
            machineId={data.machine.id}
            projectId={data.project.id}
            modelPoolsSupported={data.modelPoolsSupported}
            modelError={showIssues && !agent.candidates.length ? t("Choose a model") : undefined}
          />
        </div>
      </FieldGroup>
    </Modal>
  );
}
