import { surfaceAttributes } from "../../../shared/ui/Surface";
import { Text } from "../../../shared/ui/Text";
import { Checkbox } from "../../../shared/ui/Checkbox";
import { OnboardingHeading } from "./OnboardingHeading";
import { SectionLabel } from "../../../shared/ui/SectionLabel";
import { InfoTooltip } from "../../../shared/ui/InfoPopover";
import { Switch } from "../../../shared/ui/Switch";
import { lazy, Suspense, useState, useSyncExternalStore, type ReactNode } from "react";
import { t, useLocale } from "../../../shared/i18n";
import { CircleDashed } from "../../../shared/ui/icons";
import { ModePreview, type Tint } from "../../settings/ui/AppearancePreviews";
import { RadioTiles } from "../../settings/ui/RadioTiles";
import { CANVAS_BACKGROUND_DEFAULT } from "../../settings/model/appearancePreferences";
import {
  ACCENT_COLOR_DEFAULT,
  THEME_DARK_LIGHTNESS_DEFAULT,
  THEME_HUE_DEFAULT,
  THEME_SATURATION_DEFAULT,
  applyThemePreference,
  loadThemePreference,
  saveThemePreference,
  type ThemePreference,
} from "../../settings/model/appearance";
import {
  useDecorativeMotionPreference,
  saveDecorativeMotionEnabled,
} from "../../settings/model/decorativeMotion";
import {
  loadCrewSceneEnabled,
  loadCrewTheme,
  saveCrewSceneEnabled,
  saveCrewTheme,
  subscribeCrewSceneEnabled,
  subscribeCrewTheme,
  loadKeepAwakeEnabled,
  subscribeKeepAwakeEnabled,
  type CrewTheme,
} from "../../settings/model/settings";
import { saveAgentDefaultConfirmed } from "../../settings/public/agentDefaultsSync";
import { SettingsFeedback } from "../../../shared/ui/settings";
import {
  useWorkspaceFeatures,
  workspaceFeatureSettings,
} from "../../settings/model/workspaceFeatures";
import { workspaceFeatureChoices } from "../../settings/ui/WorkspaceFeatureSettings";
/** The default palette, shown in the mode tiles before the user changes it in Settings. */
const { className: CHOICE_FRAME_CLASS, ...CHOICE_FRAME_DATA } = surfaceAttributes({
  frame: "card",
  radius: "card",
});
const DEFAULT_TINT: Tint = {
  hue: THEME_HUE_DEFAULT,
  saturation: THEME_SATURATION_DEFAULT,
  lightness: THEME_DARK_LIGHTNESS_DEFAULT,
  accent: ACCENT_COLOR_DEFAULT,
};
const OnboardingCrewPreview = lazy(() =>
  import("./OnboardingCrewPreview").then((module) => ({ default: module.OnboardingCrewPreview })),
);

/** One labelled setting with its control on the right edge. The whole row toggles the switch. */
function SwitchRow({
  label,
  checked,
  onChange,
  disabled,
}: {
  label: string;
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <Switch
      appearance="card"
      className="onboarding-row"
      label={label}
      labelPosition="start"
      checked={checked}
      onCheckedChange={onChange}
      disabled={disabled}
    />
  );
}

/** `info` sits beside the title; passing it (even as a placeholder) reserves its slot so the content below never moves. */
function Section({
  title,
  info,
  children,
}: {
  title: string;
  info?: ReactNode;
  children: ReactNode;
}) {
  const label = (
    <SectionLabel as="div" className="onboarding-section-title">
      {title}
    </SectionLabel>
  );
  return (
    <section className="onboarding-section">
      {info === undefined ? (
        label
      ) : (
        <div className="onboarding-section-heading">
          {label}
          {info}
        </div>
      )}
      {children}
    </section>
  );
}

export function OnboardingWorkspace() {
  useLocale();
  const [powerPending, setPowerPending] = useState(false);
  const [powerFailed, setPowerFailed] = useState<boolean | null>(null);
  const savePower = async (next: boolean) => {
    setPowerPending(true);
    try {
      setPowerFailed(
        (await saveAgentDefaultConfirmed("keepAwakeWhileAgentsWork", next)) ? null : next,
      );
    } catch {
      setPowerFailed(next);
    } finally {
      setPowerPending(false);
    }
  };
  const features = useWorkspaceFeatures();
  const keepAwake = useSyncExternalStore(
    subscribeKeepAwakeEnabled,
    loadKeepAwakeEnabled,
    () => false,
  );
  return (
    <>
      <OnboardingHeading
        title={t("Workspace")}
        info={t("Choose the tools you want close by. You can change these in Settings anytime.")}
      />
      <div className="onboarding-scroll">
        <div className="onboarding-feature-grid">
          {workspaceFeatureChoices().map(({ id, label, description, icon: Icon }) => (
            <Checkbox
              key={id}
              appearance="card"
              className="onboarding-feature"
              checked={features[id]}
              onChange={(event) => workspaceFeatureSettings[id].save(event.target.checked)}
              label={
                <>
                  <Icon aria-hidden tone="muted" className="icon-lg" />
                  <div>
                    <Text
                      as="strong"
                      size="inherit"
                      tone="inherit"
                      weight="medium"
                      leading="inherit"
                    >
                      {label}
                    </Text>
                    <Text as="small" size="micro" tone="muted" leading="snug">
                      {description}
                    </Text>
                  </div>
                </>
              }
            />
          ))}
          <SwitchRow
            label={t("Prevent sleep while agents work")}
            checked={keepAwake}
            onChange={(next) => {
              void savePower(next).catch(console.error);
            }}
            disabled={powerPending}
          />
        </div>
        {powerFailed !== null ? (
          <SettingsFeedback
            state="error"
            action={{
              label: t("Retry"),
              onClick: () => {
                void savePower(powerFailed).catch(console.error);
              },
            }}
          >
            {t("Could not save changes")}
          </SettingsFeedback>
        ) : null}
      </div>
    </>
  );
}

