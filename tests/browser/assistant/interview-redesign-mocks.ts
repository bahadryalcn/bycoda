import type { AssistantProfileInterviewResult } from "../../../src/shared/model/host-contracts/assistant-builder";

type Pending = {
  resolve(value: AssistantProfileInterviewResult): void;
  reject(error: Error): void;
};
const pending: Pending[] = [];
export const interviewFixture = {
  requests: [] as unknown[],
  resolve(value: AssistantProfileInterviewResult) {
    pending.shift()?.resolve(value);
  },
  reject(message: string) {
    pending.shift()?.reject(new Error(message));
  },
};
(window as any).interviewFixture = interviewFixture;

export function requestAssistantInterview(
  params: unknown,
): Promise<AssistantProfileInterviewResult> {
  interviewFixture.requests.push(structuredClone(params));
  return new Promise((resolve, reject) => pending.push({ resolve, reject }));
}
export async function requestAssistantAvatar(): Promise<string> {
  throw new Error("Avatar generation is outside this fixture.");
}
export async function requestAssistantAvatarData(): Promise<string> {
  throw new Error("Avatar image reads are outside this fixture.");
}
export function assistantBuilderFailureDetail(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
export type AssistantAvatarProvider = "codex" | "gemini";
export type AssistantInterviewParams = Record<string, unknown>;
