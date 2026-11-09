import { useStoredPreferenceState } from "../../../shared/hooks/useStoredPreferenceState";
import { useSyncExternalStore } from "react";
import { t, useLocale } from "../../../shared/i18n";
import {
  loadCrewGrowthEnabled,
  subscribeCrewSceneEnabled,
  subscribeCrewGrowthEnabled,
  loadCrewSceneEnabled,
  loadTabAnimationsEnabled,
  subscribeTabAnimationsEnabled,
  saveCrewGrowthEnabled,
  saveCrewSceneEnabled,
  saveTabAnimationsEnabled,
  CREW_GROWTH_ENABLED_DEFAULT,
  CREW_SCENE_ENABLED_DEFAULT,
  loadCrewTheme,
  TAB_ANIMATIONS_ENABLED_DEFAULT,
  type CrewTheme,
  saveCrewTheme,
  subscribeCrewTheme,
} from "../model/settings";
import {
  defaultDecorativeMotion,
  saveDecorativeMotionEnabled,
  useDecorativeMotionPreference,
  usePrefersReducedMotion,
} from "../model/decorativeMotion";
import { Group, Row, Select, Toggle } from "./settingsControls";

/** Tab and decorative animation preferences as one group with a single reset. */
export function MotionSettings() {
  useLocale();
  const decorativeMotion = useDecorativeMotionPreference();
  const reducedMotion = usePrefersReducedMotion();
  const [tabAnimationsEnabled, setTabAnimationsEnabled] = useStoredPreferenceState(
    loadTabAnimationsEnabled,
    subscribeTabAnimationsEnabled,
  );
  const onTabAnimationsEnabled = (next: boolean) => {
    saveTabAnimationsEnabled(next);
    setTabAnimationsEnabled(loadTabAnimationsEnabled());
  };
  return (
    <Group
      title={t("Motion")}
      modified={
        tabAnimationsEnabled !== TAB_ANIMATIONS_ENABLED_DEFAULT ||
        decorativeMotion !== defaultDecorativeMotion()
      }
      resetLabel={t("Reset motion")}
      onReset={() => {
        saveTabAnimationsEnabled(TAB_ANIMATIONS_ENABLED_DEFAULT);
        saveDecorativeMotionEnabled(defaultDecorativeMotion());
      }}
    >
      <Row
        id="tab-animations"
        label={t("Tab animations")}
        description={t(
          "Animate tabs as they open and close. Turn this off for instant tab changes.",
        )}
      >
        <Toggle
          label={t("Tab animations")}
          on={tabAnimationsEnabled}
          onChange={onTabAnimationsEnabled}
        />
      </Row>
      <Row
        id="decorative-motion"
        label={t("Decorative animations")}
        description={
          reducedMotion
            ? t("Your system requests reduced motion, so decorative animations stay still.")
            : t("Animate project sigils, chat transitions and the agent crew scene.")
        }
      >
        <Toggle
          label={t("Decorative animations")}
          on={decorativeMotion}
          onChange={saveDecorativeMotionEnabled}
        />
      </Row>
    </Group>
  );
}
export function CrewSettings() {
  useLocale();
  const crewTheme = useSyncExternalStore(subscribeCrewTheme, loadCrewTheme, loadCrewTheme);
  const characterTheme = crewTheme !== "classic";
  const growthLabel = characterTheme ? t("Color with context") : t("Grow with context");
  const [crewSceneEnabled, setCrewSceneEnabled] = useStoredPreferenceState(
    loadCrewSceneEnabled,
    subscribeCrewSceneEnabled,
  );
  const onCrewSceneEnabled = (next: boolean) => {
    saveCrewSceneEnabled(next);
    setCrewSceneEnabled(next);
  };
  const [crewGrowthEnabled, setCrewGrowthEnabled] = useStoredPreferenceState(
    loadCrewGrowthEnabled,
    subscribeCrewGrowthEnabled,
  );
  const onCrewGrowthEnabled = (next: boolean) => {
    saveCrewGrowthEnabled(next);
    setCrewGrowthEnabled(next);
  };
  return (
    <>
      <Group
        title={t("Agent crew")}
        description={t("Your agent crew in new tasks and behind conversations.")}
        modified={
          crewSceneEnabled !== CREW_SCENE_ENABLED_DEFAULT ||
          crewGrowthEnabled !== CREW_GROWTH_ENABLED_DEFAULT ||
          crewTheme !== "classic"
        }
        resetLabel={t("Reset crew")}
        onReset={() => {
          saveCrewSceneEnabled(CREW_SCENE_ENABLED_DEFAULT);
          saveCrewGrowthEnabled(CREW_GROWTH_ENABLED_DEFAULT);
          saveCrewTheme("classic");
        }}
      >
        <Row
          id="crew-scene"
          label={t("Show agent crew")}
          description={t(
            "Show the main agent, the advisor and subagents as a crew. Decorative animations control their activity.",
          )}
        >
          <Toggle label={t("Agent crew")} on={crewSceneEnabled} onChange={onCrewSceneEnabled} />
        </Row>
        <Row
          id="crew-theme"
          disabled={!crewSceneEnabled}
          disabledReason={t("Turn on the agent crew first")}
          label={t("Crew theme")}
          descriptionVisible={false}
          description={
            crewTheme === "star-wars"
              ? t(
                  "Obi-Wan leads, Yoda advises; Darth Vader, Luke, Leia and Chewbacca join as subagents. R2-D2 joins when the crew grows beyond six.",
                )
              : crewTheme === "lotr"
                ? t(
                    "Gandalf leads, Sauron advises; a Nazgûl, an Elf, a Dwarf and a Hobbit join as subagents. Orcs arrive when more than six subagents work.",
                  )
                : crewTheme === "matrix"
                  ? t("Neo leads, Morpheus advises, and every subagent is another Agent Smith.")
                  : t("The original tea crew, drawn in monochrome code art.")
          }
        >
          <Select
            hideLabel
            label={t("Crew theme")}
            value={crewTheme}
            disabled={!crewSceneEnabled}
            options={[
              { value: "classic", label: t("Classic crew") },
              { value: "star-wars", label: "Star Wars" },
              { value: "lotr", label: t("The Lord of the Rings") },
              { value: "matrix", label: t("The Matrix") },
            ]}
            onChange={(value) => saveCrewTheme(value as CrewTheme)}
          />
        </Row>
        <Row
          id="crew-growth"
          disabled={!crewSceneEnabled}
          disabledReason={t("Turn on the agent crew first")}
          label={growthLabel}
          descriptionVisible={false}
          description={
            characterTheme
              ? t(
                  "Each character fills with color from the feet up as its context fills. Compaction lowers the level. Unknown context stays neutral. When off, all characters stay in full color.",
                )
              : t(
                  "Each crew member ages with its own context window: baby, child, adult, then uncle. Compaction makes them younger again. When off, everyone is an uncle.",
                )
          }
        >
          <Toggle
            label={growthLabel}
            on={crewGrowthEnabled}
            disabled={!crewSceneEnabled}
            onChange={onCrewGrowthEnabled}
          />
        </Row>
      </Group>
    </>
  );
}
