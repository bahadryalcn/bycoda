/** Bounds cold `sessions.sync` reads (no known revision, or revision 0 after a channel reset)
 * per machine. After an app restart every session syncs from scratch at once, and each cold
 * read is real Host work; at most `COLD_SYNCS_PER_MACHINE` run together and the rest queue.
 * Warm syncs and the focused session never wait here. */
export const COLD_SYNCS_PER_MACHINE = 3;

type Waiter = { sessionId: string; start: () => void; fail: (error: Error) => void };
type MachineGate = {
  running: number;
  queue: Waiter[];
  focused: ReadonlySet<string>;
};

const gates = new Map<string, MachineGate>();

function gateFor(machineId: string): MachineGate {
  let gate = gates.get(machineId);
  if (!gate) gates.set(machineId, (gate = { running: 0, queue: [], focused: new Set() }));
  return gate;
}

function drain(gate: MachineGate): void {
  while (gate.running < COLD_SYNCS_PER_MACHINE && gate.queue.length) {
    // The focused session may have become focused while it waited: take it first.
    const index = Math.max(
      0,
      gate.queue.findIndex((waiter) => gate.focused.has(waiter.sessionId)),
    );
    const [waiter] = gate.queue.splice(index, 1);
    gate.running += 1;
    waiter.start();
  }
}

/** The sessions the user is looking at on this machine; their cold syncs skip the queue. */
export function setFocusedSyncSessions(machineId: string, sessionIds: Iterable<string>): void {
  const gate = gates.get(machineId);
  const next = new Set(sessionIds);
  if (!gate && !next.size) return;
  gateFor(machineId).focused = next;
}

/** True when the sync starts from nothing the Host can diff against. */
export function isColdSync(revision: number | undefined): boolean {
  return revision === undefined || revision === 0;
}

/** Runs `run` now when warm or focused, otherwise within the machine's cold-sync budget. */
export function runSessionSync<T>(
  machineId: string,
  sessionId: string,
  revision: number | undefined,
  run: () => Promise<T>,
  /** Running plus queued cold syncs allowed per machine; past it the sync is refused. */
  maxPending = Infinity,
  refuse: () => Error = () => new Error("Too many cold syncs are pending"),
): Promise<T> {
  const gate = gateFor(machineId);
  if (!isColdSync(revision) || gate.focused.has(sessionId)) return run();
  if (gate.running + gate.queue.length >= maxPending) return Promise.reject(refuse());
  return new Promise<T>((resolve, reject) => {
    const waiter: Waiter = {
      sessionId,
      start: () => {
        // A rejected or abandoned read frees its slot and lets the next one start.
        void run()
          .then(resolve, reject)
          .finally(() => {
            gate.running -= 1;
            drain(gate);
          });
      },
      fail: reject,
    };
    gate.queue.push(waiter);
    drain(gate);
  });
}

/** Rejects every queued cold sync of a machine (its channel closed); running ones settle alone. */
export function cancelQueuedSessionSyncs(machineId: string): void {
  const gate = gates.get(machineId);
  if (!gate) return;
  const queued = gate.queue.splice(0);
  for (const waiter of queued) waiter.fail(new Error("Session sync cancelled"));
  if (!gate.running) gates.delete(machineId);
}

export function resetSessionSyncGatesForTests(): void {
  gates.clear();
}
