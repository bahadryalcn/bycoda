import { cachedSkillPolicy } from "./skillPreferences";
import {
  mergeCliCommands as mergeCommands,
  mergeDollarSkills as mergeSkills,
} from "./cliCommandCatalog";

export * from "./cliCommandCatalog";

/** Desktop injects its machine-owned policy; the catalog itself stays platform independent. */
export function mergeCliCommands(input: Parameters<typeof mergeCommands>[0]) {
  return mergeCommands(input, cachedSkillPolicy());
}

export function mergeDollarSkills(input: Parameters<typeof mergeSkills>[0]) {
  return mergeSkills(input, cachedSkillPolicy());
}
