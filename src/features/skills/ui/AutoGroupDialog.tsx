import { useEffect, useRef, useState } from "react";
import { t, useLocale } from "../../../shared/i18n";
import { Button } from "../../../shared/ui/Button";
import { Modal, ModalActions } from "../../../shared/ui/Modal";
import { Alert } from "../../../shared/ui/Alert";
import { Text } from "../../../shared/ui/Text";
import { SectionLabel } from "../../../shared/ui/SectionLabel";
import { Settings } from "../../../shared/ui/icons";
import { openModelsSettings } from "../../settings/public/modelsSettingsLink";
import {
  autoGroupSkills,
  replaceAllSkillGroups,
  appendSkillGroups,
  type GroupingSkill,
  type SkillGroupInput,
} from "../index";
export function AutoGroupDialog({ cwd, skills }: { cwd: string; skills: GroupingSkill[] }) {
  useLocale();
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
      if (!controller.signal.aborted)
        setError(cause instanceof Error ? cause.message : String(cause));
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
      setError(cause instanceof Error ? cause.message : String(cause));
    }
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
        label={t("Manage in Models")}
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
              <Button onClick={() => apply(true)}>{t("Add as new groups")}</Button>
              <Button variant="primary" onClick={() => apply(false)}>
                {t("Replace my groups")}
              </Button>
            </ModalActions>
          }
        >
          <Text as="p" tone="secondary">
            {t(
              "Review before applying. Replacing removes your current groups; installed skills stay unchanged.",
            )}
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
    </>
  );
}
