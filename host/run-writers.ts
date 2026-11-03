import { stat } from "node:fs/promises";
import type { HostRunBinding, HostRunHandle } from "../src/integrations/harness/core/hostRun";
import type { ProviderChild } from "./provider-child";
import { canonicalWorkspacePath, workspacePathKey } from "./workspace-paths";

function isBrokenPipe(error: unknown): boolean {
  const code = (error as { code?: unknown } | undefined)?.code;
  return (
    code === "EPIPE" || code === "ERR_STREAM_DESTROYED" || code === "ERR_STREAM_WRITE_AFTER_END"
  );
}

export type HostRunSource = Readonly<{
  owner: object;
  sessionId: string;
  runId: string;
  authorityGeneration?: number;
  isCurrent: () => boolean;
  validateAuthority?: () => Promise<void>;
  auxiliary?: boolean;
}>;
export type HostRunProcessSource = Readonly<{
  sessionId: string;
  constructionId: string;
  /** Canonical cwd actually supplied to the original provider construction. */
  cwd: string;
  assertCurrent?: () => void;
  provider?: string;
}>;
declare const cwdGrantBrand: unique symbol;
export type HostRunCwdGrant = Readonly<{ [cwdGrantBrand]: true }>;
type CwdGrant = {
  cwd: string;
  logicalSessionId: string;
  role: "text-sandbox" | "antigravity-launcher";
};
declare const processReservationBrand: unique symbol;
export type HostRunProcessReservation = Readonly<{
  cwd: string;
  [processReservationBrand]: true;
}>;
type Run = {
  handle: HostRunHandle;
  identity: object;
  source: HostRunSource | undefined;
  sessionId: string;
  accepting: boolean;
  controlAccepting: boolean;
  control?: HostRunHandle;
  finished: boolean;
  cwd?: string;
  work: Set<Promise<unknown>>;
  errors: unknown[];
  sources: Set<Preparation>;
  bindings: Map<ProviderChild, Binding[]>;
  finish?: Promise<void>;
};
type Preparation = {
  run: Run;
  sessionId: string;
  cwd?: string;
  grant?: CwdGrant;
  provider?: string;
  attached?: ProviderChild;
  started?: boolean;
  completed: boolean;
  resolve: () => void;
  reject: (error: unknown) => void;
};
type ProcessSource = {
  child: ProviderChild;
  sessionId: string;
  constructionId: string;
  logicalSessionId: string;
  cwd: string;
  logicalCwd: string;
  auxiliary: boolean;
  grant?: CwdGrant;
  provider?: string;
  binding?: Binding;
  ownerRun?: Run;
  errors: unknown[];
};
type Binding = {
  run: Run;
  process: ProcessSource;
  handle: HostRunBinding;
  accepting: boolean;
  control: boolean;
  scopeHandle: HostRunHandle;
  ready: Promise<HostRunBinding>;
  work: Set<Promise<unknown>>;
  errors: unknown[];
};

/** In-process Host issuer. Correlation IDs and object-shaped copies cannot
 * recreate any handle, process association or binding in these private maps. */
export class HostRunWriters {
  private readonly runs = new WeakMap<HostRunHandle, Run>();
  private readonly owners = new WeakSet<object>();
  private readonly retained = new Set<Run>();
  private readonly processes = new WeakMap<ProviderChild, ProcessSource>();
  private readonly preparations = new WeakMap<HostRunProcessReservation, Preparation>();
  private readonly bindings = new WeakMap<HostRunBinding, Binding>();
  private readonly cwdGrants = new WeakMap<HostRunCwdGrant, CwdGrant>();
  private readonly controls = new WeakSet<HostRunHandle>();
  private readonly maxRuns: number;
  private readonly maxBindings: number;
  private readonly maxWork: number;
  private draining = false;
  private sealed = false;
  private drainPromise?: Promise<void>;

