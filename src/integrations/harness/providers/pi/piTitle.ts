import type { HarnessOperationContext } from "../../core/types";
import { captureTextInput } from "../../core/textSource";
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
    operationContext?: HarnessOperationContext;
  },
): Promise<GeneratedSessionTitle | null> {
  input = captureTextInput(input);
  try {
    const output = await runTextPrompt(flavor, {
      cwd: input.cwd,
      operationContext: input.operationContext,
      prompt: buildThreadTitlePrompt(input.message),
      timeoutMs: TITLE_TIMEOUT_MS,
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
  operationContext?: HarnessOperationContext;
}): Promise<GeneratedSessionTitle | null> {
  return generateSessionTitle(PI_FLAVOR, input);
}

export function generateOmpSessionTitle(input: {
  sessionId: string;
  cwd: string;
  message: string;
  operationContext?: HarnessOperationContext;
}): Promise<GeneratedSessionTitle | null> {
  return generateSessionTitle(OMP_FLAVOR, input);
}
