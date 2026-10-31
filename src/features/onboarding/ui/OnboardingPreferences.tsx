import { Checkbox } from "../../../shared/ui/Checkbox";
import { Switch } from "../../../shared/ui/Switch";
import { lazy, Suspense, useState, useSyncExternalStore, type ReactNode } from "react";
import { t, useLocale } from "../../../shared/i18n";
import { Check, CircleDashed, CodeBlock } from "../../../shared/ui/icons";
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
    <label className="onboarding-row">
      <span>{label}</span>
      <Switch aria-label={label} checked={checked} onCheckedChange={onChange} />
    </label>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="onboarding-section">
      <div className="onboarding-section-title">{title}</div>
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
        <h3>{t("A workspace that fits you")}</h3>
        <p>{t("Choose the tools you want close by. You can change these in Settings anytime.")}</p>
      </div>
      <div className="onboarding-scroll">
        <div className="onboarding-feature-grid">
          <div className="onboarding-feature" data-fixed="">
            <CodeBlock aria-hidden className="size-5" />
            <div>
              <strong>{t("Coding essentials")}</strong>
              <small>{t("AI chat, files, terminal and Git")}</small>
            </div>
            <span className="onboarding-included">
              <Check aria-hidden className="size-3.5" />
              {t("Included")}
            </span>
          </div>
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
  const crewChoices: { value: CrewTheme | "none"; title: string; caption: string; detail?: string }[] = [
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
    { value: "none", title: t("No crew"), caption: t("Keep the workspace quiet") },
  ];
  return (
    <>
      <div className="onboarding-heading">
        <h3>{t("Make yourself at home")}</h3>
        <p>{t("Choose your appearance and the crew that keeps you company.")}</p>
      </div>
      <div className="onboarding-scroll">
        <Section title={t("Appearance")}>
          <div className="onboarding-mode-grid" role="radiogroup" aria-label={t("Appearance")}>
            {modes.map(({ value, label }) => (
              <label className="onboarding-choice onboarding-mode" key={value}>
                <input
                  type="radio"
                  name="onboarding-appearance"
                  id={`onboarding-appearance-${value}`}
                  value={value}
                  checked={theme === value}
                  onChange={() => changeTheme(value)}
                />
                <span className="onboarding-mode-preview" aria-hidden="true">
                  {(value === "system" ? ["light", "dark"] : [value, value]).map((tone, index) => (
                    <i key={index} data-tone={tone} />
                  ))}
                </span>
                <span className="onboarding-choice-text">
                  <strong>{label}</strong>
                </span>
              </label>
            ))}
          </div>
        </Section>
        <Section title={t("Agent crew")}>
          <div className="onboarding-crew-grid" role="radiogroup" aria-label={t("Agent crew")}>
            {crewChoices.map(({ value, title, caption, detail }) => (
              <label
                className="onboarding-choice onboarding-crew-card"
                key={value}
                title={detail}
              >
                <input
                  type="radio"
                  name="onboarding-crew"
                  value={value}
                  checked={crew === value}
                  onChange={() => {
                    if (value === "none") saveCrewSceneEnabled(false);
                    else {
                      saveCrewTheme(value);
                      saveCrewSceneEnabled(true);
                    }
                  }}
                />
                {value === "none" ? (
                  <span className="onboarding-crew-preview onboarding-crew-none" aria-hidden="true">
                    <CircleDashed className="size-5" />
                  </span>
                ) : (
                  <Suspense fallback={<span className="onboarding-crew-preview" />}>
                    <OnboardingCrewPreview theme={value} />
                  </Suspense>
                )}
                <span className="onboarding-choice-text">
                  <strong>{title}</strong>
                  <small>{caption}</small>
                </span>
              </label>
            ))}
          </div>
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
