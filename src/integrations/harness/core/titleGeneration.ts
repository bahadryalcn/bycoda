import type { HarnessOperationContext } from "./types";
import { captureTextInput } from "./textSource";
import {
  buildThreadTitlePrompt,
  parseGeneratedSessionTitle,
  type GeneratedSessionTitle,
} from "../../../features/sessions/model/sessionTitle";

export type TitleInput = {
  sessionId: string;
  cwd: string;
  message: string;
  providerAccountId?: string;
  operationContext?: HarnessOperationContext;
};
export type TitlePrompt = {
  cwd: string;
  prompt: string;
  timeoutMs: number;
  providerAccountId?: string;
  operationContext?: HarnessOperationContext;
};

/** Provider transport stays in its adapter; title prompting, parsing and fallback are shared. */
export async function generateSessionTitle(
  input: TitleInput,
  run: (prompt: TitlePrompt) => Promise<string>,
): Promise<GeneratedSessionTitle | null> {
  input = captureTextInput(input);
  try {
    const output = await run({
      cwd: input.cwd,
      operationContext: input.operationContext,
      prompt: buildThreadTitlePrompt(input.message),
      timeoutMs: 45_000,
      ...(input.providerAccountId ? { providerAccountId: input.providerAccountId } : {}),
    });
    return parseGeneratedSessionTitle(output, input.message);
  } catch (error) {
    console.debug("[bycoda] session title", error);
    return null;
  }
}
