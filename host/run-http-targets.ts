import { canonicalWorkspacePath, workspacePathKey } from "./workspace-paths";
import type { HostRunBinding, HostRunHandle } from "../src/integrations/harness/core/hostRun";

export type HostHttpRunSource = Readonly<{
  sessionId: string;
  cwd: string;
  auxiliary: boolean;
  control?: boolean;
  identity: object;
}>;
export type HostHttpSourceHint = Readonly<{
  baseUrl: string;
  directory: string;
  providerSessionId?: string;
}>;
export type HostHttpRequest = Readonly<{ url: string; method: string; body?: string }>;
export type HostHttpResponse = Readonly<{ status: number; body: string }>;
type Session = {
  id?: string;
  directory?: string;
  forkOwner?: object;
  owner?: object;
  transition?: Promise<void>;
  work: Set<Promise<void>>;
  errors: unknown[];
  state: "pending" | "observed" | "unknown";
};
type Origin = {
  url?: string;
  key?: string;
  kind?: "child" | "external-service";
  owner?: object;
  scope?: HostHttpRunSource;
  assertCurrent?: () => void;
  validate?: () => Promise<void>;
  closed: boolean;
  unknown: boolean;
  sessions: Map<string, Session>;
  resources: Set<Session>;
};
declare const originBrand: unique symbol;
export type HostHttpOrigin = Readonly<{ [originBrand]: true }>;
type Binding = {
  origin: Origin;
  run: HostRunHandle;
  scope: HostHttpRunSource;
  hint: HostHttpSourceHint;
  pinned?: Session;
};
export type HostHttpRequestReservation = Readonly<{
  assertCurrent: () => void;
  complete: (response: HostHttpResponse) => Promise<void>;
  fail: (error?: unknown) => void;
}>;

function originUrl(raw: string): string {
  const url = new URL(raw);
  if (
    url.protocol !== "http:" ||
    !["127.0.0.1", "localhost"].includes(url.hostname) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== "/"
  )
    throw new Error("An original loopback OpenCode origin is required.");
  return url.origin;
}
function sessionResponse(
  response: HostHttpResponse,
): { id: string; directory?: string } | undefined {
  if (response.status < 200 || response.status >= 300) return;
  let parsed: unknown;
  try {
    parsed = JSON.parse(response.body);
  } catch {
    return;
  }
  if (!parsed || typeof parsed !== "object") return;
  const outer = parsed as Record<string, unknown>;
  const value =
    outer.data && typeof outer.data === "object" ? (outer.data as Record<string, unknown>) : outer;
  if (typeof value.id !== "string" || !value.id) return;
  const location =
    value.location && typeof value.location === "object"
      ? (value.location as Record<string, unknown>)
      : undefined;
  const directory =
    typeof value.directory === "string"
      ? value.directory
      : typeof location?.directory === "string"
        ? location.directory
        : undefined;
  return { id: value.id, directory };
}

/** Original HTTP targets come only from actual backend child/CLI observations.
 * Caller URL/session fields are demands, never origin or directory evidence. */
