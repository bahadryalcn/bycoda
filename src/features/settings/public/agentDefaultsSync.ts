// Renderer bootstrap: registers the desktop sync of Host-owned agent defaults. The headless
// Host reads defaults through `agentDefaultsStore.ts` and never loads this module.
export { initializeAgentDefaults, saveAgentDefaultConfirmed } from "../model/agentDefaults";
