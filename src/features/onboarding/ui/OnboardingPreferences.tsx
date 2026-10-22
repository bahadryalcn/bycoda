import { RadioGroup } from "../../../shared/ui/RadioGroup";
import { SegmentedControl } from "../../../shared/ui/SegmentedControl";
import { Checkbox } from "../../../shared/ui/Checkbox";
import { lazy, Suspense, useState, useSyncExternalStore } from "react";
import { t, useLocale } from "../../../shared/i18n";
import { Check, CodeBlock } from "../../../shared/ui/icons";
import {
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
const OnboardingCrewPreview = lazy(() =>
  import("./OnboardingCrewPreview").then((module) => ({ default: module.OnboardingCrewPreview })),
);

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
        <h3>{t("A workspace that fits you")}</h3>
        <p>{t("Choose the tools you want close by. You can change these in Settings anytime.")}</p>
      </div>
      <div className="onboarding-included">
        <CodeBlock aria-hidden className="size-5" />
        <div>
          <strong>{t("Coding essentials")}</strong>
          <small>{t("AI chat, files, terminal and Git")}</small>
        </div>
        <span>
          <Check aria-hidden className="size-3.5" />
          {t("Included")}
        </span>
      </div>
      <div className="onboarding-feature-grid">
        {WORKSPACE_FEATURE_CHOICES.map(({ id, label, description, icon: Icon }) => (
          <label className="onboarding-feature" key={id}>
            <Icon aria-hidden className="size-5" />
            <div>
              <strong>{t(label)}</strong>
              <small>{t(description)}</small>
            </div>
            <Checkbox
              checked={features[id]}
              onChange={(event) => workspaceFeatureSettings[id].save(event.target.checked)}
            />
          </label>
        ))}
      </div>
      <label className="onboarding-check-row">
        <Checkbox
          checked={keepAwake}
          onChange={(event) => saveKeepAwakeEnabled(event.target.checked)}
        />
        <span>{t("Prevent sleep while agents work")}</span>
      </label>
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
  return (
    <>
      <div className="onboarding-heading">
        <h3>{t("Make yourself at home")}</h3>
        <p>{t("Choose your appearance and the crew that keeps you company.")}</p>
      </div>
      <SegmentedControl
        label={t("Appearance")}
        optionIdPrefix="onboarding-appearance"
        className="mbs-3 mbe-3"
        value={theme}
        options={[
          { value: "light", label: t("Light") },
          { value: "dark", label: t("Dark") },
          { value: "system", label: t("System") },
        ]}
        onValueChange={(value) => changeTheme(value as ThemePreference)}
      />
      <div className="grid grid-cols-3 gap-2">
        <Suspense fallback={<span className="onboarding-crew-preview" />}>
          <OnboardingCrewPreview theme="classic" />
        </Suspense>
        <Suspense fallback={<span className="onboarding-crew-preview" />}>
          <OnboardingCrewPreview theme="star-wars" />
        </Suspense>
        <Suspense fallback={<span className="onboarding-crew-preview" />}>
          <OnboardingCrewPreview theme="lotr" />
        </Suspense>
      </div>
      <RadioGroup
        compact
        label={t("Agent crew")}
        name="onboarding-crew"
        value={crewEnabled ? crewTheme : "none"}
        onValueChange={(value) => {
          if (value === "none") saveCrewSceneEnabled(false);
          else {
            saveCrewTheme(value as CrewTheme);
            saveCrewSceneEnabled(true);
          }
        }}
        options={[
          {
            value: "classic",
            label: (
              <span title={t("The original tea crew, drawn in monochrome code art.")}>
                {t("Uncles")} · {t("Code art")}
              </span>
            ),
          },
          {
            value: "star-wars",
            label: (
              <span
                title={t(
                  "Obi-Wan leads, Yoda advises; Darth Vader, Luke, Leia and Chewbacca join as subagents. R2-D2 joins when the crew grows beyond six.",
                )}
              >
                {t("Star Wars")} · {t("Galaxy crew")}
              </span>
            ),
          },
          {
            value: "lotr",
            label: (
              <span
                title={t(
                  "Gandalf leads, Sauron advises; a Nazgûl, an Orc, a Dwarf and a Hobbit join as subagents.",
                )}
              >
                {t("The Lord of the Rings")} · {t("Fellowship crew")}
              </span>
            ),
          },
          { value: "none", label: t("No crew · keep the workspace quiet") },
        ]}
      />
      <div className="onboarding-appearance-toggles">
        <label className="onboarding-check-row">
          <Checkbox
            checked={motion}
            onChange={(event) => saveDecorativeMotionEnabled(event.target.checked)}
          />
          <span>{t("Decorative animations")}</span>
        </label>
      </div>
    </>
  );
}
