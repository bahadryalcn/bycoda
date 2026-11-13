import { t } from "../../../shared/i18n/core";
import type { SettingsSection } from "./settings";

/** Background-work navigation and search metadata; labels stay locale-reactive. */
export const CREWS_SETTINGS_SECTION: SettingsSection = {
  id: "crews",
  group: "agents",
  get label() {
    return t("Crews");
  },
  get description() {
    return t("Reusable agent teams, project crews and model allocation policies.");
  },
  keywords:
    "crew team coordinator specialist reviewer advisor orchestration model cost quality capability",
};

export const WORK_SETTINGS_SECTION: SettingsSection = {
  id: "work",
  group: "agents",
  get label() {
    return t("Background work");
  },
  get description() {
    return t("Which models tasks, epics, automations and crews use, and their limits.");
  },
  keywords: "model order pools assignments roles work limits subagents delegation",
};
