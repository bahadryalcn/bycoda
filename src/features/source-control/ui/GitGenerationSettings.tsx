import { lazy, Suspense, useRef, useState } from "react";
import { parseGitGenerationChoice } from "../model/gitGenerationPreferences";
const ModelPicker = lazy(() =>
  import("../../sessions")
    .then((entry) => entry.loadModelPicker())
    .then((module) => ({
      default: module.ModelPicker,
    })),
);
import { defaultModelId, mergeModelSettings, resolveModel } from "../../sessions/public/models";
import { HARNESSES, type HarnessId } from "../../sessions";
import { useModelSource } from "../../sessions/public/modelSource";
import { HostModelSource } from "../../connections/public/HostModelSource";
import { useRemoteMachines } from "../../connections/public/connections";
import { parseRemotePath } from "../../connections/public/remoteProjects";
import {
  pickTextHarness,
  automaticGitChoice,
  TEXT_HARNESSES,
  type GitGenerationChoice,
} from "../model/gitGenerationChoice";

import { canRunHarnessTextPrompt } from "../../../integrations/harness";
import { LoadingText } from "../../../shared/ui/LoadingText";
import { Button } from "../../../shared/ui/Button";
import { ButtonGroup } from "../../../shared/ui/ButtonGroup";
import { ChevronDown, WandSparkles, X } from "../../../shared/ui/icons";
import { WorkingIndicator } from "../../../shared/ui/WorkingIndicator";
import { t } from "../../../shared/i18n/git";

const KEY = "bycoda.gitGeneration.v1:";
const COMMIT_KEY = "bycoda.gitCommitGeneration.v1:";
function load(key: string, cwd: string): GitGenerationChoice | undefined {
  try {
    return parseGitGenerationChoice(
      localStorage.getItem(key),
      key.startsWith(COMMIT_KEY) || !!parseRemotePath(cwd),
    );
  } catch {
    return;
  }
}

export function useGitGenerationChoice(cwd: string, kind?: "commit") {
  const key = (kind === "commit" ? COMMIT_KEY : KEY) + cwd;
  const [saved, setSaved] = useState(() => ({ key, choice: load(key, cwd) }));
  if (saved.key !== key) setSaved({ key, choice: load(key, cwd) });
  const choice = saved.key === key ? saved.choice : load(key, cwd);
  const update = (next: GitGenerationChoice | undefined) => {
    setSaved({ key, choice: next });
    try {
      if (next) localStorage.setItem(key, JSON.stringify(next));
      else localStorage.removeItem(key);
    } catch {
      /* unavailable storage */
    }
  };
  return [choice, update, !!choice] as const;
}

type CommitGenerationSettings = {
  cwd: string;
  preferred?: HarnessId;
  choice?: GitGenerationChoice;
  onChange: (choice: GitGenerationChoice | undefined) => void;
};

export function GitCommitGenerationActions({
  cwd,
  preferred,
  choice,
  onChange,
  canGenerate,
  generating,
  generate,
  cancel,
}: CommitGenerationSettings & {
  canGenerate: boolean;
  generating: boolean;
  generate: () => void;
  cancel: () => void;
}) {
  const anchor = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const remote = parseRemotePath(cwd);
  const { machines } = useRemoteMachines(open && !!remote);
  const machine = machines.find((entry) => entry.environmentId === remote?.environmentId);
  const settings = open ? (
    <Suspense fallback={null}>
      <CommitModelPicker
        cwd={cwd}
        preferred={preferred}
        choice={choice}
        onChange={onChange}
        externalTrigger={{ anchor, onDismiss: () => setOpen(false) }}
      />
    </Suspense>
  ) : null;
  const label = t("Model and settings");
  return (
    <>
      {generating ? <WorkingIndicator label={t("Generating message…")} /> : null}
      <ButtonGroup aria-label={t("Commit message")} surface="transparent">
        <Button
          variant="ghost"
          size="xs"
          motion="none"
          iconOnly
          label={generating ? t("Stop commit message generation") : t("Generate commit message")}
          disabled={!generating && !canGenerate}
          disabledReason={
            !generating && !canGenerate
              ? t("Change a file first, then generate a commit message.")
              : undefined
          }
          onClick={generating ? cancel : generate}
        >
          {generating ? <X className="icon-sm" /> : <WandSparkles className="icon-sm" />}
        </Button>
        <Button
          ref={anchor}
          variant="ghost"
          size="xs"
          motion="none"
          iconOnly
          label={label}
          endIcon={<ChevronDown className="icon-xs" />}
          expanded={open}
          aria-haspopup="dialog"
          onClick={() => setOpen(!open)}
        />
      </ButtonGroup>
      {remote && open ? (
        <HostModelSource
          machine={machine}
          cwd={cwd}
          model={choice?.model ?? ""}
          values={choice?.modelSettings ?? {}}
        >
          {settings}
        </HostModelSource>
      ) : (
        settings
      )}
    </>
  );
}

