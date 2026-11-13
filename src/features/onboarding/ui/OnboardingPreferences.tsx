import { surfaceAttributes } from "../../../shared/ui/Surface";
import { Text } from "../../../shared/ui/Text";
import { Checkbox } from "../../../shared/ui/Checkbox";
import { Heading } from "../../../shared/ui/Heading";
import { SectionLabel } from "../../../shared/ui/SectionLabel";
import { Switch } from "../../../shared/ui/Switch";
import { lazy, Suspense, useState, useSyncExternalStore, type ReactNode } from "react";
import { t, useLocale } from "../../../shared/i18n";
import { Check, CircleDashed, CodeBlock } from "../../../shared/ui/icons";
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
  saveKeepAwakeEnabled,
  subscribeKeepAwakeEnabled,
  type CrewTheme,
} from "../../settings/model/settings";
import {
  useWorkspaceFeatures,
  workspaceFeatureSettings,
} from "../../settings/model/workspaceFeatures";
import { WORKSPACE_FEATURE_CHOICES } from "../../settings/ui/WorkspaceFeatureSettings";
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
}: {
  label: string;
  checked: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <Switch
      appearance="card"
      className="onboarding-row"
      label={label}
      labelPosition="start"
      checked={checked}
      onCheckedChange={onChange}
    />
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="onboarding-section">
      <SectionLabel as="div" className="onboarding-section-title">
        {title}
      </SectionLabel>
      {children}
    </section>
  );
}

export function OnboardingWorkspace() {
  useLocale();
  const features = useWorkspaceFeatures();
  const keepAwake = useSyncExternalStore(
    subscribeKeepAwakeEnabled,
    loadKeepAwakeEnabled,
    () => false,
  );
  return (
    <>
      <div className="onboarding-heading">
        <Heading size="page" level={3}>
          {t("A workspace that fits you")}
        </Heading>
        <Text as="p" size="inherit" tone="muted" leading="normal">
          {t("Choose the tools you want close by. You can change these in Settings anytime.")}
        </Text>
      </div>
      <div className="onboarding-scroll">
        <div className="onboarding-feature-grid">
          <div
            {...surfaceAttributes({ frame: "card", radius: "card" }, "onboarding-feature")}
            data-fixed=""
          >
            <CodeBlock aria-hidden tone="muted" className="icon-lg" />
            <div>
              <Text as="strong" size="inherit" tone="inherit" weight="medium" leading="inherit">
                {t("Coding essentials")}
              </Text>
              <Text as="small" size="micro" tone="muted" leading="snug">
                {t("AI chat, files, terminal and Git")}
              </Text>
            </div>
            <Text size="micro" tone="muted" leading="inherit" className="onboarding-included">
              <Check aria-hidden className="icon-sm" />
              {t("Included")}
            </Text>
          </div>
          {WORKSPACE_FEATURE_CHOICES.map(({ id, label, description, icon: Icon }) => (
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
                      {t(label)}
                    </Text>
                    <Text as="small" size="micro" tone="muted" leading="snug">
                      {t(description)}
                    </Text>
                  </div>
                </>
              }
            />
          ))}
        </div>
        <Section title={t("Behavior")}>
          <SwitchRow
            label={t("Prevent sleep while agents work")}
            checked={keepAwake}
            onChange={saveKeepAwakeEnabled}
          />
        </Section>
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
    caption: string;
    detail?: string;
  }[] = [
    {
      value: "classic",
      title: t("Uncles"),
      caption: t("Code art"),
      detail: t("The original tea crew, drawn in monochrome code art."),
    },
    {
      value: "star-wars",
      title: t("Star Wars"),
      caption: t("Galaxy crew"),
      detail: t(
        "Obi-Wan leads, Yoda advises; Darth Vader, Luke, Leia and Chewbacca join as subagents. R2-D2 joins when the crew grows beyond six.",
      ),
    },
    {
      value: "lotr",
      title: t("The Lord of the Rings"),
      caption: t("Fellowship crew"),
      detail: t(
        "Gandalf leads, Sauron advises; a Nazgûl, an Elf, a Dwarf and a Hobbit join as subagents. Orcs arrive when more than six subagents work.",
      ),
    },
    {
      value: "matrix",
      title: t("The Matrix"),
      caption: t("Zion crew"),
      detail: t("Neo leads, Morpheus advises, and every subagent is another Agent Smith."),
    },
    { value: "none", title: t("No crew"), caption: t("Keep the workspace quiet") },
  ];
  return (
    <>
      <div className="onboarding-heading">
        <Heading size="page" level={3}>
          {t("Make yourself at home")}
        </Heading>
        <Text as="p" size="inherit" tone="muted" leading="normal">
          {t("Choose your appearance and the crew that keeps you company.")}
        </Text>
      </div>
      <div className="onboarding-scroll">
        <Section title={t("Appearance")}>
          <RadioTiles
            label={t("Appearance")}
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
        <Section title={t("Agent crew")}>
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
            options={crewChoices.map(({ value, title, caption, detail }) => ({
              value,
              id: `onboarding-crew-${value}`,
              data: CHOICE_FRAME_DATA,
              tooltip: detail,
              children: (
                <>
                  {value === "none" ? (
                    <span
                      {...surfaceAttributes(
                        { variant: "transparent", frame: "card", borderStyle: "dashed" },
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
                    <Text as="small" size="micro" tone="muted" leading="normal">
                      {caption}
                    </Text>
                  </span>
                </>
              ),
            }))}
          />
        </Section>
        <Section title={t("Behavior")}>
          <SwitchRow
            label={t("Decorative animations")}
            checked={motion}
            onChange={saveDecorativeMotionEnabled}
          />
        </Section>
      </div>
    </>
  );
}