  constructor(
    options: { maxRuns?: number; maxBindingsPerRun?: number; maxPendingWork?: number } = {},
  ) {
    this.maxRuns = options.maxRuns ?? 512;
    this.maxBindings = options.maxBindingsPerRun ?? 512;
    this.maxWork = options.maxPendingWork ?? 4096;
    for (const capacity of [this.maxRuns, this.maxBindings, this.maxWork])
      if (!Number.isSafeInteger(capacity) || capacity < 1)
        throw new Error("Invalid Host run writer capacity.");
  }

  reserve(source: HostRunSource): HostRunHandle {
    if (this.draining || this.sealed) throw new Error("Host run writer authority is stopping.");
    if (
      !source.owner ||
      typeof source.owner !== "object" ||
      !source.sessionId ||
      !source.runId ||
      (source.authorityGeneration !== undefined &&
        (!Number.isSafeInteger(source.authorityGeneration) || source.authorityGeneration < 0)) ||
      typeof source.isCurrent !== "function" ||
      (source.validateAuthority !== undefined && typeof source.validateAuthority !== "function")
    )
      throw new Error("An original Host run source is required.");
    if (this.owners.has(source.owner)) throw new Error("This Host run owner was already reserved.");
    if (this.retained.size >= this.maxRuns)
      throw new Error("Host run writer capacity is full; unresolved original work was retained.");
    // Reservation deliberately precedes Engine publication. It grants no effect.
    const handle = Object.freeze({}) as HostRunHandle;
    const run: Run = {
      handle,
      identity: Object.freeze({}),
      source: Object.freeze({ ...source }),
      sessionId: source.sessionId,
      accepting: true,
      controlAccepting: true,
      finished: false,
      work: new Set(),
      errors: [],
      sources: new Set(),
      bindings: new Map(),
    };
    this.runs.set(handle, run);
    this.owners.add(source.owner);
    this.retained.add(run);
    return handle;
  }

  controlRun(handle: HostRunHandle): HostRunHandle {
    const run = this.requireRun(handle);
    if (run.control) return run.control;
    if (this.sealed || !run.accepting || run.finished)
      throw new Error("Original Host cleanup issuance is closed.");
    const control = Object.freeze({}) as HostRunHandle;
    run.control = control;
    this.controls.add(control);
    this.runs.set(control, run);
    return control;
  }

  closeAdmission(handle: HostRunHandle): void {
    const run = this.requireRun(handle);
    run.accepting = false;
    for (const group of run.bindings.values())
      for (const binding of group) if (!binding.control) binding.accepting = false;
  }

  seal(): void {
    this.sealed = true;
    for (const run of this.retained) this.closeAdmission(run.handle);
  }

  setExecutionCwd(handle: HostRunHandle, cwd: string): Promise<void> {
    this.assertNormal(handle);
    const run = this.requireRun(handle);
    this.assertAdmission(run);
    return this.track(run, async () => {
      const canonical = await this.canonicalDirectory(cwd);
      this.assertSource(run);
      if (run.cwd && workspacePathKey(run.cwd) !== workspacePathKey(canonical))
        throw new Error("The original Host run execution directory cannot change.");
      run.cwd ??= canonical;
    });
  }

  async prepareProcess(
    handle: HostRunHandle,
    source: { sessionId: string; cwd: string; provider?: string; cwdGrant?: HostRunCwdGrant },
  ): Promise<HostRunProcessReservation> {
    this.assertNormal(handle);
    const run = this.requireRun(handle);
    this.assertAdmission(run);
    if (!run.cwd || !source.sessionId)
      throw new Error("Host execution directory/source is not ready.");
    if (run.sources.size >= this.maxBindings)
      throw new Error("Host run process reservation capacity is full.");
    this.assertWorkCapacity(run);
    let resolve!: () => void, reject!: (error: unknown) => void;
    const terminal = new Promise<void>((done, fail) => {
      resolve = done;
      reject = fail;
    });
    const preparation: Preparation = {
      run,
      sessionId: source.sessionId,
      completed: false,
      resolve,
      reject,
    };
    run.sources.add(preparation);
    // The backend ends this obligation only from its actual start finally,
    // including any accepted original-child cleanup, never from a deadline.
    const charged = this.track(
      run,
      () => terminal,
      undefined,
      handle,
      () => preparation.started === true,
    );
    void charged.catch(() => {});
    try {
      const canonical = await this.canonicalDirectory(source.cwd);
      await this.authority(run);
      this.assertAdmission(run);
      const grant = source.cwdGrant && this.cwdGrants.get(source.cwdGrant);
      if (source.cwdGrant && !grant) throw new Error("An original Host cwd grant is required.");
      if (grant && (source.provider !== "antigravity" || !this.grantMatches(run, grant, canonical)))
        throw new Error("Host launcher/sandbox source grant does not match.");
      if (!grant && workspacePathKey(canonical) !== workspacePathKey(run.cwd))
        throw new Error(
          "Provider construction does not match the original Host execution directory.",
        );
      preparation.cwd = canonical;
      preparation.grant = grant;
      preparation.provider = source.provider;
      const token = Object.freeze({ cwd: canonical }) as HostRunProcessReservation;
      this.preparations.set(token, preparation);
      return token;
    } catch (error) {
      this.completePreparation(preparation, error, true);
      throw error;
    }
  }