function CommitModelPicker({
  cwd,
  preferred,
  choice,
  onChange,
  externalTrigger,
}: CommitGenerationSettings & {
  externalTrigger: {
    anchor: React.RefObject<HTMLButtonElement | null>;
    onDismiss: () => void;
  };
}) {
  const source = useModelSource();
  const allowed = parseRemotePath(cwd) ? TEXT_HARNESSES : HARNESSES.filter(canRunHarnessTextPrompt);
  const harness =
    choice?.harness ?? preferred ?? allowed.find((id) => source.available(id)) ?? pickTextHarness();
  const model = source.resolve(harness, choice?.model);
  const values = choice?.modelSettings ?? {};
  return (
    <ModelPicker
      harness={harness}
      model={model.id}
      values={values}
      accountId={choice?.providerAccountId}
      accountChoices
      project={cwd}
      allowedHarnesses={allowed}
      settingsScope="reasoning-and-speed"
      openRequest={1}
      externalTrigger={externalTrigger}
      inheritChoice={{
        label: t("Automatic"),
        selected: !choice,
        onSelect: () => onChange(undefined),
      }}
      onChange={(nextHarness, nextModel, providerAccountId) => {
        const resolved = source.resolve(nextHarness, nextModel);
        onChange({
          harness: nextHarness,
          model: resolved.id,
          providerAccountId,
          modelSettings: mergeModelSettings(resolved, nextHarness === harness ? values : undefined),
        });
      }}
      onSettingsChange={(modelSettings) =>
        onChange({ ...choice, harness, model: model.id, modelSettings })
      }
    />
  );
}

export function GitGenerationModelControl({
  cwd,
  preferred,
  choice,
  onChange,
  disabled = false,
}: {
  cwd?: string;
  preferred?: HarnessId;
  choice?: GitGenerationChoice;
  onChange: (choice: GitGenerationChoice) => void;
  disabled?: boolean;
}) {
  const automatic = automaticGitChoice(preferred);
  const harness = choice?.harness ?? pickTextHarness(preferred);
  const model = resolveModel(harness, choice?.model ?? automatic?.model ?? defaultModelId(harness));
  const values = mergeModelSettings(model, choice?.modelSettings ?? automatic?.modelSettings);
  return (
    <Suspense fallback={<LoadingText />}>
      <ModelPicker
        harness={harness}
        model={model.id}
        values={values}
        project={cwd}
        allowedHarnesses={HARNESSES.filter(canRunHarnessTextPrompt)}
        showEffortSummary
        extrasDisabled={disabled}
        onChange={(nextHarness, nextModel) => {
          if (disabled) return;
          const resolved = resolveModel(nextHarness, nextModel);
          onChange({
            harness: nextHarness,
            model: resolved.id,
            modelSettings: mergeModelSettings(
              resolved,
              nextHarness === harness ? values : undefined,
            ),
          });
        }}
        onSettingsChange={(modelSettings) => {
          if (!disabled) onChange({ harness, model: model.id, modelSettings });
        }}
      />
    </Suspense>
  );
}
