import { errorText } from "../../../shared/lib/errors";
import { useEffect, useRef, useState } from "react";
import { t, useLocale } from "../../../shared/i18n";
import { Button } from "../../../shared/ui/Button";
import { Modal, ModalActions } from "../../../shared/ui/Modal";
import { Alert } from "../../../shared/ui/Alert";
import { Text } from "../../../shared/ui/Text";
import { SectionLabel } from "../../../shared/ui/SectionLabel";
import { Settings } from "../../../shared/ui/icons";
import { useConfirm } from "../../../shared/ui/ConfirmDialog";
import { openModelsSettings } from "../../settings/public/modelsSettingsLink";
import {
  autoGroupSkills,
  listSkillGroups,
  replaceAllSkillGroups,
  appendSkillGroups,
  type GroupingSkill,
  type SkillGroupInput,
} from "../index";
export function AutoGroupDialog({ cwd, skills }: { cwd: string; skills: GroupingSkill[] }) {
  useLocale();
  const { confirm, dialog } = useConfirm();
  const [running, setRunning] = useState(false);
  const [proposal, setProposal] = useState<SkillGroupInput[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const request = useRef<AbortController | null>(null);
  // oxlint-disable-next-line bycoda/effect-names-its-sync -- Keep isolated grouping request lifetime in sync with its mounted page.
  useEffect(
    () => () => {
      request.current?.abort();
    },
    [],
  );
  const run = async () => {
    const controller = new AbortController();
    request.current = controller;
    setRunning(true);
    setError(null);
    try {
      const result = await autoGroupSkills({
        cwd,
        skills,
        signal: controller.signal,
      });
      if (!controller.signal.aborted) setProposal(result);
    } catch (cause) {
      if (!controller.signal.aborted) setError(errorText(cause));
    } finally {
      if (request.current === controller) {
        request.current = null;
        setRunning(false);
      }
    }
  };
  const apply = (merge: boolean) => {
    if (!proposal) return;
    try {
      if (merge) appendSkillGroups(proposal);
      else replaceAllSkillGroups(proposal);
      setProposal(null);
      setError(null);
    } catch (cause) {
      setError(errorText(cause));
    }
  };
  // Replacing deletes the owner's groups and their ids, so it runs only after an explicit danger confirm.
  const replace = async () => {
    const approved = await confirm({
      title: t("Replace skill groups?"),
      message: t(
        "These groups will be deleted and cannot be restored. Installed skills stay unchanged.",
      ),
      consequences: listSkillGroups().map((group) => ({ content: group.name, tone: "danger" })),
      confirmLabel: t("Replace groups"),
      danger: true,
    });
    if (approved) apply(false);
  };
  return (
    <>
      <Button
        size="sm"
        disabled={running || !skills.length}
        loading={running}
        onClick={() => {
          void run();
        }}
      >
        {t("Group with AI")}
      </Button>
      {running ? (
        <Button
          size="sm"
          onClick={() => {
            request.current?.abort();
            request.current = null;
            setRunning(false);
          }}
        >
          {t("Cancel")}
        </Button>
      ) : null}
      <Button
        variant="ghost"
        size="sm"
        iconOnly
        label={t("Manage models")}
        onClick={() => openModelsSettings("roles")}
      >
        <Settings className="icon-sm" aria-hidden="true" />
      </Button>
      {error && !proposal ? (
        <div className="basis-full">
          <Alert tone="danger">{error}</Alert>
        </div>
      ) : null}
      {proposal ? (
        <Modal
          title={t("Review skill groups")}
          onClose={() => setProposal(null)}
          size="md"
          footer={
            <ModalActions>
              <Button onClick={() => setProposal(null)}>{t("Cancel")}</Button>
              <Button variant="secondary" tone="danger" onClick={() => void replace()}>
                {t("Replace my groups")}
              </Button>
              <Button variant="primary" onClick={() => apply(true)}>
                {t("Add as new groups")}
              </Button>
            </ModalActions>
          }
        >
          <Text as="p" tone="secondary">
            {t("Review before applying. Installed skills stay unchanged.")}
          </Text>
          {error ? <Alert tone="danger">{error}</Alert> : null}
          {proposal.map((group, index) => (
            <section key={index}>
              <SectionLabel count={group.skillNames.length}>{group.name}</SectionLabel>
              <Text as="p">{group.skillNames.join(", ")}</Text>
            </section>
          ))}
        </Modal>
      ) : null}
      {dialog}
    </>
  );
}