  assertPreparedProcess(token: HostRunProcessReservation): void {
    const preparation = this.requirePreparation(token);
    if (preparation.completed)
      throw new Error("Original Host process preparation is no longer available.");
    this.assertAdmission(preparation.run);
  }

  async validatePreparedProcess(token: HostRunProcessReservation): Promise<void> {
    const preparation = this.requirePreparation(token);
    this.assertPreparedProcess(token);
    await this.authority(preparation.run);
    this.assertPreparedProcess(token);
  }

  attachProcess(
    handle: HostRunHandle,
    child: ProviderChild,
    source: HostRunProcessSource,
    token: HostRunProcessReservation,
  ): void {
    const run = this.requireRun(handle),
      preparation = this.requirePreparation(token);
    preparation.started = true;
    this.assertPreparedProcess(token);
    if (
      preparation.attached ||
      preparation.run !== run ||
      preparation.sessionId !== source.sessionId ||
      !source.constructionId ||
      preparation.cwd !== source.cwd ||
      this.processes.has(child)
    )
      throw new Error("Provider construction does not match its original Host reservation.");
    preparation.attached = child;
    this.processes.set(child, {
      child,
      sessionId: source.sessionId,
      constructionId: source.constructionId,
      logicalSessionId: run.sessionId,
      cwd: source.cwd,
      logicalCwd: run.cwd!,
      auxiliary: run.source?.auxiliary === true,
      grant: preparation.grant,
      provider: preparation.provider,
      ownerRun: run,
      errors: [],
    });
  }

  completeProcess(token: HostRunProcessReservation, error?: unknown): void {
    this.completePreparation(this.requirePreparation(token), error, arguments.length > 1);
  }

  /** Trusted backend-only grant after actual sandbox creation/AG resolution. */
  grantCwd(handle: HostRunHandle, cwd: string, role: CwdGrant["role"]): Promise<HostRunCwdGrant> {
    this.assertNormal(handle);
    const run = this.requireRun(handle);
    this.assertAdmission(run);
    if (role === "text-sandbox" && run.source?.auxiliary !== true)
      throw new Error("Only an original auxiliary Host scope may own a text sandbox.");
    return this.track(run, async () => {
      const canonical = await this.canonicalDirectory(cwd);
      await this.authority(run);
      this.assertAdmission(run);
      const token = Object.freeze({}) as HostRunCwdGrant;
      this.cwdGrants.set(token, { cwd: canonical, logicalSessionId: run.sessionId, role });
      return token;
    });
  }

  runWork<Result>(
    handle: HostRunHandle,
    effect: () => Promise<Result>,
    options: { cwd?: string; effectful?: boolean } = {},
  ): Promise<Result> {
    const run = this.requireRun(handle);
    this.assertAdmission(run, handle);
    const cwd = options.cwd;
    let started = false;
    return this.track(
      run,
      async () => {
        if (cwd !== undefined) {
          const canonical = await this.canonicalDirectory(cwd);
          if (!run.cwd || workspacePathKey(canonical) !== workspacePathKey(run.cwd))
            throw new Error("Host work does not match the original execution directory.");
        }
        await this.authority(run);
        this.assertAdmission(run, handle);
        const work = effect();
        started = options.effectful !== false;
        return work;
      },
      undefined,
      handle,
      () => started,
    );
  }

