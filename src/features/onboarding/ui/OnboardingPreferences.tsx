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
            <input
              type="checkbox"
              checked={features[id]}
              onChange={(event) => workspaceFeatureSettings[id].save(event.target.checked)}
            />
          </label>
        ))}
      </div>
      <label className="onboarding-check-row">
        <input
          type="checkbox"
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
    applyThemePreference(next);
    setTheme(next);
  };
  return (
    <>
      <div className="onboarding-heading">
        <h3>{t("Make yourself at home")}</h3>
        <p>{t("Choose your appearance and the crew that keeps you company.")}</p>
      </div>
      <fieldset className="onboarding-fieldset">
        <legend>{t("Appearance")}</legend>
        <div className="onboarding-theme-options">
          {(
            [
              { id: "light", label: "Light" },
              { id: "dark", label: "Dark" },
              { id: "system", label: "System" },
            ] as const
          ).map(({ id, label }) => (
            <label key={id} className="onboarding-theme-option">
              <input
                type="radio"
                name="onboarding-appearance"
                value={id}
                checked={theme === id}
                onChange={() => changeTheme(id)}
              />
              <span aria-hidden="true" className="onboarding-mode-preview" data-mode={id}>
                <i />
                <i />
                <i />
              </span>
              <span>{t(label)}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <fieldset className="onboarding-fieldset">
        <legend>{t("Agent crew")}</legend>
        <div className="onboarding-crew-options">
          {(
            [
              {
                id: "classic",
                label: "Uncles",
                description: "The original tea crew, drawn in monochrome code art.",
              },
              {
                id: "star-wars",
                label: "Star Wars",
                description:
                  "Obi-Wan leads, Yoda advises; Darth Vader, Luke, Leia and Chewbacca join as subagents. R2-D2 joins when the crew grows beyond six.",
              },
            ] as const
          ).map(({ id, label, description }) => (
            <label key={id} className="onboarding-crew-option">
              <Suspense fallback={<div className="onboarding-crew-preview" />}>
                <OnboardingCrewPreview theme={id} />
              </Suspense>
              <div className="onboarding-crew-label">
                <div>
                  <strong>{t(label)}</strong>
                  <small title={t(description)}>
                    {id === "classic" ? t("Code art") : t("Galaxy crew")}
                  </small>
                </div>
                <input
                  type="radio"
                  name="onboarding-crew"
                  value={id}
                  checked={crewEnabled && crewTheme === id}
                  onChange={() => {
                    saveCrewTheme(id);
                    saveCrewSceneEnabled(true);
                  }}
                />
              </div>
            </label>
          ))}
        </div>
      </fieldset>
      <div className="onboarding-appearance-toggles">
        <label className="onboarding-check-row">
          <input
            type="radio"
            name="onboarding-crew"
            value="none"
            checked={!crewEnabled}
            onChange={() => saveCrewSceneEnabled(false)}
          />
          <span>{t("No crew · keep the workspace quiet")}</span>
        </label>
        <label className="onboarding-check-row">
          <input
            type="checkbox"
            checked={motion}
            onChange={(event) => saveDecorativeMotionEnabled(event.target.checked)}
          />
          <span>{t("Decorative animations")}</span>
        </label>
      </div>
    </>
  );
}
