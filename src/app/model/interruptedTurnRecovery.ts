import { sessionWorkCwd, type Session } from "../../features/sessions/model/session";
import { probeTurnTail, readTurnSteps, type TurnTail } from "../../platform/tauri/turnProbe";
import { markAutoContinueDue } from "../../features/sessions/model/autoContinue";
import { isOwnerStoppedTurn } from "../../features/sessions/model/turnInterruption";
import {
  classifyTurnRecovery,
  disarmAutoContinue,
  isAutoContinueArmed,
  shouldAutoContinue,
  type TurnRecovery,
} from "../../features/sessions/model/turnRecovery";
import type { TurnSteps } from "../../features/sessions/model/turnSteps";
import { loadAutoContinueInterrupted } from "../../features/settings/model/settings";
import { initializeAgentDefaults } from "../../features/settings/public/agentDefaultsSync";

/**
 * Local CLIs cannot outlive Bycoda: on Windows every harness child is in a
 * kill-on-close job object, and on macOS/Linux each runs in its own process
 * group that `kill_all` signals at exit (a crash leaves orphans, and the next
 * launch reaps them). So at launch a chat that was mid-turn has no live
 * process, and only the transcript can say whether the turn got to finish.
 * Remote chats never come through here: their host keeps running and the app
 * re-attaches to its snapshot.
 */
const LOCAL_CHILD_LIVENESS = "dead" as const;
const PROBE_TIMEOUT_MS = 3000;
/** The Host can still be starting at launch; about 30 seconds covers a cold start. */
const HOST_RETRY_DELAYS_MS = [1000, 2000, 4000, 8000, 15_000];

function transcriptProvider(session: Session): "claude" | "codex" | null {
  const provider = session.harness;
  return (provider === "claude" || provider === "codex") && session.providerSessionId
    ? provider
    : null;
}

/** Bounded so a slow disk cannot hold up the first paint. */
function withinTimeout<T>(work: Promise<T>, fallback: T): Promise<T> {
  const timeout = new Promise<T>((resolve) =>
    window.setTimeout(() => resolve(fallback), PROBE_TIMEOUT_MS),
  );
  return Promise.race([work, timeout]).catch(() => fallback);
}

async function transcriptTail(session: Session): Promise<TurnTail | "unsupported"> {
  const provider = transcriptProvider(session);
  if (!provider) return "unsupported";
  return withinTimeout(
    probeTurnTail({
      provider,
      providerSessionId: session.providerSessionId!,
      cwd: sessionWorkCwd(session),
      providerAccountId: session.providerAccountId,
    }),
    { state: "missing" } as TurnTail,
  );
}

/** What the CLI recorded for the last turn, read alongside the tail probe. */
function readRecordedSteps(session: Session): Promise<TurnSteps | null> {
  const provider = transcriptProvider(session);
  if (!provider) return Promise.resolve(null);
  return withinTimeout(
    readTurnSteps({
      provider,
      providerSessionId: session.providerSessionId!,
      cwd: sessionWorkCwd(session),
      providerAccountId: session.providerAccountId,
    }),
    null,
  );
}

/**
 * Put those steps into the session. Anything that goes wrong leaves it as it
 * was: the quit note and the final reply logic still apply on top.
 */
async function withRecordedSteps(
  session: Session,
  steps: TurnSteps | null,
  outcome: "finished" | "interrupted",
): Promise<Session> {
  if (!steps) return session;
  try {
    // The conversion pulls in the provider adapters; boot only pays for them
    // when there is a turn to rebuild.
    const { withTurnSteps } = await import("../../features/sessions/model/turnSteps");
    return withTurnSteps(session, steps, outcome);
  } catch {
    return session;
  }
}

function markDueIfEnabled(session: Session, recovery: TurnRecovery): void {
  if (
    shouldAutoContinue({
      recovery,
      enabled: loadAutoContinueInterrupted(),
      queuedCount: session.queuedMessages?.length ?? 0,
    })
  ) {
    markAutoContinueDue(session.id);
  }
}

/** Runs after first paint. If the Host never answers, the chat keeps its manual Continue. */
async function decideWhenHostAnswers(session: Session, recovery: TurnRecovery): Promise<void> {
  for (const delay of HOST_RETRY_DELAYS_MS) {
    await new Promise((resolve) => window.setTimeout(resolve, delay));
    try {
      await initializeAgentDefaults();
    } catch {
      continue;
    }
    markDueIfEnabled(session, recovery);
    return;
  }
}

/**
 * A chat that was mid-turn when Bycoda went away: look at what really
 * happened before anything is sent. A turn that finished is shown as finished;
 * only a turn that was cut off may be continued, and only when that is certain.
 * Each interruption gets one launch to continue automatically, so a chat the
 * user left interrupted is not sent later. Either way the steps the CLI
 * recorded while the app was away are filled in.
 */
export async function recoverInterruptedTurn(session: Session): Promise<Session> {
  if (isOwnerStoppedTurn(session.blocks)) return session;
  const armed = isAutoContinueArmed(session);
  const [tail, steps] = await Promise.all([transcriptTail(session), readRecordedSteps(session)]);
  const recovery = classifyTurnRecovery({
    wasInFlight: true,
    liveness: LOCAL_CHILD_LIVENESS,
    backgroundWorkAlive: false,
    transcript: tail === "unsupported" ? tail : tail.state,
  });
  if (recovery.state === "finished") {
    // The tail probe can describe the previous provider turn if the newest
    // local prompt never reached it. Only the turn-step merge can place a reply.
    return disarmAutoContinue(await withRecordedSteps(session, steps, "finished"));
  }
  const recovered = disarmAutoContinue(
    recovery.state === "interrupted"
      ? await withRecordedSteps(session, steps, "interrupted")
      : session,
  );
  if (!armed || !recovery.certain) return recovered;
  try {
    await initializeAgentDefaults();
  } catch {
    void decideWhenHostAnswers(recovered, recovery).catch((error: unknown) => {
      console.warn("Could not decide automatic continuation", error);
    });
    return recovered;
  }
  markDueIfEnabled(recovered, recovery);
  return recovered;
}
