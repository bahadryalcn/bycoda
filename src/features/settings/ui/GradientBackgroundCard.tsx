import { useEffect, useRef, useState, useSyncExternalStore, type CSSProperties } from "react";
import { t, useLocale } from "../../../shared/i18n";
import { Button } from "../../../shared/ui/Button";
import { ColorPickerPopover } from "../../../shared/ui/ColorPickerPopover";
import { Popover } from "../../../shared/ui/Popover";
import { workspaceBackgroundImage } from "../../../shared/theme/workspaceBackground";
import {
  initWorkspaceBackground,
  loadWorkspaceBackground,
  readWorkspaceBackgroundIssue,
  saveWorkspaceBackground,
  subscribeWorkspaceBackground,
  WORKSPACE_BACKGROUND_DEFAULT,
  WORKSPACE_BACKGROUND_PRESETS,
  type WorkspaceBackground,
} from "../model/workspaceBackground";
import {
  AdvancedSettings,
  Group,
  Row,
  Segmented,
  SettingsFeedback,
  Slider,
  Toggle,
} from "./settingsControls";
import { AppearanceSaveFeedback } from "./useAppearanceSettings";
import {
  readAppearanceSaveIssues,
  retryAppearanceSave,
  subscribeAppearanceSaveIssues,
} from "../model/appearancePersistence";
import { RadioTiles } from "./RadioTiles";
import styles from "./GradientBackgroundCard.module.css";

function sameDesign(a: WorkspaceBackground, b: WorkspaceBackground) {
  return (
    a.style === b.style &&
    a.angle === b.angle &&
    a.strength === b.strength &&
    a.colors.every((color, index) => color.toLowerCase() === b.colors[index].toLowerCase())
  );
}

function previewStyle(value: WorkspaceBackground): CSSProperties {
  return {
    "--workspace-background-image": workspaceBackgroundImage(value),
    "--workspace-background-strength": value.strength / 100,
  } as CSSProperties;
}

function useBackgroundSuppressed() {
  const [suppressed, setSuppressed] = useState(false);
  useEffect(() => {
    if (!window.matchMedia) return;
    const queries = ["(forced-colors: active)", "(prefers-reduced-transparency: reduce)"].map(
      (query) => window.matchMedia(query),
    );
    const update = () => setSuppressed(queries.some((query) => query.matches));
    update();
    for (const query of queries) query.addEventListener?.("change", update);
    return () => {
      for (const query of queries) query.removeEventListener?.("change", update);
    };
  }, []);
  return suppressed;
}

