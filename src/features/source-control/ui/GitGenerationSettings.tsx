import { lazy, Suspense, useRef, useState, useSyncExternalStore } from "react";
import { t, useLocale } from "../../../shared/i18n/git";
import { ChevronDown } from "../../../shared/ui/icons";
import { Popover } from "../../../shared/ui/Popover";
import { Button } from "../../../shared/ui/Button";
import {
  parseGitGenerationChoice,
  useDefaultGitGenerationChoice,
} from "../model/gitGenerationPreferences";
const ModelPicker = lazy(() =>
  import("../../sessions/ui/ModelPicker").then((module) => ({
    default: module.ModelPicker,
  })),
);
import { defaultModelId, mergeModelSettings, resolveModel } from "../../sessions/model/models";
import { HARNESS_TITLE, type HarnessId } from "../../sessions/model/session";
import {
  defaultProviderAccountId,
  providerAccountLabel,
  subscribeProviderAccounts,
  supportsProviderAccounts,
} from "../../providers/model/providerAccounts";
import {
  TEXT_HARNESSES,
  pickTextHarness,
  automaticGitChoice,
  type GitGenerationChoice,
} from "../model/gitGenerationChoice";

const KEY = "bycoda.gitGeneration.v1:";
function load(cwd: string): GitGenerationChoice | undefined {
  try {
    return parseGitGenerationChoice(localStorage.getItem(KEY + cwd));
  } catch {
    return;
  }
}

export function useGitGenerationChoice(cwd: string) {
  const defaultChoice = useDefaultGitGenerationChoice();
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
  return [choice ?? defaultChoice, update, !!choice] as const;
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
    <Suspense fallback={<span>{t("Loading…")}</span>}>
      <ModelPicker
        harness={harness}
        model={model.id}
        values={values}
        project={cwd}
        allowedHarnesses={TEXT_HARNESSES}
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
    () => supportsProviderAccounts(harness)
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
        title={`${t("Commit and pull request generation")} · ${choice ? model.name : `${t("Automatic")} · ${model.name}`}`}
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        className="relative shrink-0"
      >
        {choice && <span className="absolute right-0.5 top-0.5 size-1 rounded-full bg-accent" />}
        <ChevronDown className={`size-3 shrink-0 ${open ? "rotate-180" : ""}`} />
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
          <p className="text-ui-body font-medium">{t("Commit and pull request generation")}</p>
          {!choice && (
            <p className="text-ui-caption text-(--ui-text-secondary)">{t("Automatic")}</p>
          )}
          <GitGenerationModelControl
            cwd={cwd}
            preferred={preferred}
            choice={choice}
            onChange={onChange}
            disabled={disabled}
          />
          <details className="text-ui-caption text-(--ui-text-secondary)">
            <summary className="cursor-pointer py-1">{t("Effective generation configuration")}</summary>
            <p className="my-2">{t(hasOverride ? "Checkout override" : choice ? "Global generation default" : "Automatic generation selection")}</p>
            <dl className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1">
              <dt>{t("Provider")}</dt><dd className="break-words">{HARNESS_TITLE[harness]}</dd>
              <dt>{t("Model")}</dt><dd className="break-words">{model.name}</dd>
              {account ? <><dt>{t("Account")}</dt><dd className="break-words">{account}</dd></> : null}
            </dl>
            <p className="my-2">{t(account ? "Uses the provider default account at generation time." : "Uses the provider CLI's current account.")}</p>
          </details>
          {hasOverride && (
            <Button
              size="sm"
              variant="link"
              className="self-start"
              disabled={disabled}
              onClick={() => onChange(undefined)}
            >
              {t("Use default selection")}
            </Button>
          )}
        </Popover>
      )}
    </>
  );
}
