import { Button } from "../../../shared/ui/Button";
import { useT } from "../../../shared/i18n";
import { AiIdea, CircleDashed, PanelRight, Play } from "../../../shared/ui/icons";
import { planSummary, planTitle } from "../model/plan";
import type { HarnessId, PlanBlockMeta, PlanBuildTarget } from "../model/session";
import { BuildTargetButton } from "./SecondOpinionButton";

type Props = {
  text: string;
  streaming?: boolean;
  busy?: boolean;
  plan?: PlanBlockMeta;
  harness?: HarnessId;
  model?: string;
  modelSettings?: Record<string, string>;
  onOpen?: () => void;
  onBuild?: (target?: PlanBuildTarget) => void;
};

export function PlanPreview({
  text,
  streaming,
  busy,
  plan,
  harness,
  model,
  modelSettings,
  onOpen,
  onBuild,
}: Props) {
  const t = useT();
  const title = planTitle(text);
  const summary = planSummary(text);
  const buildDisabled =
    busy ||
    streaming ||
    !text.trim() ||
    plan?.status === "streaming" ||
    plan?.status === "building" ||
    plan?.status === "built";
  const buildLabel =
    plan?.status === "building"
      ? t("Building…")
      : plan?.status === "built"
        ? t("Built")
        : t("Build");

  return (
    <div className="mb-2 overflow-hidden rounded-xl border border-(--ui-tone-neutral-border) bg-(--ui-surface-raised)">
      <div className="flex items-start gap-2.5 px-3 py-2.5">
        {streaming ? (
          <CircleDashed
            className="mt-0.5 size-4 shrink-0 text-(--ui-text-secondary)"
            strokeWidth={1.75}
          />
        ) : (
          <AiIdea
            className="mt-0.5 size-4 shrink-0 text-(--ui-text-secondary)"
            strokeWidth={1.75}
          />
        )}
        <div className="min-w-0 flex-1">
          {onOpen ? (
            <Button
              fullWidth
              variant="item"
              type="button"
              className="block w-full truncate text-left"
              title={title}
              onClick={onOpen}
            >
              {title}
            </Button>
          ) : (
            <span
              className="block truncate font-sans text-ui-secondary font-medium text-(--ui-text-secondary)"
              title={title}
            >
              {title}
            </span>
          )}
          {summary ? (
            <p className="mt-0.5 line-clamp-3 font-sans text-ui-caption leading-4.5 text-(--ui-text-secondary)">
              {summary}
            </p>
          ) : null}
          {onOpen || onBuild ? (
            <div className="mt-2 flex items-center justify-end gap-1.5">
              {onOpen ? (
                <Button
                  variant="ghost"
                  type="button"
                  title={t("Open in pane")}
                  aria-label={t("Open plan in pane")}
                  className="shrink-0"
                  onClick={onOpen}
                >
                  <PanelRight className="size-3" strokeWidth={1.75} />
                  {t("Open")}
                </Button>
              ) : null}
              {onBuild ? (
                <div className="flex items-center gap-0.5 font-sans">
                  <Button
                    className="shrink-0"
                    variant="secondary"
                    type="button"
                    title={t("Build this plan")}
                    disabled={buildDisabled}
                    onClick={() => onBuild()}
                  >
                    <Play className="size-3" strokeWidth={1.75} />
                    {buildLabel}
                  </Button>
                  {harness ? (
                    <BuildTargetButton
                      from={harness}
                      model={model}
                      settings={modelSettings}
                      disabled={buildDisabled}
                      onPick={onBuild}
                    />
                  ) : null}
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