function GradientColor({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const anchor = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  return (
    <div ref={anchor}>
      <Button variant="secondary" size="sm" onClick={() => setOpen(!open)} aria-expanded={open}>
        <span className={styles.color} style={{ backgroundColor: value }} aria-hidden="true" />
        {label}
      </Button>
      {open ? (
        <Popover
          anchor={anchor}
          side="bottom"
          align="end"
          width={248}
          flow="scroll"
          onDismiss={() => setOpen(false)}
          className="px-2 pb-2"
        >
          <ColorPickerPopover value={value} onChange={onChange} />
        </Popover>
      ) : null}
    </div>
  );
}

export function GradientBackgroundCard() {
  useLocale();
  const value = useSyncExternalStore(subscribeWorkspaceBackground, loadWorkspaceBackground);
  const issue = useSyncExternalStore(subscribeWorkspaceBackground, readWorkspaceBackgroundIssue);
  const saveIssues = useSyncExternalStore(subscribeAppearanceSaveIssues, readAppearanceSaveIssues);
  const suppressed = useBackgroundSuppressed();
  useEffect(() => {
    initWorkspaceBackground();
  }, []);
  const update = (change: Partial<WorkspaceBackground>) =>
    saveWorkspaceBackground({ ...value, ...change }, { base: value });
  const preset = WORKSPACE_BACKGROUND_PRESETS.find((option) => sameDesign(value, option.value));
  const labels: Record<string, string> = {
    aurora: t("Aurora"),
    ocean: t("Ocean"),
    dusk: t("Dusk"),
    forest: t("Forest"),
    ember: t("Ember"),
    rose: t("Rose"),
  };
  const options = WORKSPACE_BACKGROUND_PRESETS.map((option) => ({
    value: option.id,
    children: (
      <>
        <span
          className={`${styles.swatch} workspace-background-preview`}
          style={previewStyle(option.value)}
          aria-hidden="true"
        />
        <span>{labels[option.id] ?? option.label}</span>
      </>
    ),
  }));
  if (!preset)
    options.push({
      value: "custom",
      children: (
        <>
          <span
            className={`${styles.swatch} workspace-background-preview`}
            style={previewStyle(value)}
            aria-hidden="true"
          />
          <span>{t("Custom")}</span>
        </>
      ),
    });
  return (
    <Group
      id="workspace-background"
      title={t("Workspace background")}
      description={t("Add a color background behind your workspace and chat images.")}
      modified={JSON.stringify(value) !== JSON.stringify(WORKSPACE_BACKGROUND_DEFAULT)}
      resetLabel={t("Reset workspace background")}
      onReset={() => saveWorkspaceBackground(WORKSPACE_BACKGROUND_DEFAULT, { replace: true })}
    >
      <Row label={t("Show workspace background")}>
        <Toggle
          label={t("Show workspace background")}
          on={value.enabled}
          onChange={(enabled) => update({ enabled })}
        />
      </Row>
      {value.enabled && suppressed ? (
        <SettingsFeedback state="empty">
          {t("Your accessibility settings hide workspace backgrounds. Your design is still saved.")}
        </SettingsFeedback>
      ) : null}
      <Row label={t("Background preset")} stacked>
        <RadioTiles
          label={t("Background preset")}
          value={preset?.id ?? "custom"}
          options={options}
          className={styles.presets}
          tileClassName={styles.preset}
          onChange={(id) => {
            const next = WORKSPACE_BACKGROUND_PRESETS.find((option) => option.id === id);
            if (next) saveWorkspaceBackground({ ...next.value, enabled: true }, { replace: true });
          }}
        />
      </Row>
      <AdvancedSettings
        title={t("Customize background")}
        defaultOpen={false}
        settingIds={[
          "workspace-gradient-style",
          "workspace-gradient-colors",
          "workspace-gradient-angle",
          "workspace-gradient-strength",
        ]}
      >
        <Row id="workspace-gradient-style" label={t("Gradient style")}>
          <Segmented
            label={t("Gradient style")}
            value={value.style}
            options={[
              { value: "linear", label: t("Linear gradient") },
              { value: "radial", label: t("Radial") },
              { value: "mesh", label: t("Soft blend") },
            ]}
            onChange={(style) => update({ style })}
          />
        </Row>
        <Row id="workspace-gradient-colors" label={t("Gradient colors")}>
          <div className={styles.colors}>
            {value.colors.map((color, index) => (
              <GradientColor
                key={index}
                label={t("Color {p0}", { p0: index + 1 })}
                value={color}
                onChange={(next) => {
                  const colors: [string, string, string] = [...value.colors];
                  colors[index] = next;
                  update({ colors });
                }}
              />
            ))}
          </div>
        </Row>
        <Row
          id="workspace-gradient-angle"
          label={t("Gradient angle")}
          disabled={value.style === "radial"}
          disabledReason={t("Angle applies to linear and soft blend backgrounds.")}
        >
          <Slider
            label={t("Gradient angle")}
            value={value.angle}
            display={`${value.angle}°`}
            min={0}
            max={360}
            onChange={(angle) => update({ angle })}
            disabled={value.style === "radial"}
          />
        </Row>
        <Row id="workspace-gradient-strength" label={t("Background strength")}>
          <Slider
            label={t("Background strength")}
            value={value.strength}
            display={`${value.strength}%`}
            min={0}
            max={100}
            onChange={(strength) => update({ strength })}
          />
        </Row>
      </AdvancedSettings>
      {issue === "conflict" ? (
        <SettingsFeedback
          state="error"
          action={
            <Button onClick={() => saveWorkspaceBackground(value, { replace: true })}>
              {t("Apply my background")}
            </Button>
          }
        >
          {t("This background changed in another window. Your unsaved changes are still here.")}
        </SettingsFeedback>
      ) : issue === "unavailable" ? (
        <SettingsFeedback
          state="error"
          action={
            saveIssues.some((entry) => entry.settingId === "workspace-background") ? (
              <Button
                onClick={() =>
                  saveIssues
                    .filter((entry) => entry.settingId === "workspace-background")
                    .forEach((entry) => retryAppearanceSave(entry.key))
                }
              >
                {t("Retry save")}
              </Button>
            ) : undefined
          }
        >
          {t(
            "The saved workspace background could not be read. Your current changes are still here.",
          )}
        </SettingsFeedback>
      ) : (
        <AppearanceSaveFeedback settingIds={["workspace-background"]} />
      )}
    </Group>
  );
}