  executionSource(handle: HostRunHandle): Readonly<{
    sessionId: string;
    cwd: string;
    auxiliary: boolean;
    control: boolean;
    identity: object;
  }> {
    const run = this.requireRun(handle);
    this.assertSource(run);
    if (!run.cwd) throw new Error("Original Host execution directory is not ready.");
    return Object.freeze({
      sessionId: run.sessionId,
      cwd: run.cwd,
      auxiliary: run.source!.auxiliary === true,
      control: this.controls.has(handle),
      identity: run.identity,
    });
  }

  assertControlWrite(handle: HostRunBinding, line: string): void {
    const binding = this.bindings.get(handle);
    if (!binding) throw new Error("An original Host run binding is required.");
    if (!binding.control) return;
    let frame: unknown;
    try {
      frame = JSON.parse(line);
    } catch {
      throw new Error("Cleanup cannot dispatch a new provider prompt.");
    }
    if (!frame || typeof frame !== "object") throw new Error("Invalid original cleanup operation.");
    const value = frame as Record<string, unknown>;
    const request =
      value.request && typeof value.request === "object"
        ? (value.request as Record<string, unknown>)
        : undefined;
    const allowed =
      typeof value.method === "string"
        ? value.type === undefined &&
          ["turn/interrupt", "session/cancel", "$/cancelRequest", "shutdown", "exit"].includes(
            value.method,
          )
        : value.method === undefined &&
          (value.type === "abort"
            ? Object.keys(value).every((key) => ["type", "id"].includes(key))
            : value.type === "control_request" &&
              ["interrupt", "stop_task"].includes(String(request?.subtype)));
    if (!allowed) throw new Error("Cleanup capability cannot start a new provider operation.");
  }

  retainFailure(handle: HostRunHandle, error: unknown): void {
    const run = this.requireRun(handle);
    run.errors.push(error);
    run.accepting = false;
    if (this.controls.has(handle)) run.controlAccepting = false;
  }

  assertOpen(handle: HostRunHandle): void {
    this.assertAdmission(this.requireRun(handle), handle);
  }

  bind(
    handle: HostRunHandle,
    child: ProviderChild,
    source: HostRunProcessSource,
  ): Promise<HostRunBinding> {
    source = Object.freeze({ ...source });
    const run = this.requireRun(handle);
    this.assertAdmission(run, handle);
    const control = this.controls.has(handle);
    const process = this.requireProcess(run, child, source);
    if (process.errors.length && !control)
      throw new AggregateError(
        [...process.errors],
        "Original Host process write outcome is not verified.",
      );
    const group = run.bindings.get(child) ?? [];
    const existing = group.find((binding) => binding.control === control);
    if (existing) return existing.ready;
    if (!group.length && run.bindings.size >= this.maxBindings)
      throw new Error("Host run binding capacity is full.");
    this.assertWorkCapacity(run);
    if (control && process.ownerRun !== run)
      throw new Error("Cleanup cannot claim another original Host run's process.");
    const binding: Binding = {
      run,
      process,
      handle: Object.freeze({}) as HostRunBinding,
      accepting: false,
      control,
      scopeHandle: handle,
      ready: undefined!,
      work: new Set(),
      errors: [],
    };
    run.bindings.set(child, [...group, binding]);
    this.bindings.set(binding.handle, binding);
    binding.ready = this.track(
      run,
      async () => {
        await this.authority(run);
        this.assertAdmission(run, handle);
        this.requireProcess(run, child, source);
        source.assertCurrent?.();
        const predecessor = process.binding;
        if (process.ownerRun !== run) {
          if (control) throw new Error("Cleanup cannot claim a replacement Host process.");
          const originals = predecessor?.run.bindings.get(child) ?? [];
          for (const original of originals) original.accepting = false;
          process.ownerRun = run;
          process.binding = binding;
          const drained = await Promise.allSettled(
            originals.map((original) => this.drainBinding(original)),
          );
          const errors = drained.flatMap((result) =>
            result.status === "rejected" ? [result.reason] : [],
          );
          if (errors.length)
            throw new AggregateError(errors, "Original Host binding work is not verified.");
        } else if (!predecessor) process.binding = binding;
        else if (predecessor !== binding) await predecessor.ready;
        await this.authority(run);
        this.assertAdmission(run, handle);
        this.requireProcess(run, child, source);
        source.assertCurrent?.();
        if (process.ownerRun !== run) throw new Error("The original Host binding was replaced.");
        binding.accepting = true;
        return binding.handle;
      },
      undefined,
      handle,
    );
    return binding.ready;
  }

