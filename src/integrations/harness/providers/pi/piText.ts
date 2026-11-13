import { captureTextInput, prepareTextProcess, runTextOperation } from "../../core/textSource";
import { piTurnWriter } from "../turnWriter";
import { killChild } from "../../core/child";
import {
  settleProviderRetirements,
  observeProviderProbeCleanup,
  createProviderRetirementLedger,
  preserveProviderFailure,
  withProviderRetirement,
} from "../../core/providerRetirement";
import { continueAfterFailure, settledTail } from "../../../../shared/lib/promiseQueue";
import { modelsFor } from "../../../../features/sessions/model/models";
import {
  createChildProcessHandle,
  spawnChild,
  watchChild,
  type ChildProcessHandle,
} from "../../core/child";
import { PiRpc } from "./piClient";
import { OMP_FLAVOR, PI_FLAVOR, type PiFlavor } from "./piFlavor";
import {
  agentEndWillRetry,
  asRecord,
  assistantDeltaFromEvent,
  buildPiPrompt,
  buildPiSpawnArgs,
  isAgentSettled,
  isPiThinkingLevel,
} from "./piProtocol";
import { abortTextPromptRace } from "../../core/abortTextPrompt";
import type { HarnessEvent, HarnessOperationContext } from "../../core/types";

const retirements = createProviderRetirementLedger("pi.text", killChild);

const INIT_TIMEOUT_MS = 15_000;
const REQUEST_TIMEOUT_MS = 45_000;

type LiveText = {
  process: ChildProcessHandle;
  rpc: PiRpc;
  cwd: string;
  model?: string;
  settingsKey: string;
  collecting: boolean;
  output: string;
  closed: boolean;
  turnDone: (() => void) | null;
  turnFailed: ((error: Error) => void) | null;
  turnEndPending: boolean;
  onEvent?: (event: HarnessEvent) => void;
};

type TextState = {
  live: LiveText | null;
  starting: ChildProcessHandle | null;
  turns: Promise<void>;
};

const stateByFlavor = new Map<string, TextState>();

function stateFor(flavor: PiFlavor): TextState {
  let state = stateByFlavor.get(flavor.id);
  if (!state) {
    state = { live: null, starting: null, turns: Promise.resolve() };
    stateByFlavor.set(flavor.id, state);
  }
  return state;
}

function pickTextModel(flavor: PiFlavor, requested?: string): string | undefined {
  const selected = requested?.trim();
  if (selected?.includes("/")) return selected;
  const models = modelsFor(flavor.id).filter((model) => Boolean(model.nativeId?.includes("/")));
  const cheap = models.find((model) =>
    /haiku|mini|flash|nano|lite|luna/i.test(`${model.nativeId ?? ""} ${model.name} ${model.id}`),
  );
  return (cheap ?? models[0])?.nativeId?.trim() || undefined;
}

export async function stopTextPrompt(flavor: PiFlavor): Promise<void> {
  await dropLive(flavor);
}

export function warmupText(flavor: PiFlavor, cwd: string): Promise<void> {
  if (!cwd || cwd === "~") return Promise.resolve();
  const state = stateFor(flavor);
  const run = continueAfterFailure(state.turns, async () => {
    await ensureLive(flavor, cwd);
  });
  state.turns = settledTail(run);
  return observeProviderProbeCleanup(run);
}

export async function runTextPrompt(
  flavor: PiFlavor,
  input: import("../../core/providerRetirement").ProviderRetirementObserver & {
    cwd: string;
    model?: string;
    modelSettings?: Record<string, string>;
    prompt: string;
    timeoutMs?: number;
    signal?: AbortSignal;
    onEvent?: (event: HarnessEvent) => void;
    operationContext?: HarnessOperationContext;
  },
): Promise<string> {
  input = captureTextInput(input);
  const state = stateFor(flavor);
  const run = state.turns
    .catch(() => undefined)
    .then(() => runTextOperation(input.operationContext, () => promptOnLive(flavor, input)));
  state.turns = settledTail(run);
  return run;
}

