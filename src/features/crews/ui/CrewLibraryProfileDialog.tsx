import { useRef, useState } from "react";
import { FieldGroup } from "../../../shared/ui/FieldGroup";
import { t, useLocale } from "../../../shared/i18n";
import { InlineError } from "../../../shared/ui/InlineError";
import { Badge } from "../../../shared/ui/Badge";
import { Button } from "../../../shared/ui/Button";
import { ConfirmMorph } from "../../../shared/ui/ConfirmMorph";
import { useConfirm } from "../../../shared/ui/ConfirmDialog";
import { Modal } from "../../../shared/ui/Modal";
import { RadioGroup } from "../../../shared/ui/RadioGroup";
import { Text } from "../../../shared/ui/Text";
import { Trash2 } from "../../../shared/ui/icons";
import { parseCrewAgent, type CrewAgent, type SavedCrewAgent } from "../model/crew";
import type { ProjectCrews, useProjectCrews } from "../model/crewClient";
import { catalogCandidate, catalogModels, newCrewMember } from "../model/crewRoster";
import { CrewMemberForm } from "./CrewMemberForm";
import { presentRemoteError } from "../../connections/public/remoteFailure";

type CrewState = ReturnType<typeof useProjectCrews>;

function savedProfileMatches(saved: SavedCrewAgent, profile: CrewAgent & { projectId?: string }) {
  if (saved.projectId !== profile.projectId) return false;
  // The host validates profiles and deliberately clears inferred capabilities.
  const expected = parseCrewAgent(profile);
  for (const candidate of expected.candidates) candidate.capabilities = {};
  return JSON.stringify(parseCrewAgent(saved)) === JSON.stringify(expected);
}

/**
 * The one dialog that creates or edits a library profile, opened from the Members tab and from
 * a crew member's detail. The Host carries a saved change into every linked member that is not
 * customized, so an open crew editor picks it up on refresh.
 */
