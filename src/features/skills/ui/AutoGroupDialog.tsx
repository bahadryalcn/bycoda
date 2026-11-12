import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { t, useLocale } from "../../../shared/i18n";
import { Button } from "../../../shared/ui/Button";
import { Modal, ModalActions } from "../../../shared/ui/Modal";
import { Alert } from "../../../shared/ui/Alert";
import { Text } from "../../../shared/ui/Text";
import { SectionLabel } from "../../../shared/ui/SectionLabel";
import { LoadingText } from "../../../shared/ui/LoadingText";
import {
  autoGroupSkills,
  replaceAllSkillGroups,
  appendSkillGroups,
  useSkillGroupingModel,
  setSkillGroupingModel,
  listSkillGroupingModels,
  type GroupingSkill,
  type SkillGroupInput,
  type SkillGroupingModel,
} from "../index";
import { defaultModelSettings, resolveModel } from "../../sessions/public/models";

const ModelPicker = lazy(() =>
  import("../../sessions")
    .then((entry) => entry.loadModelPicker())
    .then((module) => ({ default: module.ModelPicker })),
);

export function AutoGroupDialog({ cwd, skills }: { cwd: string; skills: GroupingSkill[] }) {
  useLocale();
  const stored = useSkillGroupingModel();
  const options = listSkillGroupingModels();
  const choice = stored ?? options[0];
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
  const commit = (next: SkillGroupingModel) => {
    try {
      setSkillGroupingModel(next);
      setError(null);
    } catch (cause) {
      setError(String(cause));
    }
  };
  const run = async () => {
    const controller = new AbortController();
    request.current = controller;
    setRunning(true);
    setError(null);
    try {
      const result = await autoGroupSkills({
        cwd,
        skills,
        model: choice,
        signal: controller.signal,
      });
      if (!controller.signal.aborted) setProposal(result);
    } catch (cause) {
      if (!controller.signal.aborted) setError(String(cause));
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
      setError(String(cause));
    }
  };
  return (
    <>
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <Button
          size="sm"
          disabled={running || !skills.length || !choice}
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
        {choice ? (
          <Suspense fallback={<LoadingText />}>
            <ModelPicker
              harness={choice.harness}
              model={choice.model}
              values={stored?.modelSettings ?? {}}
              accountId={stored?.providerAccountId}
              accountChoices
              allowedHarnesses={[...new Set(options.map((option) => option.harness))]}
              onChange={(harness, model, accountId) =>
                commit({
                  harness,
                  model,
                  providerAccountId: accountId,
                  modelSettings: defaultModelSettings(resolveModel(harness, model)),
                })
              }
              onSettingsChange={(modelSettings) => commit({ ...choice, modelSettings })}
            />
          </Suspense>
        ) : null}
      </div>
      {error && !proposal ? <Alert tone="danger">{error}</Alert> : null}
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
