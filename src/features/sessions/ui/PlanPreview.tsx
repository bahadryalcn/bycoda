import { ClampText } from "../../../shared/ui/ClampText";
import { OverflowTooltip } from "../../../shared/ui/Tooltip";
import { Surface } from "../../../shared/ui/Surface";
import { Text } from "../../../shared/ui/Text";
import { Button } from "../../../shared/ui/Button";
import { useT } from "../../../shared/i18n";
import { AiIdea, CircleDashed, Play } from "../../../shared/ui/icons";
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
    <Surface
      variant="card"
      padding="none"
      className="mb-2 overflow-hidden font-sans"
      data-plan-card
    >
      <div className="px-3.5 py-3">
        <div className="flex min-w-0 items-center gap-2.5 text-(--transcript-ink-emphasis)">
          {streaming ? (
            <CircleDashed
              className="icon-md shrink-0 text-(--transcript-ink-chrome)"
              strokeWidth={1.75}
            />
          ) : (
            <AiIdea
              className="icon-md shrink-0 text-(--transcript-ink-chrome)"
              strokeWidth={1.75}
            />
          )}
          <div className="min-w-0 flex-1">
            {onOpen ? (
              <Button
                fullWidth
                variant="item"
                type="button"
                className="block w-full text-start"
                tooltip={title}
                tooltipWhen="overflow"
                onClick={onOpen}
              >
                <Text
                  as="span"
                  size="body"
                  tone="inherit"
                  weight="medium"
                  truncate
                  className="block"
                >
                  {title}
                </Text>
              </Button>
            ) : (
              <OverflowTooltip label={title}>
                <Text
                  as="span"
                  size="body"
                  tone="inherit"
                  weight="medium"
                  truncate
                  className="block font-sans"
                >
                  {title}
                </Text>
              </OverflowTooltip>
            )}
          </div>
        </div>
        {summary ? (
          <ClampText
            as="p"
            lines={3}
            expandable={false}
            size="caption"
            tone="inherit"
            leading="normal"
            className="mt-2 font-sans text-(--transcript-ink-chrome)"
          >
            {summary}
          </ClampText>
        ) : null}
        {onBuild ? (
          <div className="mt-3 flex flex-wrap items-center justify-end gap-2">
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
          </div>
        ) : null}
      </div>
    </Surface>
  );
}