async function promptOnLive(
  flavor: PiFlavor,
  input: import("../../core/providerRetirement").ProviderRetirementObserver & {
    cwd: string;
    model?: string;
    modelSettings?: Record<string, string>;
    prompt: string;
    timeoutMs?: number;
    signal?: AbortSignal;
    onEvent?: (event: HarnessEvent) => void;
    operationContext?: HarnessOperationContext;
  },
): Promise<string> {
  input.signal?.throwIfAborted();
  const session = await ensureLive(
    flavor,
    input.cwd,
    input.model,
    input.modelSettings,
    input.operationContext,
    input,
  );
  let writer: Awaited<ReturnType<typeof piTurnWriter>>;
  try {
    prepareTextProcess(session.process, input.operationContext);
    writer = await piTurnWriter(
      session.process,
      session.rpc,
      input.operationContext?.nativeControlTurn,
      input.operationContext,
    );
    input.signal?.throwIfAborted();
  } catch (error) {
    return preserveProviderFailure(error, dropLive(flavor, session), input);
  }
  const abortOriginal = async () => {
    const original = await piTurnWriter(
      session.process,
      session.rpc,
      input.operationContext?.nativeControlTurn,
      input.operationContext,
      "control",
    );
    return original.request({ type: "abort" });
  };
  const timeoutMs = input.timeoutMs ?? REQUEST_TIMEOUT_MS;
  return withProviderRetirement(
    async () => {
      try {
        // Never continue with the previous utility conversation if reset failed.
        await writer.request({ type: "new_session" });
        const thinking = input.modelSettings?.thinking;
        await writer
          .request({
            type: "set_thinking_level",
            level: isPiThinkingLevel(thinking) ? thinking : "off",
          })
          .catch(() => undefined);
        const fast = input.modelSettings?.fast;
        if (flavor.id === "omp" && (fast === "true" || fast === "false")) {
          await writer
            .request({ type: "set_fast_mode", enabled: fast === "true" })
            .catch(() => undefined);
        }
        session.output = "";
        session.collecting = true;
        session.onEvent = input.onEvent;
        session.turnEndPending = false;

        const turnPromise = new Promise<void>((resolve, reject) => {
          session.turnDone = resolve;
          session.turnFailed = reject;
        });

        const failOriginal = session.turnFailed;
        const abort = abortTextPromptRace(input.signal, () => {
          failOriginal?.(new Error("By-the-way request cancelled"));
          void abortOriginal().catch(() => undefined);
        });

        await writer.request(buildPiPrompt({ text: input.prompt }), timeoutMs);
        if (session.turnEndPending) finishTurn(session);

        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
          await Promise.race([
            turnPromise,
            new Promise<void>((_, reject) => {
              timer = setTimeout(
                () => reject(new Error(`${flavor.label} text generation timed out`)),
                timeoutMs,
              );
            }),
            ...(abort.promise ? [abort.promise] : []),
          ]);
        } finally {
          abort.detach();
          if (timer) clearTimeout(timer);
        }

        let output = session.output.trim();
        if (!output) {
          const rec = await writer.request({ type: "get_last_assistant_text" }).catch(() => null);
          const text = asRecord(rec?.data)?.text;
          if (typeof text === "string") output = text.trim();
        }
        if (!output) throw new Error(`${flavor.label} returned empty output.`);
        return output;
      } catch (error) {
        session.turnDone = null;
        session.turnFailed = null;
        await abortOriginal().catch(() => undefined);
        throw error;
      } finally {
        session.collecting = false;
        session.onEvent = undefined;
        session.turnDone = null;
        session.turnFailed = null;
      }
    },
    () => dropLive(flavor, session),
    input,
  );
}

async function ensureLive(
  flavor: PiFlavor,
  cwd: string,
  requestedModel?: string,
  modelSettings?: Record<string, string>,
  operationContext?: HarnessOperationContext,
  retirement?: import("../../core/providerRetirement").ProviderRetirementObserver,
): Promise<LiveText> {
  const state = stateFor(flavor);
  const model = pickTextModel(flavor, requestedModel);
  const settingsKey = modelSettingsKey(modelSettings);
  const current = state.live;
  if (current && !current.closed) {
    prepareTextProcess(current.process, operationContext);
    await piTurnWriter(
      current.process,
      current.rpc,
      operationContext?.nativeControlTurn,
      operationContext,
    );
    if (state.live !== current || current.closed)
      throw new Error(`${flavor.label} text generator stopped`);
  }
  if (
    current &&
    !current.closed &&
    current.cwd === cwd &&
    current.model === model &&
    current.settingsKey === settingsKey
  ) {
    return current;
  }
  return startLive(flavor, cwd, model, modelSettings, operationContext, retirement);
}