  write(
    handle: HostRunBinding,
    child: ProviderChild,
    source: HostRunProcessSource,
    perform: () => Promise<void>,
  ): Promise<void> {
    source = Object.freeze({ ...source });
    const binding = this.bindings.get(handle);
    if (!binding) throw new Error("An original Host run binding is required.");
    this.assertAdmission(binding.run, binding.scopeHandle);
    this.requireProcess(binding.run, child, source);
    if (
      binding.process.child !== child ||
      binding.process.ownerRun !== binding.run ||
      !binding.accepting
    )
      throw new Error("Host run write admission is closed or belongs to another process.");
    source.assertCurrent?.();
    let started = false;
    return this.track(
      binding.run,
      async () => {
        await this.authority(binding.run);
        this.requireProcess(binding.run, child, source);
        this.assertAdmission(binding.run, binding.scopeHandle);
        if (!binding.accepting || binding.process.ownerRun !== binding.run)
          throw new Error("Original Host write admission changed before dispatch.");
        source.assertCurrent?.();
        // No await from final original-source refusal checks to actual stdin work.
        const actual = perform();
        started = true;
        await actual;
      },
      binding,
      binding.scopeHandle,
      () => started,
    );
  }

  finish(handle: HostRunHandle): Promise<void> {
    const run = this.requireRun(handle);
    if (run.finish) return run.finish;
    run.accepting = false;
    run.controlAccepting = false;
    for (const group of run.bindings.values())
      for (const binding of group) binding.accepting = false;
    const finishing = (async () => {
      while (run.work.size) await Promise.allSettled(run.work);
      if (run.errors.length)
        throw new AggregateError(
          // Reported once; the same failure must not poison every later finish.
          run.errors.splice(0),
          "Original Host run work did not settle successfully.",
        );
      run.finished = true;
      this.retained.delete(run);
      run.source = undefined;
      run.sources.clear();
      run.bindings.clear();
    })();
    run.finish = finishing;
    void finishing.catch(() => {
      if (run.finish === finishing) run.finish = undefined;
    });
    return finishing;
  }

  drain(): Promise<void> {
    if (this.drainPromise) return this.drainPromise;
    this.draining = true;
    this.seal();
    const originals = [...this.retained];
    this.drainPromise = Promise.allSettled(originals.map((run) => this.finish(run.handle))).then(
      (outcomes) => {
        const errors = outcomes.flatMap((outcome) =>
          outcome.status === "rejected" ? [outcome.reason] : [],
        );
        if (errors.length)
          throw new AggregateError(errors, "Original Host runs did not drain successfully.");
      },
    );
    void this.drainPromise.catch(() => {});
    return this.drainPromise;
  }

  private track<Result>(
    run: Run,
    operation: () => Promise<Result>,
    binding?: Binding,
    scopeHandle = run.handle,
    effectful: () => boolean = () => false,
  ): Promise<Result> {
    this.assertWorkCapacity(run);
    let resolve!: (result: Result | PromiseLike<Result>) => void, reject!: (error: unknown) => void;
    const work = new Promise<Result>((done, fail) => {
      resolve = done;
      reject = fail;
    });
    run.work.add(work);
    binding?.work.add(work);
    void work.then(
      () => {
        run.work.delete(work);
        binding?.work.delete(work);
      },
      (error: unknown) => {
        run.work.delete(work);
        binding?.work.delete(work);
        // A stdin EPIPE after admission closed (final event) is not a run error.
        const late = !run.accepting && isBrokenPipe(error);
        if (late) console.warn("Ignoring late provider stdin close after the run ended:", error);
        const started = effectful() && !late;
        if (started) run.errors.push(error);
        run.accepting = false;
        if (this.controls.has(scopeHandle)) run.controlAccepting = false;
        if (binding) {
          if (started) {
            binding.errors.push(error);
            binding.process.errors.push(error);
          }
          binding.accepting = false;
        }
      },
    );
    void Promise.resolve().then(operation).then(resolve, reject);
    return work;
  }

