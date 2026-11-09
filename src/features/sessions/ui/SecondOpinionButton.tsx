import { Button } from "../../../shared/ui/Button";
import type { ExpandingButtonGroupTriggerProps } from "../../../shared/ui/ExpandingButtonGroup";
import { useT } from "../../../shared/i18n";
import {
  ChevronDown,
  MessageMultiple,
  Replace,
  type IconComponent,
} from "../../../shared/ui/icons";
import { useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from "react";
import {
  getHarnessAvailabilitySnapshot,
  hasProbedHarnessAvailability,
  isHarnessAvailable,
  probeHarnessAvailability,
  subscribeHarnessAvailability,
} from "../../../integrations/harness/core/availability";
import { refreshHarnessCatalogs } from "../../../integrations/harness/core/registry";
import {
  getModelSnapshot,
  getPickerVisibilitySnapshot,
  hasLiveCatalog,
  isPickerProviderVisible,
  mergeModelSettings,
  modelEffortSetting,
  modelsFor,
  preferredModelId,
  subscribeModels,
  subscribePickerVisibility,
} from "../model/models";
import { secondOpinionTargets } from "../model/secondOpinion";
import { HARNESS_TITLE, type HarnessId, type ModelTarget } from "../model/session";
import { HarnessIcon } from "./HarnessIcon";
import {
  DropdownMenu,
  type DropdownMenuAction,
  type DropdownMenuItem,
} from "../../../shared/ui/DropdownMenu";

type Props = {
  from: HarnessId;
  fromModel?: string;
  fromSettings?: Record<string, string>;
  onPick: (target: ModelTarget) => void;
  icon?: IconComponent;
  title?: string;
  disabledTitle?: string;
  description?: string;
  menuLabel?: string;
  includeCurrent?: boolean;
  /**
   * Hide `fromModel` from `from`'s own model list instead of offering it
   * back as a target. Only the plain "Second opinion" button sets this —
   * `BuildTargetButton` still needs to reselect the same model to change
   * its effort, so it leaves this off.
   */
  excludeFromModel?: boolean;
  disabled?: boolean;
  triggerClassName?: string;
  triggerVariant?: "ghost" | "secondary";
  renderTrigger?: (props: ExpandingButtonGroupTriggerProps) => ReactNode;
};

const MENU_WIDTH = 240;
const SUBMENU_WIDTH = 240;
const SUBMENU_MAX_HEIGHT = 288;

export function HandoffButton({
  from,
  onPick,
  renderTrigger,
}: Pick<Props, "from" | "onPick" | "renderTrigger">) {
  const t = useT();
  return (
    <SecondOpinionButton
      from={from}
      onPick={onPick}
      renderTrigger={renderTrigger}
      icon={Replace}
      title={t("Handoff")}
      disabledTitle="Install another provider to hand off"
      description={t("Hand this session to another agent to continue the work.")}
      menuLabel="Hand this session to another agent"
    />
  );
}

export function BuildTargetButton({
  from,
  model,
  settings,
  disabled,
  onPick,
}: {
  from: HarnessId;
  model?: string;
  settings?: Record<string, string>;
  disabled?: boolean;
  onPick: (target: ModelTarget) => void;
}) {
  const t = useT();
  return (
    <SecondOpinionButton
      from={from}
      fromModel={model}
      fromSettings={settings}
      onPick={onPick}
      icon={ChevronDown}
      title={t("Build with another model")}
      disabledTitle="No build providers are available"
      description={t("Choose the model and provider that should build this plan.")}
      menuLabel="Build this plan with another model or provider"
      includeCurrent
      disabled={disabled}
      triggerVariant="secondary"
    />
  );
}

export function SecondOpinionButton({
  from,
  fromModel,
  fromSettings,
  onPick,
  icon: Icon = MessageMultiple,
  title = "Second opinion",
  disabledTitle = "No different model available for a second opinion",
  description = "Send this turn to another agent to review the work.",
  menuLabel = "Send this turn to another agent",
  includeCurrent = false,
  excludeFromModel = false,
  disabled: disabledByCaller = false,
  triggerClassName,
  triggerVariant = "ghost",
  renderTrigger,
}: Props) {
  const t = useT();
  const availabilityVersion = useSyncExternalStore(
    subscribeHarnessAvailability,
    getHarnessAvailabilitySnapshot,
    getHarnessAvailabilitySnapshot,
  );
  const visibilityVersion = useSyncExternalStore(
    subscribePickerVisibility,
    getPickerVisibilitySnapshot,
    getPickerVisibilitySnapshot,
  );
  const catalogVersion = useSyncExternalStore(subscribeModels, getModelSnapshot, getModelSnapshot);
  const [open, setOpen] = useState(false);
  const [button, setButton] = useState<HTMLButtonElement | null>(null);

  const probed = hasProbedHarnessAvailability();
  const targets = useMemo(() => {
    void availabilityVersion;
    void visibilityVersion;
    return secondOpinionTargets(from, {
      installed: isHarnessAvailable,
      visible: isPickerProviderVisible,
      probed,
      includeCurrent,
    });
  }, [from, includeCurrent, probed, availabilityVersion, visibilityVersion]);

  useEffect(() => {
    if (!open) return;
    void probeHarnessAvailability();
  }, [open]);

  useEffect(() => {
    if (!open || targets.length === 0) return;
    void refreshHarnessCatalogs(targets);
  }, [open, targets]);

  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    window.addEventListener("resize", close);
    return () => window.removeEventListener("resize", close);
  }, [open]);

  // With the current model hidden, a target harness only counts as usable
  // if it still has a model left to offer once that exclusion is applied.
  // A harness whose catalog has not loaded yet (e.g. Codex, which has no
  // built-in fallback list) cannot be confirmed empty, so it gets the
  // benefit of the doubt rather than disabling the button before the menu
  // can even open to trigger `refreshHarnessCatalogs`.
  const hasSelectableModel =
    !excludeFromModel || !fromModel
      ? true
      : targets.some((harness) => {
          if (!hasLiveCatalog(harness)) return true;
          const list = modelsFor(harness);
          return harness === from ? list.some((model) => model.id !== fromModel) : list.length > 0;
        });
  const noTargets = targets.length === 0 || !hasSelectableModel;
  const disabled = disabledByCaller || noTargets;
  const label = noTargets ? disabledTitle : title;

  const modelsOf = (harness: HarnessId) => {
    void catalogVersion;
    const list = modelsFor(harness);
    // The current model is not a second opinion on itself, so it is not an
    // option once the picker lets the turn's own harness back in.
    return excludeFromModel && harness === from && fromModel
      ? list.filter((model) => model.id !== fromModel)
      : list;
  };
  const SEP = "\u0000";
  const pickEncoded = (id: string) => {
    const [harness, modelId, effortValue] = id.split(SEP);
    const model = modelsOf(harness as HarnessId).find((item) => item.id === modelId);
    if (!model) return;
    const effort = modelEffortSetting(model);
    const modelSettings = mergeModelSettings(model, {
      ...(model.id === fromModel ? fromSettings : undefined),
      ...(effort && effortValue ? { [effort.id]: effortValue } : {}),
    });
    setOpen(false);
    onPick({ harness: model.harness, model: model.id, modelSettings });
  };
  const menuItems = (): DropdownMenuItem[] => [
    {
      kind: "content",
      id: "description",
      node: (
        <p className="px-1.5 py-1 text-ui-micro leading-3 text-(--ui-text-secondary) text-balance">
          {description}
        </p>
      ),
    },
    { kind: "sep" },
    ...(targets.length === 0
      ? [
          {
            kind: "content" as const,
            id: "empty",
            node: (
              <div className="px-1.5 py-1 text-ui-caption leading-4 text-(--ui-text-secondary)">
                {disabledTitle}
              </div>
            ),
          },
        ]
      : targets.map((harness): DropdownMenuAction => {
          const list = modelsOf(harness);
          const preferred =
            harness === from && fromModel && !excludeFromModel
              ? fromModel
              : preferredModelId(harness);
          return {
            kind: "item",
            id: harness,
            label: HARNESS_TITLE[harness],
            icon: <HarnessIcon harness={harness} className="size-3.5" />,
            disabled: !isHarnessAvailable(harness) && probed,
            submenu: list.length
              ? list.map((model): DropdownMenuAction => {
                  const effort = modelEffortSetting(model);
                  const current = effort
                    ? model.id === fromModel
                      ? (fromSettings?.[effort.id] ?? effort.value)
                      : effort.value
                    : undefined;
                  return {
                    kind: "item",
                    id: [harness, model.id].join(SEP),
                    label: model.name,
                    checked: model.id === preferred,
                    selectionRole: "radio",
                    submenuWidth: SUBMENU_WIDTH,
                    submenuMaxHeight: SUBMENU_MAX_HEIGHT,
                    submenuLabel: t("{p0} effort", { p0: model.name }),
                    submenu: effort?.options.length
                      ? effort.options.map((option): DropdownMenuAction => ({
                          kind: "item",
                          id: [harness, model.id, option.value].join(SEP),
                          label: option.label,
                          checked: option.value === current,
                          selectionRole: "radio",
                        }))
                      : undefined,
                  };
                })
              : undefined,
            submenuLabel: t("{p0} models", { p0: HARNESS_TITLE[harness] }),
            submenuWidth: SUBMENU_WIDTH,
            submenuMaxHeight: SUBMENU_MAX_HEIGHT,
          };
        })),
  ];

  return (
    <>
      {renderTrigger ? (
        renderTrigger({
          ref: setButton,
          ariaLabel: label,
          disabled,
          "aria-haspopup": "menu",
          "aria-expanded": open,
          onSelect: () => {
            if (!disabled) setOpen((value) => !value);
          },
        })
      ) : (
        <Button
          className={triggerClassName}
          iconOnly
          label={label}
          variant={triggerVariant}
          ref={setButton}
          type="button"
          tooltip={label}
          aria-label={label}
          aria-haspopup="menu"
          aria-expanded={open}
          disabled={disabled}
          onClick={() => {
            if (disabled) return;
            setOpen((value) => !value);
          }}
        >
          <Icon className="size-3.5" strokeWidth={1.75} />
        </Button>
      )}
      {open && button ? (
        <DropdownMenu
          anchor={button}
          label={menuLabel}
          items={menuItems()}
          side="top"
          align="center"
          width={MENU_WIDTH}
          onPick={pickEncoded}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </>
  );
}
