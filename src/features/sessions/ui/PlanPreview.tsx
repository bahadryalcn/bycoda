import { OverflowTooltip } from "../../../shared/ui/Tooltip";
import { Surface } from "../../../shared/ui/Surface";
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
    <Surface variant="quiet" padding="none" className="mb-2 overflow-hidden">
      <div className="flex items-start gap-2.5 px-3 py-2.5">
        {streaming ? (
          <CircleDashed
            className="mt-0.5 icon-md shrink-0 text-(--ui-text-secondary)"
            strokeWidth={1.75}
          />
        ) : (
          <AiIdea
            className="mt-0.5 icon-md shrink-0 text-(--ui-text-secondary)"
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
              tooltip={title}
              tooltipWhen="overflow"
              onClick={onOpen}
            >
              {title}
            </Button>
          ) : (
            <OverflowTooltip label={title}>
              <span className="block truncate font-sans text-ui-secondary font-medium text-(--ui-text-secondary)">
                {title}
              </span>
            </OverflowTooltip>
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
                  tooltip={t("Open in pane")}
                  aria-label={t("Open plan in pane")}
                  className="shrink-0"
                  onClick={onOpen}
                >
                  <PanelRight className="icon-xs" strokeWidth={1.75} />
                  {t("Open")}
                </Button>
              ) : null}
              {onBuild ? (
                <div className="flex items-center gap-0.5 font-sans">
                  <Button
                    className="shrink-0"
                    variant="secondary"
                    type="button"
                    disabled={buildDisabled}
                    onClick={() => onBuild()}
                  >
                    <Play className="icon-xs" strokeWidth={1.75} />
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
    </Surface>
  );
}
