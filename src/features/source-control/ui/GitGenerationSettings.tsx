import { Text } from "../../../shared/ui/Text";
import { lazy, Suspense, useRef, useState, useSyncExternalStore } from "react";
import { t, useLocale } from "../../../shared/i18n/git";
import { ChevronDown } from "../../../shared/ui/icons";
import { Popover } from "../../../shared/ui/Popover";
import { Button } from "../../../shared/ui/Button";
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
import {
  defaultProviderAccountId,
  providerAccountLabel,
  providerAccounts,
  subscribeProviderAccounts,
  supportsProviderAccounts,
} from "../../providers/model/providerAccounts";
import {
  pickTextHarness,
  automaticGitChoice,
  type GitGenerationChoice,
} from "../model/gitGenerationChoice";

import { canRunHarnessTextPrompt } from "../../../integrations/harness";
import { LoadingText } from "../../../shared/ui/LoadingText";

const KEY = "bycoda.gitGeneration.v1:";
function load(cwd: string): GitGenerationChoice | undefined {
  try {
    return parseGitGenerationChoice(localStorage.getItem(KEY + cwd));
  } catch {
    return;
  }
}

export function useGitGenerationChoice(cwd: string) {
  const [saved, setSaved] = useState(() => ({ cwd, choice: load(cwd) }));
  if (saved.cwd !== cwd) setSaved({ cwd, choice: load(cwd) });
  const choice = saved.cwd === cwd ? saved.choice : load(cwd);
  const update = (next: GitGenerationChoice | undefined) => {
    setSaved({ cwd, choice: next });
    try {
      if (next) localStorage.setItem(KEY + cwd, JSON.stringify(next));
      else localStorage.removeItem(KEY + cwd);
    } catch {
      /* unavailable storage */
    }
  };
  return [choice, update, !!choice] as const;
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

export function GitGenerationSettings({
  cwd,
  preferred,
  choice,
  onChange,
  disabled,
  hasOverride = !!choice,
}: {
  cwd: string;
  preferred?: HarnessId;
  choice?: GitGenerationChoice;
  onChange: (choice: GitGenerationChoice | undefined) => void;
  disabled: boolean;
  hasOverride?: boolean;
}) {
  useLocale();
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLButtonElement>(null);
  const harness = choice?.harness ?? pickTextHarness(preferred);
  const automatic = automaticGitChoice(preferred);
  const model = resolveModel(harness, choice?.model ?? automatic?.model ?? defaultModelId(harness));
  const account = useSyncExternalStore(
    subscribeProviderAccounts,
    () =>
      supportsProviderAccounts(harness) && providerAccounts(harness).length > 1
        ? providerAccountLabel(harness, defaultProviderAccountId(harness))
        : "",
    () => "",
  );
  return (
    <>
      <Button
        size="sm"
        iconOnly
        label={t("AI generation settings")}
        variant="ghost"
        motion="none"
        type="button"
        ref={anchor}
        aria-label={t("AI generation settings")}
        aria-haspopup="dialog"
        tooltip={`${t("Commit and pull request generation")} · ${choice ? model.name : `${t("Automatic")} · ${model.name}`}`}
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        className="shrink-0"
      >
        <ChevronDown className={`icon-xs shrink-0 ${open ? "rotate-180" : ""}`} />
      </Button>
      {open && (
        <Popover
          anchor={anchor}
          side="bottom"
          align="end"
          width={320}
          role="dialog"
          aria-label={t("Commit and pull request generation")}
          autoFocus
          onDismiss={() => {
            setOpen(false);
            anchor.current?.focus();
          }}
          className="flex flex-col gap-2 p-3"
        >
          <Text as="p" size="body" tone="inherit" weight="medium">
            {t("Commit and pull request generation")}
          </Text>
          <GitGenerationModelControl
            cwd={cwd}
            preferred={preferred}
            choice={choice}
            onChange={onChange}
            disabled={disabled}
          />
          {account ? (
            <Text as="p" size="caption" tone="secondary">
              {t("Account")} · {account}
            </Text>
          ) : null}
          {hasOverride && (
            <Text as="div" size="caption" tone="secondary" className="flex items-center gap-1">
              <span>{t("Project setting")} ·</span>
              <Button
                size="sm"
                variant="link"
                disabled={disabled}
                onClick={() => onChange(undefined)}
              >
                {t("Use global")}
              </Button>
            </Text>
          )}
        </Popover>
      )}
    </>
  );
}
