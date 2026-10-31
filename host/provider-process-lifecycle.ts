import type { ProviderChild } from "./provider-child";

/** A healthy CLI can take many seconds to start reading stdin; only a stuck pipe is a failure. */
const PROVIDER_WRITE_TIMEOUT_MS = 90_000;

type OwnedProcess = {
  sessionId: string;
  closed: Promise<void>;
  didClose: boolean;
  callbacks: Set<Promise<void>>;
  retiring: boolean;
  retirement?: Promise<void>;
  retirementSettled: boolean;
  proof?: Promise<void>;
  proofState: "pending" | "verified" | "unknown";
};

/** Physical process completion is observed from close and actual stdin callbacks.
 * Timers and exit/error notifications cannot discharge either obligation. */
export class ProviderProcessLifecycle {
  private readonly processes = new Set<OwnedProcess>();
  private readonly byChild = new WeakMap<ProviderChild, OwnedProcess>();

  register(sessionId: string, child: ProviderChild, proof?: Promise<void>): void {
    if (this.byChild.has(child)) throw new Error("Provider process is already owned.");
    let closed!: () => void;
    const record: OwnedProcess = {
      sessionId,
      closed: new Promise<void>((resolve) => {
        closed = resolve;
      }),
      didClose: false,
      callbacks: new Set(),
      retiring: false,
      retirementSettled: false,
      proof,
      proofState: proof ? "pending" : "verified",
    };
    this.byChild.set(child, record);
    this.processes.add(record);
    void proof?.then(
      () => {
        record.proofState = "verified";
        this.release(record);
      },
      () => {
        record.proofState = "unknown";
      },
    );
    // Install this at actual construction, before the caller awaits spawn or
    // preparation. A later drain must also observe a close that already happened.
    child.once("close", () => {
      record.didClose = true;
      closed();
      this.release(record);
    });
    child.on("error", () => {
      // Spawn/write owners report errors. An error is not evidence of close.
    });
  }

  write(
    child: ProviderChild,
    frame: string,
    timeoutError: Error,
    onTimeout: () => Promise<void>,
  ): Promise<void> {
    const record = this.require(child);
    if (record.retiring || record.didClose)
      return Promise.reject(new Error("Provider process is retiring."));
    let finished!: () => void;
    const terminal = new Promise<void>((resolve) => {
      finished = resolve;
    });
    // This promise records that the real callback (or synchronous throw) happened;
    // its outcome is preserved separately and returned to the actual write caller.
    record.callbacks.add(terminal);
    let didFinish = false;
    let failure: unknown;
    let timedOut = false;
    let retirement: Promise<void> | undefined;
    const timer = setTimeout(() => {
      if (didFinish) return;
      timedOut = true;
      try {
        retirement = onTimeout();
      } catch (error) {
        retirement = Promise.reject(error);
      }
      // Observe now, but keep the original result for the drain below. This never
      // declares completion or replaces the callback/close evidence with a catch.
      void retirement.catch(() => {});
    }, PROVIDER_WRITE_TIMEOUT_MS);
    const done = (error?: Error | null) => {
      if (didFinish) return;
      didFinish = true;
      failure = error;
      clearTimeout(timer);
      record.callbacks.delete(terminal);
      finished();
      this.release(record);
    };
    try {
      child.stdin.write(frame, done);
    } catch (error) {
      // No callback was accepted when write throws synchronously. Retain that
      // failure while completing only this attempted callback obligation.
      done(error instanceof Error ? error : new Error(String(error)));
    }
    return (async () => {
      await terminal;
      if (timedOut) {
        let retirementFailure: unknown;
        try {
          await retirement;
        } catch (error) {
          retirementFailure = error;
        }
        await record.closed;
        const failures: unknown[] = [timeoutError];
        if (failure) failures.push(failure);
        if (retirementFailure !== undefined) failures.push(retirementFailure);
        if (failures.length > 1) throw new AggregateError(failures, timeoutError.message);
        throw timeoutError;
      }
      if (failure) throw failure;
    })();
  }

  retire(child: ProviderChild, stop: () => Promise<void>): Promise<void> {
    const record = this.require(child);
    if (record.retirement) return record.retirement;
    record.retiring = true;
    record.retirement = (async () => {
      let failure: unknown;
      try {
        if (!record.didClose) await stop();
      } catch (error) {
        failure = error;
      }
      // Even a failed OS request cannot make an unclosed child disappear from
      // ownership. The caller sees the failure only after physical work drains.
      await record.closed;
      await this.callbacks(record);
      await record.proof;
      if (failure !== undefined) throw failure;
    })();
    void record.retirement
      .finally(() => {
        record.retirementSettled = true;
        this.release(record);
      })
      .catch(() => {});
    return record.retirement;
  }

  drainSession(sessionId: string): Promise<void> {
    return this.drain((record) => record.sessionId === sessionId);
  }

  completion(child: ProviderChild): Promise<void> {
    const record = this.require(child);
    return (async () => {
      await record.closed;
      await this.callbacks(record);
      await record.retirement;
      await record.proof;
    })();
  }

  drainAll(): Promise<void> {
    return this.drain(() => true);
  }

  private require(child: ProviderChild): OwnedProcess {
    const record = this.byChild.get(child);
    if (!record) throw new Error("Provider process has no physical lifecycle owner.");
    return record;
  }

  private async callbacks(record: OwnedProcess): Promise<void> {
    while (record.callbacks.size) await Promise.all(record.callbacks);
  }

  private async drain(include: (record: OwnedProcess) => boolean): Promise<void> {
    const failures: unknown[] = [];
    while (true) {
      const records = [...this.processes].filter(include);
      if (!records.length) break;
      const outcomes = await Promise.allSettled(
        records.map(async (record) => {
          await record.closed;
          await this.callbacks(record);
          await record.retirement;
          await record.proof;
        }),
      );
      for (const outcome of outcomes)
        if (outcome.status === "rejected") failures.push(outcome.reason);
      // All selected records now have terminal physical facts, including failures.
      for (const record of records) this.release(record);
      if (failures.length) break;
    }
    if (failures.length)
      throw new AggregateError(failures, "Provider process work did not complete successfully.");
  }

  private release(record: OwnedProcess): void {
    if (
      record.didClose &&
      !record.callbacks.size &&
      record.proofState === "verified" &&
      (!record.retiring || record.retirementSettled)
    )
      this.processes.delete(record);
  }
}