export class HostRunHttpTargets {
  private readonly slots = new Set<Origin>();
  private readonly handles = new WeakMap<HostHttpOrigin, Origin>();
  private readonly current = new Map<string, Origin>();
  private readonly bindings = new WeakMap<HostRunBinding, Binding>();
  private readonly runBindings = new WeakMap<HostRunHandle, Set<HostRunBinding>>();
  constructor(
    private readonly capacity = 512,
    private readonly sessionCapacity = 512,
  ) {
    if (![capacity, sessionCapacity].every((value) => Number.isSafeInteger(value) && value > 0))
      throw new Error("Invalid Host HTTP target capacity.");
  }
  reserveOrigin(): HostHttpOrigin {
    if (this.slots.size >= this.capacity)
      throw new Error("Host HTTP origin capacity is full; original unknown targets were retained.");
    const handle = Object.freeze({}) as HostHttpOrigin;
    const origin: Origin = {
      closed: false,
      unknown: false,
      sessions: new Map(),
      resources: new Set(),
    };
    this.slots.add(origin);
    this.handles.set(handle, origin);
    return handle;
  }
  releaseUnused(handle: HostHttpOrigin): void {
    const origin = this.requireOrigin(handle);
    if (origin.url || origin.unknown)
      throw new Error("An observed or unknown HTTP origin cannot be discarded.");
    this.slots.delete(origin);
    origin.closed = true;
  }
  retainUnknown(handle: HostHttpOrigin): void {
    this.requireOrigin(handle).unknown = true;
  }
  publishChild(
    handle: HostHttpOrigin,
    raw: string,
    source: {
      owner: object;
      constructionId: string;
      scope: HostHttpRunSource;
      assertCurrent: () => void;
    },
  ): void {
    const record = this.requireOrigin(handle),
      url = originUrl(raw);
    if (record.url && record.url !== url)
      throw new Error("Original OpenCode child changed its reported origin.");
    source.assertCurrent();
    record.url = url;
    record.key = source.constructionId;
    record.kind = "child";
    record.owner = source.owner;
    record.scope = Object.freeze({ ...source.scope });
    record.assertCurrent = source.assertCurrent;
    this.current.set(url, record);
  }
  observeChildCompletion(handle: HostHttpOrigin, completion: Promise<void>): void {
    const record = this.requireOrigin(handle);
    void completion.then(
      () => {
        record.closed = true;
        if (record.url && this.current.get(record.url) === record) this.current.delete(record.url);
        this.slots.delete(record);
      },
      () => {
        record.unknown = true;
      },
    );
  }
  publishService(
    handle: HostHttpOrigin,
    raw: string,
    source: { key: string; owner: object; validate: () => Promise<void> },
  ): void {
    const record = this.requireOrigin(handle),
      url = originUrl(raw),
      existing = this.current.get(url);
    if (existing?.kind === "external-service" && existing.key === source.key && !existing.closed) {
      // Same actual validated CLI configuration; never replace the original
      // captured validator or pretend this establishes a daemon kernel birth.
      this.slots.delete(record);
      record.closed = true;
      return;
    }
    record.url = url;
    record.key = source.key;
    record.kind = "external-service";
    record.owner = source.owner;
    record.validate = source.validate;
    this.current.set(url, record);
  }
  capture(raw: string): HostHttpOrigin {
    const record = this.current.get(originUrl(raw));
    if (!record) throw new Error("OpenCode HTTP origin has no original backend source.");
    this.assertOrigin(record);
    const handle = Object.freeze({}) as HostHttpOrigin;
    this.handles.set(handle, record);
    return handle;
  }
  async bind(
    capture: HostHttpOrigin,
    run: HostRunHandle,
    scope: HostHttpRunSource,
    hint: HostHttpSourceHint,
  ): Promise<HostRunBinding> {
    const origin = this.requireOrigin(capture);
    this.assertScope(origin, scope);
    if (origin.url !== originUrl(hint.baseUrl))
      throw new Error("Original HTTP source changed before binding.");
    let records = this.runBindings.get(run);
    if (!records) {
      records = new Set();
      this.runBindings.set(run, records);
    }
    if (records.size >= this.sessionCapacity)
      throw new Error("Original Host HTTP binding capacity is full.");
    const handle = Object.freeze({}) as HostRunBinding;
    const binding: Binding = {
      origin,
      run,
      scope: Object.freeze({ ...scope }),
      hint: Object.freeze({ ...hint }),
      pinned: hint.providerSessionId ? origin.sessions.get(hint.providerSessionId) : undefined,
    };
    this.bindings.set(handle, binding);
    records.add(handle);
    if (scope.control) {
      if (!binding.pinned?.directory || binding.pinned.owner !== scope.identity)
        throw new Error("Cleanup has no privately owned original OpenCode session.");
    } else if (binding.pinned?.directory) await this.claim(binding.pinned, scope.identity);
    this.assertScope(origin, scope);
    return handle;
  }
  assertBound(handle: HostRunBinding, run: HostRunHandle, scope: HostHttpRunSource): void {
    const binding = this.bindings.get(handle);
    if (
      !binding ||
      binding.run !== run ||
      binding.scope.identity !== scope.identity ||
      binding.scope.control !== scope.control
    )
      throw new Error("An original Host HTTP binding is required.");
    this.assertScope(binding.origin, scope);
  }
  async prepare(
    bindingHandle: HostRunBinding,
    run: HostRunHandle,
    scope: HostHttpRunSource,
    hint: HostHttpSourceHint,
    request: HostHttpRequest,
    verify: (url: string) => Promise<HostHttpResponse>,
    assertRun: () => void,
    uncertain: (error: unknown) => void,
  ): Promise<HostHttpRequestReservation> {
    const binding = this.bindings.get(bindingHandle);
    if (!binding || binding.run !== run)
      throw new Error("An original Host HTTP binding is required.");
    const origin = binding.origin;
    this.assertScope(origin, scope);
    if (
      scope.sessionId !== binding.scope.sessionId ||
      scope.auxiliary !== binding.scope.auxiliary ||
      workspacePathKey(scope.cwd) !== workspacePathKey(binding.scope.cwd) ||
      originUrl(hint.baseUrl) !== origin.url ||
      hint.directory !== binding.hint.directory ||
      hint.providerSessionId !== binding.hint.providerSessionId
    )
      throw new Error("Host HTTP request does not match its captured source.");
    const url = new URL(request.url);
    if (url.origin !== origin.url || url.username || url.password || url.hash)
      throw new Error("Host HTTP request changed its original origin.");
    const directory = url.searchParams.getAll("directory");
    if (
      directory.length !== 1 ||
      workspacePathKey(await canonicalWorkspacePath(directory[0])) !== workspacePathKey(scope.cwd)
    )
      throw new Error("Host HTTP request directory differs from the original execution directory.");
    if (
      workspacePathKey(await canonicalWorkspacePath(hint.directory)) !== workspacePathKey(scope.cwd)
    )
      throw new Error("Host HTTP source directory differs from the original execution directory.");
    await origin.validate?.();
    assertRun();
    this.assertScope(origin, scope);
    const path = url.pathname.replace(/^\/api(?=\/)/, "");
    const match = /^\/session(?:\/([^/]+))?(?:\/(.*))?$/.exec(path);
    if (!match) throw new Error("This Host HTTP operation has no qualified session target.");
    const id = match[1] ? decodeURIComponent(match[1]) : undefined,
      action = match[2] ?? "";
    if (hint.providerSessionId && id !== hint.providerSessionId)
      throw new Error("Host HTTP provider session differs from the original view.");
    const method = request.method.toUpperCase(),
      read = method === "GET" || method === "HEAD";
    const create = method === "POST" && (!id || action === "fork");
    let original = id ? origin.sessions.get(id) : undefined;
    if (
      scope.control &&
      (!id ||
        !hint.providerSessionId ||
        !original?.directory ||
        original.owner !== scope.identity ||
        !((method === "POST" && action === "abort") || (method === "DELETE" && action === "")))
    )
      throw new Error("Cleanup may only abort/delete its known original OpenCode session.");
    if (id && (!original?.directory || original.state !== "observed") && !(read && action === "")) {
      original ??= this.reserveSession(origin, id);
      const response = await verify(this.sessionUrl(url, id));
      await this.observe(origin, original, response, id);
      assertRun();
      this.assertScope(origin, scope);
      if (original.state !== "observed")
        throw new Error("Original OpenCode session directory could not be verified.");
    }
    if (binding.pinned && original && original !== binding.pinned)
      throw new Error("Original OpenCode session record changed.");
    if (id && !read && action !== "fork") {
      const ownedMove = action === "move" && original?.forkOwner === scope.identity;
      const ownedCleanup = scope.control && original?.forkOwner === scope.identity;
      if (
        !original?.directory ||
        (!ownedMove &&
          !ownedCleanup &&
          workspacePathKey(original.directory) !== workspacePathKey(scope.cwd))
      )
        throw new Error("OpenCode mutation has no original execution-directory proof.");
    }
    if (method === "POST" && (!id || action === "move")) {
      let body: unknown;
      try {
        body = request.body ? JSON.parse(request.body) : {};
      } catch {
        throw new Error("Invalid scoped OpenCode request body.");
      }
      if (!body || typeof body !== "object")
        throw new Error("Invalid scoped OpenCode request body.");
      const record = body as Record<string, unknown>,
        location = record.location as Record<string, unknown> | undefined;
      const target = action === "move" ? record.directory : location?.directory;
      if (
        typeof target === "string" &&
        workspacePathKey(await canonicalWorkspacePath(target)) !== workspacePathKey(scope.cwd)
      )
        throw new Error("OpenCode request body changes the original execution directory.");
      if (action === "move" && typeof target !== "string")
        throw new Error("A scoped OpenCode move requires its actual directory.");
    }
    const created = create ? this.reserveSession(origin) : undefined;
    const observed =
      read && id && action === "" ? (original ?? this.reserveSession(origin, id)) : undefined;
    if (created) created.owner = scope.identity;
    if (original && !read && !scope.control) await this.claim(original, scope.identity);
    const targetWork = created ?? original ?? observed;
    if (targetWork && targetWork.work.size >= this.sessionCapacity)
      throw new Error("Original OpenCode target work capacity is full.");
    let resolve!: () => void, reject!: (error: unknown) => void;
    const terminal = new Promise<void>((done, fail) => {
      resolve = done;
      reject = fail;
    });
    targetWork?.work.add(terminal);
    void terminal.then(
      () => {
        targetWork?.work.delete(terminal);
      },
      (error: unknown) => {
        targetWork?.work.delete(terminal);
        targetWork?.errors.push(error);
      },
    );
    let completed = false;
    const current = () => {
      assertRun();
      this.assertScope(origin, scope);
      if (!read && targetWork?.owner !== scope.identity)
        throw new Error("Original OpenCode target ownership changed.");
    };
    const fail = (error: unknown = new Error("Original OpenCode request outcome is unknown.")) => {
      if (completed) return;
      completed = true;
      if (created) created.state = "unknown";
      if (observed && !observed.directory) observed.state = "unknown";
      reject(error);
    };
    return Object.freeze({
      assertCurrent: current,
      fail,
      complete: async (response) => {
        if (completed) throw new Error("Original Host HTTP response was already consumed.");
        try {
          const target = created ?? observed ?? (action === "move" ? original : undefined);
          if (response.status < 200 || response.status >= 300) {
            let knownEmpty = false;
            try {
              const body = JSON.parse(response.body) as { kind?: string; data?: { kind?: string } };
              knownEmpty =
                action === "fork" &&
                response.status === 400 &&
                (body.kind ?? body.data?.kind) === "empty_session";
            } catch {
              /* ordinary provider error */
            }
            if (created && (knownEmpty || response.status === 404))
              origin.resources.delete(created);
            else if (created || (!read && response.status >= 500)) {
              if (target) target.state = "unknown";
              const error = new Error(
                `Original OpenCode operation returned an uncertain HTTP ${response.status}.`,
              );
              targetWork?.errors.push(error);
              uncertain(error);
            }
            completed = true;
            resolve();
            return;
          }
          if (!target) {
            completed = true;
            resolve();
            return;
          }
          const parsed = sessionResponse(response);
          const actualId = parsed?.id ?? (action === "move" ? id : undefined);
          if (!actualId) {
            target.state = "unknown";
            throw new Error("OpenCode did not return original session identity proof.");
          }
          if (created) {
            const existing = origin.sessions.get(actualId);
            if (existing && existing !== target)
              throw new Error("OpenCode reused another original session identity.");
            target.id = actualId;
            origin.sessions.set(actualId, target);
            if (action === "fork") target.forkOwner = scope.identity;
          }
          let proof = response;
          if (!parsed?.directory) proof = await verify(this.sessionUrl(url, actualId));
          await this.observe(origin, target, proof, actualId);
          assertRun();
          this.assertScope(origin, scope);
          if (created && action === "fork") target.forkOwner = scope.identity;
          if (!target.directory || target.state !== "observed")
            throw new Error("OpenCode did not return actual session directory proof.");
          if (
            created &&
            action !== "fork" &&
            workspacePathKey(target.directory) !== workspacePathKey(scope.cwd)
          )
            throw new Error("Created OpenCode session has a different actual directory.");
          if (
            action === "move" &&
            workspacePathKey(target.directory) !== workspacePathKey(scope.cwd)
          )
            throw new Error("OpenCode move did not reach the original execution directory.");
          if (binding.hint.providerSessionId === target.id) binding.pinned ??= target;
          completed = true;
          resolve();
        } catch (error) {
          fail(error);
          throw error;
        }
      },
    });
  }
  private reserveSession(origin: Origin, id?: string): Session {
    if (origin.resources.size >= this.sessionCapacity)
      throw new Error(
        "OpenCode original session capacity is full; unknown creations were retained.",
      );
    const record: Session = { id, state: "pending", work: new Set(), errors: [] };
    origin.resources.add(record);
    if (id) origin.sessions.set(id, record);
    return record;
  }
  private claim(session: Session, owner: object): Promise<void> {
    if (session.owner === owner) return session.transition ?? Promise.resolve();
    const originalWork = [...session.work];
    session.owner = owner;
    session.transition = Promise.allSettled(originalWork).then(() => {
      if (session.errors.length)
        throw new AggregateError(
          [...session.errors],
          "Original OpenCode target work is not verified.",
        );
    });
    void session.transition.catch(() => {});
    return session.transition;
  }
  private async observe(
    origin: Origin,
    record: Session,
    response: HostHttpResponse,
    id: string,
  ): Promise<void> {
    const proof = sessionResponse(response);
    if (!proof || proof.id !== id || !proof.directory) {
      record.state = "unknown";
      return;
    }
    const canonical = await canonicalWorkspacePath(proof.directory);
    this.assertOrigin(origin);
    const existing = origin.sessions.get(id);
    if (existing && existing !== record)
      throw new Error("OpenCode reused another original session identity.");
    record.id = id;
    record.directory = canonical;
    record.state = "observed";
    origin.sessions.set(id, record);
  }
  private sessionUrl(request: URL, id: string): string {
    const url = new URL(request.origin);
    url.pathname = `${request.pathname.startsWith("/api/") ? "/api" : ""}/session/${encodeURIComponent(id)}`;
    url.search = request.search;
    return url.href;
  }
  private assertScope(origin: Origin, scope: HostHttpRunSource): void {
    this.assertOrigin(origin);
    if (
      origin.kind === "child" &&
      (!origin.scope ||
        origin.scope.sessionId !== scope.sessionId ||
        origin.scope.auxiliary !== scope.auxiliary ||
        (!scope.auxiliary && workspacePathKey(origin.scope.cwd) !== workspacePathKey(scope.cwd)))
    )
      throw new Error("OpenCode child origin belongs to another original logical source.");
  }
  private assertOrigin(origin: Origin): void {
    if (origin.closed || !origin.url)
      throw new Error("Original OpenCode HTTP origin is closed or unobserved.");
    origin.assertCurrent?.();
  }
  private requireOrigin(handle: HostHttpOrigin): Origin {
    const record = this.handles.get(handle);
    if (!record) throw new Error("An original backend HTTP origin is required.");
    return record;
  }
}
