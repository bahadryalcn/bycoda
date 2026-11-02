import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { registerBuiltinHarnesses } from "../src/integrations/harness/core/register";
import { runHarnessTextPrompt } from "../src/integrations/harness/core/registry";
import { nativeModelId } from "../src/features/sessions/model/models";
import {
  AssistantRequestSchema,
  type AssistantProfile,
} from "../src/shared/model/host-contracts/assistant";
import {parseChiefReadRequests,type ChiefReadRequest} from "./assistant-chief-reads";
import type { AssistantTextLimits } from "./assistant-text-budget";

export type AssistantTextResult = { text: string; tokens?: number;contextWindow?:number };
export type AssistantTextContext = {
  threadId?: string;
  onThreadId: (threadId: string) => Promise<void>;
  compactBefore?:boolean;
  onCompacted?:(receipt:{threadId:string})=>Promise<void>;
};
export type AssistantTextRunner = (
  profile: AssistantProfile,
  prompt: string,
  signal?: AbortSignal,
  context?: AssistantTextContext,
  limits?: AssistantTextLimits,
) => Promise<AssistantTextResult>;

/** Isolated text-only reasoning. No session, desktop or publication grant. */
export function assistantText(directory: string): AssistantTextRunner {
  return async (
    profile: AssistantProfile,
    prompt: string,
    signal?: AbortSignal,
    context?: AssistantTextContext,
    limits?: AssistantTextLimits,
  ) => {
    const execution = profile.execution;
    if (!execution) throw new Error("Choose an execution provider and model first.");
    if(context?.compactBefore&&(!context.threadId||!context.onCompacted))throw new Error("Chief compaction needs its original thread and durable receipt.");
    const cwd = join(directory, "assistant-text-workspace");
    await mkdir(cwd, { recursive: true, mode: 0o700 });
    registerBuiltinHarnesses();
    let tokens: number | undefined;
    let contextWindow:number|undefined;
    let compactTokens:number|undefined;
    let compacted=!context?.compactBefore;
    const text = await runHarnessTextPrompt({
      harness: execution.harness,
      model: nativeModelId(execution.model),
      modelSettings: execution.modelSettings,
      cwd,
      prompt,
      ...limits,
      intent: "plan",
      ephemeral: !context,
      ...(context ? { threadId: context.threadId, onThreadId: context.onThreadId,compactBefore:context.compactBefore,
        ...(context.compactBefore?{onCompacted:async(receipt:{threadId:string})=>{
          if(compacted)throw new Error("Chief compaction receipt was repeated.");
          signal?.throwIfAborted();await context.onCompacted?.(receipt);signal?.throwIfAborted();
          compactTokens=tokens;tokens=undefined;compacted=true;
        }}:{})} : {}),
      timeoutMs: 90_000,
      signal,
      onEvent: (event) => {
        if(event.type==="context"&&Number.isSafeInteger(event.window)&&event.window!>0)contextWindow=event.window;
        if (
          event.type === "turn.metrics" &&
          Number.isSafeInteger(event.inputTokens) &&
          Number.isSafeInteger(event.outputTokens) &&
          event.inputTokens! >= 0 &&
          event.outputTokens! >= 0
        )
          tokens = Math.max(tokens ?? 0, event.inputTokens! + event.outputTokens!);
      },
    });
    signal?.throwIfAborted();
    if(!compacted)throw new Error("The provider did not confirm Chief compaction.");
    if (!text.trim() || text.length > Math.min(64000,limits?.maxOutputChars??64000))
      throw new Error("The assistant response was empty or too large.");
    const total=context?.compactBefore?(tokens===undefined||compactTokens===undefined?undefined:tokens+compactTokens):tokens;
    return { text, ...(total === undefined ? {} : { tokens:total }),...(contextWindow?{contextWindow}:{}) };
  };
}

export function chiefActions(raw: string) {
  const parsed: unknown = JSON.parse(raw);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
    throw new Error("Invalid Chief decision.");
  const value = parsed as Record<string, unknown>;
  if (
    Object.keys(value).some((key) => key !== "actions"&&key!=="reads") ||
    !Array.isArray(value.actions) ||
    value.actions.length > 10
  )
    throw new Error("Invalid Chief actions.");
  const reads=chiefReadRequests(raw);
  if(reads.length&&value.actions.length)throw new Error("Chief read intents and write actions require separate wakes.");
  return value.actions.map((action) => {
    const request = AssistantRequestSchema.parse(action);
    if (
      request.op !== "jobs.replan" &&
      request.op !== "sessions.nudge" &&
      request.op !== "sessions.answer" &&
      request.op !== "questions.ask" &&
      request.op !== "manual.nudge" &&
      !(request.op === "memory.save" && request.kind === "fact" && request.source === "learned")
    )
      throw new Error("The Chief cannot perform this action.");
    return request;
  });
}
export function chiefReadRequests(raw:string):ChiefReadRequest[]{
  const value=JSON.parse(raw) as {reads?:unknown};
  return value.reads===undefined?[]:parseChiefReadRequests(value.reads);
}