  private async drainBinding(binding: Binding): Promise<void> {
    const ready = await Promise.allSettled([binding.ready]);
    while (binding.work.size) await Promise.allSettled(binding.work);
    const errors = [
      ...binding.errors,
      ...(binding.process.errors.length
        ? ready.flatMap((result) => (result.status === "rejected" ? [result.reason] : []))
        : []),
    ];
    if (errors.length)
      throw new AggregateError(errors, "Original Host binding work is not verified.");
  }

  private async authority(run: Run): Promise<void> {
    this.assertSource(run);
    await run.source?.validateAuthority?.();
    this.assertSource(run);
  }
  private requireRun(handle: HostRunHandle): Run {
    const run = this.runs.get(handle);
    if (!run) throw new Error("An original Host run handle is required.");
    return run;
  }
  private assertSource(run: Run): void {
    if (!run.source || run.source.isCurrent() !== true)
      throw new Error("The original Host run source changed.");
  }
  private assertNormal(handle: HostRunHandle): void {
    if (this.controls.has(handle)) throw new Error("A cleanup scope cannot start new Host work.");
  }
  private assertWorkCapacity(run: Run): void {
    if (run.work.size >= this.maxWork)
      throw new Error("Original Host run pending-work capacity is full.");
  }
  private assertAdmission(run: Run, handle = run.handle): void {
    if (!(this.controls.has(handle) ? run.controlAccepting : run.accepting) || run.finished)
      throw new Error("Host run write admission is closed.");
    this.assertSource(run);
  }
  private requireProcess(
    run: Run,
    child: ProviderChild,
    source: HostRunProcessSource,
  ): ProcessSource {
    const process = this.processes.get(child);
    if (
      !process ||
      process.sessionId !== source.sessionId ||
      process.constructionId !== source.constructionId ||
      process.logicalSessionId !== run.sessionId ||
      !run.cwd ||
      process.auxiliary !== (run.source?.auxiliary === true) ||
      (!process.auxiliary && workspacePathKey(process.logicalCwd) !== workspacePathKey(run.cwd)) ||
      (process.grant
        ? process.provider !== "antigravity" || !this.grantMatches(run, process.grant, process.cwd)
        : workspacePathKey(process.cwd) !== workspacePathKey(run.cwd)) ||
      workspacePathKey(source.cwd) !== workspacePathKey(process.cwd)
    )
      throw new Error("Original Host run/process/directory binding does not match.");
    return process;
  }
  private grantMatches(run: Run, grant: CwdGrant, cwd: string): boolean {
    return (
      grant.logicalSessionId === run.sessionId &&
      workspacePathKey(grant.cwd) === workspacePathKey(cwd) &&
      (grant.role !== "text-sandbox" || run.source?.auxiliary === true)
    );
  }
  private requirePreparation(token: HostRunProcessReservation): Preparation {
    const preparation = this.preparations.get(token);
    if (!preparation) throw new Error("An original Host process reservation is required.");
    return preparation;
  }
  private completePreparation(preparation: Preparation, error?: unknown, failed = false): void {
    if (preparation.completed) return;
    preparation.completed = true;
    if (failed) preparation.reject(error);
    else preparation.resolve();
  }
  private async canonicalDirectory(cwd: string): Promise<string> {
    const canonical = await canonicalWorkspacePath(cwd);
    if (!(await stat(canonical)).isDirectory())
      throw new Error("Host execution cwd must be an existing directory.");
    return canonical;
  }
}