export function OnboardingAppearance() {
  useLocale();
  const [theme, setTheme] = useState(loadThemePreference);
  const crewTheme = useSyncExternalStore(subscribeCrewTheme, loadCrewTheme, loadCrewTheme);
  const crewEnabled = useSyncExternalStore(
    subscribeCrewSceneEnabled,
    loadCrewSceneEnabled,
    loadCrewSceneEnabled,
  );
  const motion = useDecorativeMotionPreference();
  const changeTheme = (next: ThemePreference) => {
    saveThemePreference(next);
    applyThemePreference(next, { animate: true });
    setTheme(next);
  };
  const crew = crewEnabled ? crewTheme : "none";
  const modes: { value: ThemePreference; label: string }[] = [
    { value: "light", label: t("Light") },
    { value: "dark", label: t("Dark") },
    { value: "system", label: t("System") },
  ];
  const crewChoices: {
    value: CrewTheme | "none";
    title: string;
    detail?: string;
  }[] = [
    {
      value: "classic",
      title: t("Uncles"),
      detail: t("The original tea crew, drawn in monochrome code art."),
    },
    {
      value: "star-wars",
      title: t("Star Wars"),
      detail: t(
        "Obi-Wan leads, Yoda advises; Darth Vader, Luke, Leia and Chewbacca join as subagents. R2-D2 joins when the crew grows beyond six.",
      ),
    },
    {
      value: "lotr",
      title: t("The Lord of the Rings"),
      detail: t(
        "Gandalf leads, Sauron advises; a Nazgûl, an Elf, a Dwarf and a Hobbit join as subagents. Orcs arrive when more than six subagents work.",
      ),
    },
    {
      value: "matrix",
      title: t("The Matrix"),
      detail: t("Neo leads, Morpheus advises, and every subagent is another Agent Smith."),
    },
    { value: "none", title: t("No crew") },
  ];
  const crewDetail = crewChoices.find((choice) => choice.value === crew)?.detail;
  return (
    <>
      <OnboardingHeading title={t("Appearance")} />
      <div className="onboarding-scroll">
        <Section title={t("Mode")}>
          <RadioTiles
            label={t("Mode")}
            className="onboarding-mode-grid"
            tileClassName={`${CHOICE_FRAME_CLASS} onboarding-choice onboarding-mode`}
            tile={{ selectionIndicator: "accent-inset" }}
            value={theme}
            onChange={changeTheme}
            options={modes.map(({ value, label }) => ({
              value,
              id: `onboarding-appearance-${value}`,
              data: CHOICE_FRAME_DATA,
              children: (
                <>
                  <ModePreview
                    mode={value}
                    tint={DEFAULT_TINT}
                    pure={CANVAS_BACKGROUND_DEFAULT === "pure"}
                  />
                  <span className="onboarding-choice-text">
                    <Text
                      as="strong"
                      size="secondary"
                      tone="inherit"
                      weight="medium"
                      leading="inherit"
                    >
                      {label}
                    </Text>
                  </span>
                </>
              ),
            }))}
          />
        </Section>
        <Section
          title={t("Agent crew")}
          info={
            crewDetail ? (
              <InfoTooltip className="onboarding-section-info" label={t("Agent crew")}>
                {crewDetail}
              </InfoTooltip>
            ) : (
              <span className="onboarding-section-info" aria-hidden="true" />
            )
          }
        >
          <RadioTiles
            label={t("Agent crew")}
            className="onboarding-crew-grid"
            tileClassName={`${CHOICE_FRAME_CLASS} onboarding-choice onboarding-crew-card`}
            tile={{ selectionIndicator: "accent-inset" }}
            value={crew}
            onChange={(value) => {
              if (value === "none") saveCrewSceneEnabled(false);
              else {
                saveCrewTheme(value);
                saveCrewSceneEnabled(true);
              }
            }}
            options={crewChoices.map(({ value, title }) => ({
              value,
              id: `onboarding-crew-${value}`,
              data: CHOICE_FRAME_DATA,
              children: (
                <>
                  {value === "none" ? (
                    <span
                      {...surfaceAttributes(
                        { variant: "page", frame: "card", borderStyle: "dashed" },
                        "onboarding-crew-preview onboarding-crew-none",
                      )}
                      aria-hidden="true"
                    >
                      <CircleDashed tone="muted" className="icon-lg" />
                    </span>
                  ) : (
                    <Suspense fallback={<span className="onboarding-crew-preview" />}>
                      <OnboardingCrewPreview theme={value} />
                    </Suspense>
                  )}
                  <span className="onboarding-choice-text">
                    <Text
                      as="strong"
                      size="secondary"
                      tone="inherit"
                      weight="medium"
                      leading="inherit"
                    >
                      {title}
                    </Text>
                  </span>
                </>
              ),
            }))}
          />
        </Section>
        <SwitchRow
          label={t("Decorative animations")}
          checked={motion}
          onChange={saveDecorativeMotionEnabled}
        />
      </div>
    </>
  );
}
