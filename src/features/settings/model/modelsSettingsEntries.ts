import { t } from "../../../shared/i18n/core";
import type { SettingsEntry } from "./settings";

export const modelsSettingsEntries: SettingsEntry[] = [
  {
    id: "models-order",
    section: "providers",
    get label() {
      return t("All models");
    },
    keywords: "main order pools quota capacity unattended work limits",
  },
  {
    id: "models-roles",
    section: "providers",
    get label() {
      return t("Who uses what");
    },
    keywords: "where models are used roles tasks goals crew assistant voice helper models",
  },
  {
    id: "models-chat",
    section: "providers",
    get label() {
      return t("Chat defaults");
    },
    keywords: "default model effort permissions fast",
  },
  {
    id: "default-provider",
    section: "providers",
    get label() {
      return t("Default provider");
    },
    keywords: "new conversations provider",
  },
  {
    id: "models-delegation",
    section: "providers",
    get label() {
      return t("Helpers and delegation");
    },
    keywords: "advisor subagent max effort image models delegation",
  },
];
