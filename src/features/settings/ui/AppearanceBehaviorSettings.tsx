import { useState, useSyncExternalStore } from "react";
import { t, useLocale } from "../../../shared/i18n";
import {
  loadCrewGrowthEnabled,
  loadCrewSceneEnabled,
  loadTabAnimationsEnabled,
  saveCrewGrowthEnabled,
  saveCrewSceneEnabled,
  saveTabAnimationsEnabled,
  loadCrewTheme,
  saveCrewTheme,
  subscribeCrewTheme,
  loadStreamingTextMode,
  subscribeStreamingTextMode,
  saveStreamingTextMode,
} from "../model/settings";
import { Group, Row, Select, Toggle } from "./settingsControls";

export function TabMotionSettings() {
  useLocale();
  const streamingTextMode = useSyncExternalStore(
    subscribeStreamingTextMode,
    loadStreamingTextMode,
    loadStreamingTextMode,
  );
  const [tabAnimationsEnabled, setTabAnimationsEnabled] = useState(loadTabAnimationsEnabled);
  const onTabAnimationsEnabled = (next: boolean) => {
    saveTabAnimationsEnabled(next);
    setTabAnimationsEnabled(next);
  };
  return (
    <>
      <Row
        id="streaming-text-mode"
        label={t("Streaming text animation")}
        description={t(
          "Paced reveals words steadily. Adaptive shows text as it arrives and adjusts the fade to the stream rhythm.",
        )}
      >
        <Select
          label={t("Streaming text animation")}
          value={streamingTextMode}
          options={[
            { value: "paced", label: t("Paced (default)") },
            { value: "adaptive", label: t("Immediate with adaptive fade") },
          ]}
          onChange={(value) =>
            saveStreamingTextMode(value === "adaptive" ? "adaptive" : "paced")
          }
        />
      </Row>
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
    </>
  );
}
export function CrewSettings() {
  useLocale();
  const crewTheme = useSyncExternalStore(subscribeCrewTheme, loadCrewTheme, loadCrewTheme);
  const starWars = crewTheme === "star-wars";
  const growthLabel = starWars ? t("Color with context") : t("Grow with context");
  const [crewSceneEnabled, setCrewSceneEnabled] = useState(loadCrewSceneEnabled);
  const onCrewSceneEnabled = (next: boolean) => {
    saveCrewSceneEnabled(next);
    setCrewSceneEnabled(next);
  };
  const [crewGrowthEnabled, setCrewGrowthEnabled] = useState(loadCrewGrowthEnabled);
  const onCrewGrowthEnabled = (next: boolean) => {
    saveCrewGrowthEnabled(next);
    setCrewGrowthEnabled(next);
  };
  return (
    <>
      <Group
        title={t("Extras")}
        description={t("Your agent crew in new tasks and behind conversations.")}
      >
        <Row
          id="crew-scene"
          label={t("Agent crew")}
          description={t(
            "Show the main agent, the advisor and subagents as a crew. Decorative animations control their activity.",
          )}
        >
          <Toggle label={t("Agent crew")} on={crewSceneEnabled} onChange={onCrewSceneEnabled} />
        </Row>
        <Row
          id="crew-theme"
          label={t("Crew theme")}
          description={
            starWars
              ? t(
                  "Obi-Wan leads, Yoda advises; Darth Vader, Luke, Leia and Chewbacca join as subagents. R2-D2 joins when the crew grows beyond six.",
                )
              : t("The original tea crew, drawn in monochrome code art.")
          }
        >
          <Select
            label={t("Crew theme")}
            value={crewTheme}
            disabled={!crewSceneEnabled}
            options={[
              { value: "classic", label: t("Classic crew") },
              { value: "star-wars", label: "Star Wars" },
            ]}
            onChange={(value) => saveCrewTheme(value === "star-wars" ? "star-wars" : "classic")}
          />
        </Row>
        <Row
          id="crew-growth"
          label={growthLabel}
          description={
            starWars
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
