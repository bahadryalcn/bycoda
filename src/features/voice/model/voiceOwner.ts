import { loadVoiceMemory, voiceMemoryInstructions } from "./voiceMemory";
import { loadVoicePersona, voicePersonaInstructions } from "./voicePersona";

/** Owner persona and saved memory, read fresh for each voice turn or connection. */
export function voiceOwnerInstructions(): string {
  return [voicePersonaInstructions(loadVoicePersona()), voiceMemoryInstructions(loadVoiceMemory())]
    .filter(Boolean)
    .join("\n");
}