export function CrewLibraryProfileDialog({
  cwd,
  state,
  data,
  saved,
  onClose,
}: {
  cwd: string;
  state: CrewState;
  data: ProjectCrews;
  /** The profile to edit; absent creates a new one. */
  saved?: SavedCrewAgent;
  onClose: () => void;
}) {
  useLocale();
  const [agent, setAgent] = useState<CrewAgent>(() => {
    if (saved) {
      const { projectId: _scope, updatedAt: _updated, ...profile } = structuredClone(saved);
      return profile;
    }
    const first = catalogModels(data.catalog)[0];
    return newCrewMember(
      "specialist",
      "",
      first ? catalogCandidate(data.catalog, `${first.harness}/${first.id}`) : undefined,
      data.modelPoolsSupported,
    );
  });
  const [scope, setScope] = useState<"project" | "global">(
    saved ? (saved.projectId ? "project" : "global") : "project",
  );
  const [pendingAction, setPendingAction] = useState<"save" | "copy" | "delete" | null>(null);
  const pending = pendingAction !== null;
  const [error, setError] = useState("");
  const [showIssues, setShowIssues] = useState(false);
  const gate = useRef(false);
  const copyId = useRef<string | null>(null);
  const attemptedIds = useRef(new Set<string>());
  const run = async (action: "save" | "copy", operation: () => Promise<unknown>) => {
    if (gate.current) return;
    gate.current = true;
    setPendingAction(action);
    setError("");
    try {
      await operation();
      onClose();
    } catch (reason) {
      setError(presentRemoteError(reason, { explicit: true }));
    } finally {
      gate.current = false;
      setPendingAction(null);
    }
  };
  const valid = !!agent.name.trim() && !!agent.candidates.length;
  // An edit in progress is not dropped by a stray Escape or backdrop click (CWS-05).
  const [initial] = useState(() => JSON.stringify([agent, scope]));
  const dirty = JSON.stringify([agent, scope]) !== initial;
  const { confirm, dialog: confirmDialog } = useConfirm();
  const requestClose = () => {
    if (pending) return;
    if (!dirty) return onClose();
    void confirm({
      title: t("Discard changes?"),
      message: t("Your edits to this member have not been saved."),
      confirmLabel: t("Discard changes"),
    }).then((ok) => {
      if (ok) onClose();
    });
  };
  const save = (copy: boolean) => {
    if (!valid) {
      setShowIssues(true);
      return;
    }
    const projectId = (copy ? "global" : scope) === "project" ? data.project.id : undefined;
    if (copy && !copyId.current) copyId.current = crypto.randomUUID();
    const profile = {
      ...agent,
      name: agent.name.trim(),
      id: copy ? copyId.current! : (saved?.id ?? agent.id),
      projectId,
    };
    void run(copy ? "copy" : "save", async () => {
      if (attemptedIds.current.has(profile.id)) {
        const refreshed = await state.refetch();
        if (refreshed.error) throw refreshed.error;
        const receipt = refreshed.data?.agents.find((item) => item.id === profile.id);
        if (receipt && savedProfileMatches(receipt, profile)) return receipt;
      }
      attemptedIds.current.add(profile.id);
      return await state.call("crews.agent.save", {
        agent: profile,
        expectedUpdatedAt: saved && !copy ? saved.updatedAt : undefined,
      });
    });
  };
  return (
    <Modal
      title={saved ? saved.name : t("New library member")}
      size="md"
      onClose={requestClose}
      footer={
        <>
          {saved && data.deleteSupported ? (
            <ConfirmMorph
              label={t("Delete")}
              icon={<Trash2 aria-hidden className="icon-sm" />}
              tone="danger"
              confirmMode="press"
              disabled={pending}
              onConfirm={async () => {
                if (gate.current) return;
                gate.current = true;
                setPendingAction("delete");
                setError("");
                try {
                  await state.call("crews.agent.delete", { agentId: saved.id });
                  onClose();
                } catch (reason) {
                  setError(presentRemoteError(reason, { explicit: true }));
                  throw reason;
                } finally {
                  gate.current = false;
                  setPendingAction(null);
                }
              }}
            />
          ) : null}
          <span className="min-w-0 flex-1" />
          {saved?.projectId ? (
            <Button
              variant="ghost"
              loading={pendingAction === "copy"}
              disabled={pending}
              onClick={() => save(true)}
            >
              {t("Copy to all projects")}
            </Button>
          ) : null}
          <Button
            variant="primary"
            loading={pendingAction === "save"}
            disabled={pending}
            onClick={() => save(false)}
          >
            {t("Save")}
          </Button>
        </>
      }
    >
      <FieldGroup variant="bare" disabled={pending}>
        <div className="flex min-w-0 flex-col gap-3">
          {error ? <InlineError details={error} /> : null}
          <CrewMemberForm
            cwd={cwd}
            agent={agent}
            identity={data.identitySupported}
            tools={data.toolsSupported}
            machineId={data.machine.id}
            projectId={data.project.id}
            modelPoolsSupported={data.modelPoolsSupported}
            handleError={/handle/i.test(error) ? error : undefined}
            onChange={(patch) => setAgent((current) => ({ ...current, ...patch }))}
            groups={data.groupsSupported}
            nameError={showIssues && !agent.name.trim() ? t("Add a name") : undefined}
            modelError={showIssues && !agent.candidates.length ? t("Choose a model") : undefined}
            autoFocus={!saved}
          />
          <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
            <Text size="body" tone="inherit" weight="medium">
              {t("Available in")}
            </Text>
            {saved ? (
              <Badge size="md">
                {saved.projectId ? t("This project") : t("All projects on this host")}
              </Badge>
            ) : (
              <RadioGroup
                variant="inline"
                label={t("Available in")}
                value={scope}
                options={[
                  { value: "project", label: t("This project") },
                  { value: "global", label: t("All projects") },
                ]}
                onValueChange={(value) => setScope(value === "global" ? "global" : "project")}
              />
            )}
          </div>
          {confirmDialog}
        </div>
      </FieldGroup>
    </Modal>
  );
}
