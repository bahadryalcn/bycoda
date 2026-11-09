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
import { Group, Row, Toggle } from "../../settingsControls";
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
      return t("The original tea crew, drawn in monochrome code art.");
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
        {/* The stage renders in the row's feedback slot; CrewStageCard.css places it above the
            theme picker so the group opens with the hero and its caption. */}
        <Row
          id="crew-theme"
          label={t("Crew theme")}
          disabled={!visible}
          disabledReason={t("Turn on the agent crew first")}
          feedback={
            <div className="crew-stage-card">
              <CrewScene workingCount={3} />
              <p className="settings-help-text crew-stage-hint">{crewThemeHint(theme)}</p>
            </div>
          }
        >
          <SegmentedControl
            label={t("Crew theme")}
            value={theme}
            options={[
              {
                value: "classic",
                label: t("Classic crew"),
                disabled: !visible,
              },
              { value: "star-wars", label: "Star Wars", disabled: !visible },
              {
                value: "lotr",
                label: t("The Lord of the Rings"),
                disabled: !visible,
              },
              { value: "matrix", label: t("The Matrix"), disabled: !visible },
            ]}
            onValueChange={(value) => saveCrewTheme(value as CrewTheme)}
          />
        </Row>
        <Row
          id="crew-scene"
          label={t("Show agent crew")}
          description={t(
            "Show the main agent, the advisor and subagents as a crew. Decorative animations control their activity.",
          )}
          descriptionVisible={false}
        >
          <Toggle
            label={t("Agent crew")}
            on={visible}
            onChange={(next) => {
              saveCrewSceneEnabled(next);
              setVisible(next);
            }}
          />
        </Row>
        <Row
          id="crew-growth"
          label={growthLabel}
          disabled={!visible}
          disabledReason={t("Turn on the agent crew first")}
          description={
            theme === "classic"
              ? t(
                  "Each crew member ages with its own context window: baby, child, adult, then uncle. Compaction makes them younger again. When off, everyone is an uncle.",
                )
              : t(
                  "Each character fills with color from the feet up as its context fills. Compaction lowers the level. Unknown context stays neutral. When off, all characters stay in full color.",
                )
          }
          descriptionVisible={false}
        >
          <Toggle
            label={growthLabel}
            on={growth}
            disabled={!visible}
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
          description={t(
            "When your system asks for reduced motion, decorative and tab animations turn off.",
          )}
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
      </Group>
    </>
  );
}
