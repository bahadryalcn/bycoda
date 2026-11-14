import { t } from "../../../shared/i18n/core";
import type { SettingsEntry } from "./settings";

export const modelsSettingsEntries: SettingsEntry[] = [
  {
    id: "models-order",
    section: "work",
    get label() {
      return t("Model order");
    },
    keywords: "main order pools quota capacity unattended work limits",
  },
  {
    id: "models-roles",
    section: "work",
    get label() {
      return t("Assignments");
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
    section: "work",
    get label() {
      return t("Subagents");
    },
    keywords: "advisor subagent max effort image models delegation",
  },
];
