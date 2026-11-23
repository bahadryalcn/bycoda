/** Different job: Crew-stage preview renders a scene; its controls retain shared presentation. */
import { useSyncExternalStore } from "react";
import { CrewScene } from "../../../../sessions/public/CrewScene";
import { useStoredPreferenceState } from "../../../../../shared/hooks/useStoredPreferenceState";
import { t, useLocale } from "../../../../../shared/i18n";
import { SegmentedControl } from "../../../../../shared/ui/SegmentedControl";
import {
  CREW_GROWTH_ENABLED_DEFAULT,
  CREW_SCENE_ENABLED_DEFAULT,
  TAB_ANIMATIONS_ENABLED_DEFAULT,
  loadCrewGrowthEnabled,
  loadCrewSceneEnabled,
  loadCrewTheme,
  loadTabAnimationsEnabled,
  saveCrewGrowthEnabled,
  saveCrewSceneEnabled,
  saveCrewTheme,
  saveTabAnimationsEnabled,
  subscribeCrewGrowthEnabled,
  subscribeCrewSceneEnabled,
  subscribeCrewTheme,
  subscribeTabAnimationsEnabled,
  type CrewTheme,
} from "../../../model/settings";
import {
  DECORATIVE_MOTION_DEFAULT,
  FOLLOW_SYSTEM_MOTION_DEFAULT,
  saveDecorativeMotionEnabled,
  saveFollowSystemMotionEnabled,
  useDecorativeMotionPreference,
  useFollowSystemMotionEnabled,
  usePrefersReducedMotion,
} from "../../../model/decorativeMotion";
import { AdvancedSettings, Group, Row, Toggle } from "../../../../../shared/ui/settings";
import { resetCrew, resetMotion } from "../appearanceResets";
import "./CrewStageCard.css";

/** Who plays whom in the selected theme; shown as the caption under the stage. */
function crewThemeHint(theme: CrewTheme): string {
  switch (theme) {
    case "star-wars":
      return t(
        "Obi-Wan leads, Yoda advises; Darth Vader, Luke, Leia and Chewbacca join as subagents. R2-D2 joins when the crew grows beyond six.",
      );
    case "lotr":
      return t(
        "Gandalf leads, Sauron advises; a Nazgûl, an Elf, a Dwarf and a Hobbit join as subagents. Orcs arrive when more than six subagents work.",
      );
    case "matrix":
      return t("Neo leads, Morpheus advises, and every subagent is another Agent Smith.");
    default:
      return t("The original tea crew, drawn in binary code art.");
  }
}

/** Real ambient scene with its preference controls and independent reset scopes. */
export function CrewStageCard() {
  useLocale();
  const theme = useSyncExternalStore(subscribeCrewTheme, loadCrewTheme, loadCrewTheme);
  const decorative = useDecorativeMotionPreference();
  const followSystem = useFollowSystemMotionEnabled();
  const reducedMotion = usePrefersReducedMotion();
  const [visible, setVisible] = useStoredPreferenceState(
    loadCrewSceneEnabled,
    subscribeCrewSceneEnabled,
  );
  const [growth, setGrowth] = useStoredPreferenceState(
    loadCrewGrowthEnabled,
    subscribeCrewGrowthEnabled,
  );
  const [tabs, setTabs] = useStoredPreferenceState(
    loadTabAnimationsEnabled,
    subscribeTabAnimationsEnabled,
  );
  const growthLabel = theme === "classic" ? t("Grow with context") : t("Color with context");
  return (
    <>
      <Group
        title={t("Agent crew")}
        modified={
          visible !== CREW_SCENE_ENABLED_DEFAULT ||
          growth !== CREW_GROWTH_ENABLED_DEFAULT ||
          theme !== "classic"
        }
        resetLabel={t("Reset crew")}
        onReset={resetCrew}
      >
        <Row id="crew-scene" label={t("Show agent crew")}>
          <Toggle
            label={t("Agent crew")}
            on={visible}
            onChange={(next) => {
              saveCrewSceneEnabled(next);
              setVisible(next);
            }}
          />
        </Row>
        {/* The stage renders in the theme row's feedback slot while the crew is on; the Row (feedbackPosition="start")
            places it above the picker so the group opens with the hero. Off, it is not rendered. */}
        <Row
          id="crew-theme"
          controlWidth="fill"
          feedbackPosition="start"
          label={t("Crew theme")}
          info={crewThemeHint(theme)}
          dependsOn={visible}
          feedback={
            visible ? (
              <div className="crew-stage-card">
                <CrewScene
                  workingCount={3}
                  crew={
                    theme === "classic" && !growth
                      ? Array.from({ length: 6 }, (_, id) => ({
                          role: id === 2 ? "lead" : id === 3 ? "advisor" : "subagent",
                          working: id === 0 || id === 2 || id === 3,
                          context: [0.15, 0.35, 0.5, 0.7, 0.9, 1][id],
                        }))
                      : undefined
                  }
                />
              </div>
            ) : undefined
          }
        >
          <SegmentedControl
            label={t("Crew theme")}
            value={theme}
            options={[
              { value: "classic", label: t("Classic crew"), disabled: !visible },
              { value: "star-wars", label: t("Star Wars"), disabled: !visible },
              { value: "lotr", label: t("The Lord of the Rings"), disabled: !visible },
              { value: "matrix", label: t("The Matrix"), disabled: !visible },
            ]}
            onValueChange={(value) => saveCrewTheme(value as CrewTheme)}
          />
        </Row>
        <Row
          id="crew-growth"
          label={growthLabel}
          dependsOn={visible}
          description={
            theme === "classic"
              ? t("Each crew member ages with its own context: baby, child, adult, then uncle.")
              : t("Each character fills with color as its context fills.")
          }
        >
          <Toggle
            label={growthLabel}
            on={growth}
            onChange={(next) => {
              saveCrewGrowthEnabled(next);
              setGrowth(next);
            }}
          />
        </Row>
      </Group>
      <Group
        title={t("Motion")}
        modified={
          tabs !== TAB_ANIMATIONS_ENABLED_DEFAULT ||
          decorative !== DECORATIVE_MOTION_DEFAULT ||
          followSystem !== FOLLOW_SYSTEM_MOTION_DEFAULT
        }
        resetLabel={t("Reset motion")}
        onReset={resetMotion}
      >
        <Row
          id="follow-system-motion"
          label={t("Follow system setting")}
          description={t("Reduced motion in your system turns decorative and tab animations off.")}
        >
          <Toggle
            label={t("Follow system setting")}
            on={followSystem}
            onChange={saveFollowSystemMotionEnabled}
          />
        </Row>
        <Row
          id="decorative-motion"
          label={t("Decorative animations")}
          description={
            reducedMotion
              ? t("Your system requests reduced motion, so decorative animations stay still.")
              : t("Background effects, project sigils and the agent crew scene.")
          }
        >
          <Toggle
            label={t("Decorative animations")}
            on={decorative}
            onChange={saveDecorativeMotionEnabled}
          />
        </Row>
        <AdvancedSettings settingIds={["tab-animations"]}>
          <Row
            id="tab-animations"
            label={t("Tab animations")}
            description={t("Slide tabs as they open and close. Off makes tab changes instant.")}
          >
            <Toggle
              label={t("Tab animations")}
              on={tabs}
              onChange={(next) => {
                saveTabAnimationsEnabled(next);
                setTabs(loadTabAnimationsEnabled());
              }}
            />
          </Row>
        </AdvancedSettings>
      </Group>
    </>
  );
}
