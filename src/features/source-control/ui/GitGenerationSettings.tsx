import { lazy, Suspense, useRef, useState } from "react";
import { t, useLocale } from "../../../shared/i18n/git";
import { ChevronDown } from "../../../shared/ui/icons";
import { Popover } from "../../../shared/ui/Popover";
const ModelPicker = lazy(() =>
  import("../../sessions/ui/ModelPicker").then((module) => ({
    default: module.ModelPicker,
  })),
);
const ModelExtras = lazy(() =>
  import("../../sessions/ui/ModelExtras").then((module) => ({
    default: module.ModelExtras,
  })),
);
import { defaultModelId, mergeModelSettings, resolveModel } from "../../sessions/model/models";
import type { HarnessId } from "../../sessions/model/session";
import {
  TEXT_HARNESSES,
  pickTextHarness,
  automaticGitChoice,
  type GitGenerationChoice,
} from "../model/gitGenerationChoice";

const KEY = "bycoda.gitGeneration.v1:";
function load(cwd: string): GitGenerationChoice | undefined {
  try {
    const value = JSON.parse(localStorage.getItem(KEY + cwd) ?? "null");
    if (!value || !TEXT_HARNESSES.includes(value.harness) || typeof value.model !== "string")
      return;
    const model = resolveModel(value.harness, value.model);
    const settings = Object.fromEntries(
      Object.entries(value.modelSettings ?? {}).filter(([, v]) => typeof v === "string"),
    ) as Record<string, string>;
    return {
      harness: value.harness,
      model: model.id,
      modelSettings: mergeModelSettings(model, settings),
    };
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
  return [choice, update] as const;
}

export function GitGenerationSettings({
  cwd,
  preferred,
  choice,
  onChange,
  disabled,
}: {
  cwd: string;
  preferred?: HarnessId;
  choice?: GitGenerationChoice;
  onChange: (choice: GitGenerationChoice | undefined) => void;
  disabled: boolean;
}) {
  useLocale();
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLButtonElement>(null);
  const harness = choice?.harness ?? pickTextHarness(preferred);
  const automatic = automaticGitChoice(preferred);
  const model = resolveModel(harness, choice?.model ?? automatic?.model ?? defaultModelId(harness));
  const values = mergeModelSettings(model, choice?.modelSettings ?? automatic?.modelSettings);
  return (
    <>
      <button
        type="button"
        ref={anchor}
        aria-label={t("AI generation settings")}
        aria-haspopup="dialog"
        title={`${t("Commit and pull request generation")} · ${choice ? model.name : `${t("Automatic")} · ${model.name}`}`}
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        className="relative grid h-5 w-4 shrink-0 place-items-center rounded-r-md border-l border-content/15 text-content/70 hover:bg-content/10 hover:text-content focus-visible:outline focus-visible:outline-1 disabled:opacity-40"
      >
        {choice && <span className="absolute right-0.5 top-0.5 size-1 rounded-full bg-accent" />}
        <ChevronDown className={`size-3 shrink-0 ${open ? "rotate-180" : ""}`} />
      </button>
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
          className="p-3"
        >
          <p className="mb-3 text-[12px] font-medium">{t("Commit and pull request generation")}</p>
          {!choice && (
            <p className="mb-2 text-[11px] text-content/60">
              {t("Automatic")} · {model.name}
            </p>
          )}
          {!choice && (
            <p className="mb-1.5 text-[10px] leading-4 text-content/50">
              {t("Select a model or option below to replace automatic selection.")}
            </p>
          )}
          <span className="mb-1 block text-[10px] text-content/50">{t("Main model")}</span>
          <Suspense fallback={<span className="text-[11px] text-content/50">{t("Loading…")}</span>}>
            <ModelPicker
              harness={harness}
              model={model.id}
              values={values}
              project={cwd}
              allowedHarnesses={TEXT_HARNESSES}
              hideSettings
              showEffortSummary
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
            <div className="mt-1.5 flex flex-wrap gap-1">
              <ModelExtras
                harness={harness}
                model={model.id}
                values={values}
                disabled={disabled}
                onSettingsChange={(modelSettings) => {
                  if (!disabled) onChange({ harness, model: model.id, modelSettings });
                }}
              />
            </div>
          </Suspense>
          {choice && (
            <button
              type="button"
              disabled={disabled}
              className="mt-1 text-[11px] text-content/60 hover:text-content"
              onClick={() => onChange(undefined)}
            >
              {t("Use automatic selection")}
            </button>
          )}
        </Popover>
      )}
    </>
  );
}
