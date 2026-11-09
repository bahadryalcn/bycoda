import type { HarnessOperationContext } from "../../core/types";
import { captureTextInput } from "../../core/textSource";
import { nativeModelId } from "../../../../features/sessions/model/models";
import {
  buildThreadTitlePrompt,
  parseGeneratedSessionTitle,
  type GeneratedSessionTitle,
} from "../../../../features/sessions/model/sessionTitle";
import { OMP_FLAVOR, PI_FLAVOR, type PiFlavor } from "./piFlavor";
import { runTextPrompt } from "./piText";

const TITLE_TIMEOUT_MS = 45_000;

async function generateSessionTitle(
  flavor: PiFlavor,
  input: {
    sessionId: string;
    cwd: string;
    message: string;
    model?: string;
    modelSettings?: Record<string, string>;
    providerAccountId?: string;
    operationContext?: HarnessOperationContext;
  },
): Promise<GeneratedSessionTitle | null> {
  input = captureTextInput(input);
  try {
    const model = input.model ? nativeModelId(input.model) : undefined;
    if (model && !model.includes("/"))
      throw new Error("Select a provider/model identity for title generation.");
    const output = await runTextPrompt(flavor, {
      cwd: input.cwd,
      operationContext: input.operationContext,
      prompt: buildThreadTitlePrompt(input.message),
      timeoutMs: TITLE_TIMEOUT_MS,
      model,
      modelSettings: input.modelSettings,
    });
    return parseGeneratedSessionTitle(output, input.message);
  } catch (error) {
    console.debug("[bycoda] session title", error);
    return null;
  }
}

export function generatePiSessionTitle(input: {
  sessionId: string;
  cwd: string;
  message: string;
  model?: string;
  modelSettings?: Record<string, string>;
  providerAccountId?: string;
  operationContext?: HarnessOperationContext;
}): Promise<GeneratedSessionTitle | null> {
  return generateSessionTitle(PI_FLAVOR, input);
}

export function generateOmpSessionTitle(input: {
  sessionId: string;
  cwd: string;
  message: string;
  model?: string;
  modelSettings?: Record<string, string>;
  providerAccountId?: string;
  operationContext?: HarnessOperationContext;
}): Promise<GeneratedSessionTitle | null> {
  return generateSessionTitle(OMP_FLAVOR, input);
}