async function startLive(
  flavor: PiFlavor,
  cwd: string,
  model?: string,
  modelSettings?: Record<string, string>,
  operationContext?: HarnessOperationContext,
  retirement?: import("../../core/providerRetirement").ProviderRetirementObserver,
): Promise<LiveText> {
  const state = stateFor(flavor);
  const previous = captureDrop(flavor);
  let stopping = Promise.resolve();
  const childId = flavor.textChildId;
  const textProcess = createChildProcessHandle(
    childId,
    operationContext?.nativeControlTurn,
    operationContext?.nativeControlTurn ? undefined : "utility",
  );
  prepareTextProcess(textProcess, operationContext, true);
  const liveRef: { current: LiveText | null } = { current: null };
  let admitted = false;
  try {
    retirements.admitPending(textProcess);
    admitted = true;
    state.starting = textProcess;
    stopping = dropLive(flavor, undefined, previous);
    const rpc = new PiRpc(
      textProcess,
      (rec) => {
        const current = liveRef.current;
        if (current) handleFrame(current, rec);
      },
      flavor.label,
    );
    const session: LiveText = {
      process: textProcess,
      rpc,
      cwd,
      model,
      settingsKey: modelSettingsKey(modelSettings),
      collecting: false,
      output: "",
      closed: false,
      turnDone: null,
      turnFailed: null,
      turnEndPending: false,
      onEvent: undefined,
    };
    liveRef.current = session;

    watchChild(
      textProcess,
      (line) => rpc.pushLine(line),
      () => {
        session.closed = true;
        if (state.live === session) state.live = null;
        const exited = new Error(`${flavor.label} text generator exited`);
        rpc.close(exited);
        session.turnFailed?.(exited);
        session.turnDone = null;
        session.turnFailed = null;
      },
    );

    await stopping;
    const { path } = await flavor.resolveBinary();
    if (state.starting !== textProcess) throw new Error(`${flavor.label} text startup cancelled`);
    await spawnChild(
      textProcess,
      path,
      buildPiSpawnArgs(flavor, {
        isolated: true,
        model,
      }),
      cwd,
      undefined,
      flavor.id,
    );
    const writer = await piTurnWriter(
      textProcess,
      rpc,
      operationContext?.nativeControlTurn,
      operationContext,
    );
    await writer.request({ type: "get_state" }, INIT_TIMEOUT_MS);
    if (state.starting !== textProcess || session.closed)
      throw new Error(`${flavor.label} text startup cancelled`);
    state.live = session;
    return session;
  } catch (error) {
    const session = liveRef.current;
    if (session) {
      session.closed = true;
      session.rpc.close(error instanceof Error ? error : new Error(String(error)));
    }
    return preserveProviderFailure(
      error,
      settleProviderRetirements([
        stopping,
        ...(admitted ? [retirements.retire([textProcess])] : []),
      ]),
      retirement,
    );
  } finally {
    if (state.starting === textProcess) state.starting = null;
  }
}

function captureDrop(flavor: PiFlavor) {
  const state = stateFor(flavor);
  return {
    current: state.live,
    pending: state.starting,
    cohort: retirements.cohort(flavor.textChildId),
  };
}
async function dropLive(
  flavor: PiFlavor,
  expected?: LiveText,
  captured?: ReturnType<typeof captureDrop>,
): Promise<void> {
  const state = stateFor(flavor);
  const snapshot = captured ?? captureDrop(flavor);
  const current = expected ?? snapshot.current;
  const starting = expected ? null : snapshot.pending;
  if (state.live === current) state.live = null;
  if (state.starting === starting) state.starting = null;
  if (current) {
    current.closed = true;
    current.rpc.close();
    current.turnFailed?.(new Error(`${flavor.label} text generator stopped`));
    current.turnDone = null;
    current.turnFailed = null;
  }
  const original = new Set([current?.process, starting]);
  await (expected
    ? retirements.retire(original)
    : settleProviderRetirements([snapshot.cohort.retire(), retirements.retire(original)]));
}

function handleFrame(session: LiveText, rec: Record<string, unknown>) {
  if (!session.collecting) return;
  const delta = assistantDeltaFromEvent(rec);
  if (delta?.kind === "text") {
    session.output += delta.text;
    session.onEvent?.({ type: "message.delta", text: delta.text });
  } else if (delta?.kind === "thinking") {
    session.onEvent?.({ type: "reasoning.delta", text: delta.text });
  }
  if (isAgentSettled(rec) || agentEndWillRetry(rec) === false) {
    if (session.turnDone) finishTurn(session);
    else session.turnEndPending = true;
  }
}

function finishTurn(session: LiveText) {
  session.turnEndPending = false;
  const done = session.turnDone;
  session.turnDone = null;
  session.turnFailed = null;
  done?.();
}
function modelSettingsKey(settings?: Record<string, string>): string {
  return JSON.stringify({
    thinking: settings?.thinking,
    fast: settings?.fast,
  });
}

export const stopPiTextPrompt = () => stopTextPrompt(PI_FLAVOR);
export const warmupPiText = (cwd: string) => warmupText(PI_FLAVOR, cwd);
export const runPiTextPrompt = (
  input: import("../../core/providerRetirement").ProviderRetirementObserver & {
    cwd: string;
    model?: string;
    modelSettings?: Record<string, string>;
    prompt: string;
    timeoutMs?: number;
    signal?: AbortSignal;
    onEvent?: (event: HarnessEvent) => void;
    operationContext?: HarnessOperationContext;
  },
) => runTextPrompt(PI_FLAVOR, input);

export const stopOmpTextPrompt = () => stopTextPrompt(OMP_FLAVOR);
export const warmupOmpText = (cwd: string) => warmupText(OMP_FLAVOR, cwd);
export const runOmpTextPrompt = (
  input: import("../../core/providerRetirement").ProviderRetirementObserver & {
    cwd: string;
    model?: string;
    modelSettings?: Record<string, string>;
    prompt: string;
    timeoutMs?: number;
    signal?: AbortSignal;
    onEvent?: (event: HarnessEvent) => void;
    operationContext?: HarnessOperationContext;
  },
) => runTextPrompt(OMP_FLAVOR, input);
