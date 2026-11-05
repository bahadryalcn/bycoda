import { nativeRun, type DesktopRunner } from "./desktop-control-runner";
export type { DesktopRunner } from "./desktop-control-runner";
import { DesktopStatusChanges } from "./desktop-status-changes";
import { AsyncLocalStorage } from "node:async_hooks";
import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, mkdtemp, readFile, realpath, rm, stat } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative } from "node:path";
import { z } from "zod";
import type { HostStore } from "../store";
import { desktopOperationAuditId, type DesktopOperationAudit } from "./desktop-control-audit";
import {
  AGENT_DESKTOP_PROTOCOL,
  AGENT_DESKTOP_UPSTREAM_REF,
  DesktopControlRequestValidationSchema,
  DesktopControlResponseSchema,
  isForbiddenDesktopShortcut,
  type DesktopControlConfiguration,
  type DesktopControlOperation,
  type DesktopControlRequest,
  type DesktopControlResponse,
} from "../../src/shared/model/host-contracts/desktop-control";
import { hasControlCharacters } from "../../src/shared/lib/controlCharacters";

export type DesktopControlPrincipal = { kind: "owner" | "assistant" | "chief"; id: string };
export interface DesktopControlPorts {
  run?: DesktopRunner;
  presence?(): Promise<{ locked: boolean; supported: boolean }>;
  authorize?(principal: DesktopControlPrincipal): Promise<boolean>;
  physicalGrant?(
    principal: DesktopControlPrincipal,
    input: { requestId: string; app: string; action: string; ref: string },
  ): Promise<boolean>;
  onChange?(): void;
  /** Internal metadata-only sink; never a tool action or an input authority. */
  onOperation?(event: DesktopOperationAudit): Promise<void>;
  now?(): number;
}
const envelopeSchema = z.object({
  version: z.literal(AGENT_DESKTOP_PROTOCOL),
  ok: z.boolean(),
  command: z.string(),
  data: z.union([z.record(z.string(), z.unknown()), z.array(z.unknown())]).optional(),
  error: z
    .object({
      code: z.string(),
      disposition: z.object({ delivery: z.string(), retry: z.string() }).optional(),
    })
    .optional(),
});
type Envelope = z.infer<typeof envelopeSchema>;
type Snapshot = {
  id: string;
  app: string;
  pid: number;
  windowId: string;
  refs: Set<string>;
  owner: string;
  configurationVersion: number;
  createdAt: number;
};
type Receipt = {
  fingerprint: string;
  operation: DesktopControlOperation;
  audits?: { event: DesktopOperationAudit; delivered: boolean }[];
  auditPending?: boolean;
  auditAttempts?: number;
};
const empty: DesktopControlConfiguration = {
  enabled: false,
  binaryPath: "",
  binarySha256: "",
  allowedApps: [],
  allowPhysicalInput: false,
  version: 0,
};

/** Optional CLI adapter. The binary is never installed or downloaded here.
 * Exact app observations mint short-lived ref grants. Only supported scoped
 * commands are constructed; output content is neither logged nor persisted. */
export class HostDesktopControl {
  readonly ready: Promise<void>;
  readonly statusChanges = new DesktopStatusChanges();
  private statusChanged() { this.statusChanges.changed(); this.ports.onChange?.(); }
  private tail: Promise<unknown> = Promise.resolve();
  private active?: AbortController;
  private currentAction?: { app: string; action: string };
  private halted = false;
  private stopGeneration = 0;
  private readonly requestAuthorities = new AsyncLocalStorage<() => boolean | Promise<boolean>>();
  private readonly physicalAuthorities = new AsyncLocalStorage<() => boolean | Promise<boolean>>();
  private readonly sensitiveAuthorities = new AsyncLocalStorage<() => boolean | Promise<boolean>>();
  private closing = false;
  private auditTimer?: ReturnType<typeof setTimeout>;
  private auditDraining?: Promise<boolean>;
  private readonly namespace = `bycoda-${randomUUID()}`;
  private readonly snapshots = new Map<string, Snapshot>();
  private helperState?: { path: string; parent: string; dev: number; ino: number };
  constructor(
    private readonly store: HostStore,
    private readonly ports: DesktopControlPorts = {},
  ) {
    this.ready = (async () => {
      await store.ready;
      await store.db.scope(() =>
        store.db
          .exec(`CREATE TABLE IF NOT EXISTS desktop_control_configuration(id INTEGER PRIMARY KEY CHECK(id=1),value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS desktop_control_receipts(id TEXT PRIMARY KEY,value TEXT NOT NULL);`),
      );
    })();
    void this.ready.then(() => this.scheduleAuditDrain()).catch(() => undefined);
  }
  private now() {
    return this.ports.now?.() ?? Date.now();
  }
  private owner(principal: DesktopControlPrincipal) {
    if (principal.kind !== "owner")
      throw new Error("Desktop settings require the owner's direct authority.");
  }
  async close() {
    this.closing = true;
    this.statusChanged();
    clearTimeout(this.auditTimer);
    this.auditTimer = undefined;
    this.halted = true;
    this.active?.abort();
    await this.tail;
    await this.auditDraining;
    this.snapshots.clear();
    await this.clearHelperState();
  }
  private async helperStateRoot() {
    if (!this.helperState) {
      const parent = join(dirname(this.store.attachmentDir), "desktop-control-helper");
      await mkdir(parent, { recursive: true, mode: 0o700 });
      const info = await lstat(parent);
      if (!info.isDirectory() || info.isSymbolicLink())
        throw new Error("Desktop helper state must be a private real directory.");
      const canonicalParent = await realpath(parent),
        path = await mkdtemp(join(canonicalParent, `${this.namespace}-`)),
        entry = await lstat(path);
      this.helperState = { path, parent: canonicalParent, dev: entry.dev, ino: entry.ino };
    }
    const owned = this.helperState,
      entry = await lstat(owned.path),
      actual = await realpath(owned.path),
      child = relative(owned.parent, actual);
    if (
      !entry.isDirectory() ||
      entry.isSymbolicLink() ||
      entry.dev !== owned.dev ||
      entry.ino !== owned.ino ||
      actual !== owned.path ||
      child !== basename(owned.path) ||
      !child.startsWith(`${this.namespace}-`)
    )
      throw new Error("The owned desktop helper cache changed.");
    return owned.path;
  }
  private async clearHelperState() {
    if (!this.helperState) return;
    try {
      const path = await this.helperStateRoot();
      await rm(path, { recursive: true, force: false });
    } catch (error) {
      if (!(error && typeof error === "object" && "code" in error && error.code === "ENOENT"))
        throw error;
    }
    this.helperState = undefined;
  }
  private scheduleAuditDrain(delay = 0) {
    if (this.closing || this.auditTimer || !this.ports.onOperation) return;
    this.auditTimer = this.store.db.outsideScope(() =>
      setTimeout(() => {
        this.auditTimer = undefined;
        void this.drainOperationAudits()
          .then((pending) => {
            if (pending) this.scheduleAuditDrain(60000);
          })
          .catch(() => this.scheduleAuditDrain(60000));
      }, delay),
    );
    this.auditTimer.unref?.();
  }
  /** Retry audit delivery only; this never replays an app effect. */
  drainOperationAudits(): Promise<boolean> {
    if (this.auditDraining) return this.auditDraining;
    const drain = this.store.db.outsideScope(async () => {
      await this.ready;
      if (!this.ports.onOperation) return false;
      const rows = await this.store.db
        .prepare(
          "SELECT id,value FROM desktop_control_receipts WHERE json_extract(value,'$.auditPending')=1 ORDER BY coalesce(json_extract(value,'$.auditAttempts'),0),rowid LIMIT 50",
        )
        .all();
      let pending = rows.length === 50;
      for (const row of rows) {
        const receipt = JSON.parse(row.value) as Receipt;
        for (const item of receipt.audits ?? [])
          if (!item.delivered) {
            try {
              await this.ports.onOperation(structuredClone(item.event));
              await this.store.transaction(async () => {
                const live = await this.store.db
                  .prepare("SELECT value FROM desktop_control_receipts WHERE id=?")
                  .get(row.id);
                if (!live) return;
                const latest = JSON.parse(live.value) as Receipt;
                for (const audit of latest.audits ?? [])
                  if (audit.event.id === item.event.id) audit.delivered = true;
                latest.auditPending = latest.audits?.some((audit) => !audit.delivered) ?? false;
                await this.store.db
                  .prepare("UPDATE desktop_control_receipts SET value=? WHERE id=?")
                  .run(JSON.stringify(latest), row.id);
              }, "critical");
            } catch {
              pending = true;
            }
          }
        await this.store.transaction(async () => {
          const live = await this.store.db
            .prepare("SELECT value FROM desktop_control_receipts WHERE id=?")
            .get(row.id);
          if (!live) return;
          const latest = JSON.parse(live.value) as Receipt;
          latest.auditAttempts = (latest.auditAttempts ?? 0) + 1;
          await this.store.db
            .prepare("UPDATE desktop_control_receipts SET value=? WHERE id=?")
            .run(JSON.stringify(latest), row.id);
        }, "critical");
      }
      return pending;
    });
    this.auditDraining = drain.finally(() => {
      this.auditDraining = undefined;
    });
    return this.auditDraining;
  }
  /** Cheap owner-only indicator data: no binary hashing, helper command or app contents. */
  async indicatorStatus(
    principal: DesktopControlPrincipal,
    authorized: () => boolean | Promise<boolean>,
  ) {
    this.owner(principal);
    if (!principal.id || principal.id.length > 200)
      throw new Error("A captured desktop principal is required.");
    return this.requestAuthorities.run(authorized, async () => {
      await this.ready;
      if (this.closing) throw new Error("Desktop control is closing.");
      await this.authorize(principal);
      const configuration = await this.configuration();
      const status = {
        enabled: configuration.enabled,
        active: !!this.active,
        stopped: this.halted,
        ...(this.currentAction ? { currentAction: { ...this.currentAction } } : {}),
      };
      await this.authorize(principal);
      return status;
    });
  }
  async request(
    raw: unknown,
    principal: DesktopControlPrincipal,
    authorized?: () => boolean | Promise<boolean>,
    physicalAuthorized?: () => boolean | Promise<boolean>,
    sensitiveAuthorized?: () => boolean | Promise<boolean>,
  ): Promise<DesktopControlResponse> {
    if (
      !principal ||
      !["owner", "assistant", "chief"].includes(principal.kind) ||
      !principal.id ||
      principal.id.length > 200
    )
      throw new Error("A captured desktop principal is required.");
    const input = DesktopControlRequestValidationSchema.parse(raw);
    if (input.op === "stop") {
      this.owner(principal);
      this.stopGeneration++;
      this.halted = true;
      this.active?.abort();
      this.statusChanged();
      this.snapshots.clear();
    }
    if (input.op === "configure" && !input.configuration.enabled) {
      this.owner(principal);
      this.stopGeneration++;
      this.halted = true;
      this.active?.abort();
      this.statusChanged();
    }
    const generation = this.stopGeneration;
    const execute = async () => {
      await this.ready;
      if (this.closing) throw new Error("Desktop control is closing.");
      await this.authorize(principal);
      if (generation !== this.stopGeneration && input.op !== "stop" && input.op !== "status")
        throw new Error("A newer Stop cancelled this desktop request.");
      const response = await this.dispatch(input, principal, generation);
      await this.authorize(principal);
      if (generation !== this.stopGeneration && input.op !== "stop" && input.op !== "status") {
        if (["act", "launch", "clipboard"].includes(input.op) && response.operation)
          return { operation: response.operation };
        throw new Error("A newer Stop cancelled this desktop request.");
      }
      if (response.clipboard && !(await this.sensitiveAuthorities.getStore()?.()))
        return { operation: response.operation };
      DesktopControlResponseSchema.parse(response);
      if (input.op !== "status") this.statusChanged();
      return response;
    };
    const scoped = () =>
      this.requestAuthorities.run(authorized ?? (() => true), () =>
        this.physicalAuthorities.run(physicalAuthorized ?? (() => false), () =>
          this.sensitiveAuthorities.run(sensitiveAuthorized ?? (() => false), execute),
        ),
      );
    // A status read must remain observable while a helper effect is in flight.
    const run = input.op === "status" ? scoped() : this.tail.then(scoped);
    if (input.op !== "status") this.tail = run.catch(() => undefined);
    return run;
  }
  private async authorize(principal: DesktopControlPrincipal) {
    if (!((await this.requestAuthorities.getStore()?.()) ?? true))
      throw new Error("Desktop request authority was revoked.");
    await this.store.db.checkAuthorization();
    if (this.ports.authorize && !(await this.ports.authorize(principal)))
      throw new Error("Desktop control authority was revoked.");
  }
  private async configuration() {
    const row = await this.store.db
      .prepare("SELECT value FROM desktop_control_configuration WHERE id=1")
      .get();
    return row ? (JSON.parse(row.value) as DesktopControlConfiguration) : { ...empty };
  }
  private async binary(configuration: DesktopControlConfiguration) {
    if (
      !configuration.binaryPath ||
      !isAbsolute(configuration.binaryPath) ||
      !/^[a-f0-9]{64}$/i.test(configuration.binarySha256)
    )
      throw new Error("A verified native desktop helper is not configured.");
    const details = await stat(configuration.binaryPath);
    if (!details.isFile() || details.size > 100 * 1024 * 1024)
      throw new Error("The desktop helper is not a supported native binary.");
    const digest = createHash("sha256")
      .update(await readFile(configuration.binaryPath))
      .digest("hex");
    if (digest !== configuration.binarySha256.toLowerCase())
      throw new Error(
        "The desktop helper's checksum changed. Verify its installation before enabling it.",
      );
    return configuration.binaryPath;
  }
  private async available(
    configuration: DesktopControlConfiguration,
    principal: DesktopControlPrincipal,
  ) {
    if (this.halted || !configuration.enabled)
      throw new Error("Desktop control is stopped or disabled.");
    await this.authorize(principal);
    const presence = await this.ports.presence?.();
    if (!presence?.supported || presence.locked)
      throw new Error(
        "Desktop presence is locked or unknown; no observation or input was dispatched.",
      );
    await this.binary(configuration);
    if (this.halted || this.closing) throw new Error("Desktop control was stopped.");
  }
  private async invoke(
    configuration: DesktopControlConfiguration,
    args: string[],
    principal: DesktopControlPrincipal,
    ownedEffectOutcome = false,
  ): Promise<Envelope> {
    await this.available(configuration, principal);
    // Upstream refs contain accessibility names/values. Keep them in this
    // instance's temporary cache, then retire it after Stop/close settles work.
    const stateRoot = await this.helperStateRoot();
    await this.available(configuration, principal);
    // The pinned CLI has no --no-trace flag. Tracing is opt-in through a
    // --trace path or a stored session manifest. A private state root and fresh
    // namespace prevent inheriting another agent's trace-enabled session.
    const env: NodeJS.ProcessEnv = Object.fromEntries(
      Object.entries(process.env).filter(
        ([key]) => !/^AGENT_DESKTOP_/i.test(key) && key.toUpperCase() !== "RUST_LOG",
      ),
    );
    env.AGENT_DESKTOP_HOME = stateRoot;
    env.AGENT_DESKTOP_SESSION = this.namespace;
    const controller = new AbortController();
    this.active = controller;
    this.statusChanged();
    try {
      if (args[0].startsWith("clipboard-") && !(await this.sensitiveAuthorities.getStore()?.()))
        throw new Error("Clipboard approval expired before dispatch.");
      const result = await (this.ports.run ?? nativeRun)(
        configuration.binaryPath,
        ["--session", this.namespace, ...args],
        {
          signal: controller.signal,
          timeoutMs: 15000,
          maxBuffer: args[0] === "screenshot" ? 6 * 1024 * 1024 : 1024 * 1024,
          env,
        },
      );
      if (controller.signal.aborted || this.halted || this.closing)
        throw new Error("Desktop command was cancelled; its delivery is unknown.");
      // Owned action outcomes are journaled even after revocation. Request disclosure
      // still rechecks authority; observations never enter this bookkeeping exception.
      if (!ownedEffectOutcome) await this.authorize(principal);
      if (
        Buffer.byteLength(result.stdout, "utf8") >
        (args[0] === "screenshot" ? 6 * 1024 * 1024 : 1024 * 1024)
      )
        throw new Error("Desktop observation exceeded its bounded output limit.");
      const output = envelopeSchema.parse(JSON.parse(result.stdout));
      if (output.command !== args[args[0] === "--headed" ? 1 : 0])
        throw new Error("Desktop helper command identity did not match the request.");
      if (result.exitCode !== 0 && output.ok)
        throw new Error("Desktop helper exit status contradicted its result.");
      return output;
    } finally {
      if (this.active === controller) { this.active = undefined; this.statusChanged(); }
    }
  }
  private requireData(envelope: Envelope) {
    if (!envelope.ok || !envelope.data)
      throw new Error(`Desktop helper refused observation (${envelope.error?.code ?? "unknown"}).`);
    return z.record(z.string(), z.unknown()).parse(envelope.data);
  }
  private async windows(
    configuration: DesktopControlConfiguration,
    app: string,
    principal: DesktopControlPrincipal,
    pid: number,
  ) {
    const envelope = await this.invoke(
      configuration,
      ["list-windows", `--app=${app}`, "--timeout-ms", "5000"],
      principal,
    );
    if (!envelope.ok) throw new Error("Desktop window inventory is unavailable.");
    const windows = z
      .array(
        z.object({
          id: z.string().min(1).max(200),
          title: z.string().max(4000),
          app_name: z.string().max(200),
          pid: z.number().int().positive(),
        }),
      )
      .max(200)
      .parse(envelope.data);
    if (windows.some((window) => window.app_name !== app || window.pid !== pid))
      throw new Error("Desktop inventory contained a foreign application process.");
    return windows.map((window) => ({
      id: window.id,
      title: window.title,
      app: window.app_name,
      pid: window.pid,
    }));
  }
  private async window(
    configuration: DesktopControlConfiguration,
    app: string,
    windowId: string,
    principal: DesktopControlPrincipal,
    pid: number,
  ) {
    if (
      !(await this.windows(configuration, app, principal, pid)).some(
        (window) => window.id === windowId,
      )
    )
      throw new Error("The selected desktop window is unavailable or changed.");
    if ((await this.appProcess(configuration, app, principal)) !== pid)
      throw new Error("The selected desktop application process changed.");
  }
  private async appProcess(
    configuration: DesktopControlConfiguration,
    app: string,
    principal: DesktopControlPrincipal,
  ) {
    if (!configuration.allowedApps.includes(app))
      throw new Error("The app is outside the owner's desktop allowlist.");
    const data = this.requireData(
      await this.invoke(configuration, ["list-apps", "--app", app], principal),
    );
    const apps = z
      .array(z.object({ name: z.string(), pid: z.number().int().positive() }))
      .parse(data.apps)
      .filter((item) => item.name === app);
    if (apps.length !== 1)
      throw new Error("The allowed app is missing or ambiguous; choose a single running app.");
    return apps[0].pid;
  }
  /** Journal one non-ref operation before any effect. Sensitive results remain
   * volatile: a retry returns only the durable receipt, never clipboard bytes. */
  private async journalCommand(
    input: Extract<DesktopControlRequest, { op: "launch" | "clipboard" }>,
    configuration: DesktopControlConfiguration,
    principal: DesktopControlPrincipal,
  ): Promise<DesktopControlResponse> {
    const receiptId = `${principal.id}:${input.requestId}`;
    const fingerprint = createHash("sha256").update(JSON.stringify(input)).digest("hex");
    const previous = await this.store.db
      .prepare("SELECT value FROM desktop_control_receipts WHERE id=?")
      .get(receiptId);
    if (previous) {
      const receipt = JSON.parse(previous.value) as Receipt;
      if (receipt.fingerprint !== fingerprint)
        throw new Error("A desktop retry must preserve the original request.");
      this.scheduleAuditDrain();
      return { operation: receipt.operation };
    }
    if (input.op === "launch") {
      if (
        input.app.startsWith("-") ||
        hasControlCharacters(input.app, false) ||
        !configuration.allowedApps.includes(input.app)
      )
        throw new Error("The app is outside the owner's desktop allowlist.");
    } else {
      if ((input.action === "set") !== (input.text !== undefined) || input.text?.includes("\0"))
        throw new Error("Clipboard text must match the selected plain-text command.");
      if (!(await this.sensitiveAuthorities.getStore()?.()))
        throw new Error("Clipboard access requires exact native owner approval.");
    }
    await this.available(configuration, principal);
    const app = input.op === "launch" ? input.app : "Global clipboard";
    const action =
      input.op === "launch"
        ? "launch"
        : (`clipboard-${input.action}` as "clipboard-get" | "clipboard-set" | "clipboard-clear");
    let operation: DesktopControlOperation = {
      requestId: input.requestId,
      state: "unknown",
      ok: false,
      delivery: "unknown",
      retry: "unknown",
    };
    const audit = (value: DesktopControlOperation): DesktopOperationAudit => ({
      id: desktopOperationAuditId(principal, input.requestId, value.state),
      at: this.now(),
      principal: { ...principal },
      app,
      action,
      headed: false,
      operation: {
        requestId: value.requestId,
        state: value.state,
        ok: value.ok,
        delivery: value.delivery,
        retry: value.retry,
      },
    });
    const receipt: Receipt = {
      fingerprint,
      operation,
      audits: [{ event: audit(operation), delivered: false }],
      auditPending: true,
    };
    await this.store.transaction(
      () =>
        this.store.db
          .prepare("INSERT INTO desktop_control_receipts(id,value) VALUES(?,?)")
          .run(receiptId, JSON.stringify(receipt)),
      "critical",
    );
    const args =
      input.op === "launch"
        ? ["launch", "--timeout", "10000", "--", input.app]
        : input.action === "get"
          ? ["clipboard-get", "--format", "text"]
          : input.action === "set"
            ? ["clipboard-set", "--", input.text!]
            : ["clipboard-clear"];
    this.currentAction = { app, action };
    this.statusChanged();
    try {
      // Authority may change while the critical journal write is pending.
      if (input.op === "clipboard" && !(await this.sensitiveAuthorities.getStore()?.()))
        throw new Error("Clipboard approval expired before dispatch.");
      const envelope = await this.invoke(configuration, args, principal, true);
      const report = envelope.ok ? envelope.data : envelope.error;
      const disposition = z
        .object({
          delivery: DesktopControlOperationSchemaDelivery,
          retry: z.enum(["unknown", "safe", "unsafe"]),
        })
        .safeParse(report && !Array.isArray(report) ? report.disposition : undefined);
      operation = {
        requestId: input.requestId,
        state: "settled",
        ok: envelope.ok,
        delivery: disposition.success ? disposition.data.delivery : "unknown",
        retry: disposition.success ? disposition.data.retry : "unknown",
        ...(envelope.error ? { errorCode: envelope.error.code } : {}),
      };
      await this.store.db.runRecoveryBookkeeping(() =>
        this.store.transaction(async () => {
          const row = await this.store.db
            .prepare("SELECT value FROM desktop_control_receipts WHERE id=?")
            .get(receiptId);
          const latest = row ? (JSON.parse(row.value) as Receipt) : receipt;
          latest.operation = operation;
          latest.audits ??= [];
          latest.audits.push({ event: audit(operation), delivered: false });
          latest.auditPending = true;
          await this.store.db
            .prepare("UPDATE desktop_control_receipts SET value=? WHERE id=?")
            .run(JSON.stringify(latest), receiptId);
        }, "critical"),
      );
      if (input.op === "clipboard" && input.action === "get" && envelope.ok) {
        // No output survives a revoked/expired approval, lock, Stop or source change.
        await this.available(configuration, principal);
        if (!(await this.sensitiveAuthorities.getStore()?.()))
          throw new Error("Clipboard approval expired before disclosure.");
        const data = z
          .union([
            z.strictObject({ type: z.literal("text"), found: z.literal(false) }),
            z.strictObject({
              type: z.literal("text"),
              text: z
                .string()
                .max(10000)
                .refine((text) => !text.includes("\0")),
            }),
          ])
          .parse(envelope.data);
        return {
          operation,
          clipboard: "text" in data ? { found: true, text: data.text } : { found: false },
        };
      }
      return { operation };
    } catch {
      return { operation };
    } finally {
      this.currentAction = undefined;
      this.statusChanged();
      if (input.op === "launch")
        for (const [id, snapshot] of this.snapshots)
          if (snapshot.app === input.app) this.snapshots.delete(id);
      this.scheduleAuditDrain();
    }
  }
  private async dispatch(
    input: DesktopControlRequest,
    principal: DesktopControlPrincipal,
    generation: number,
  ): Promise<DesktopControlResponse> {
    const configuration = await this.configuration();
    switch (input.op) {
      case "status": {
        let installed = false,
          verified = false,
          message: string | undefined;
        try {
          if (configuration.binaryPath) {
            installed = (await stat(configuration.binaryPath)).isFile();
            await this.binary(configuration);
            verified = true;
          }
        } catch (error) {
          message = error instanceof Error ? error.message : "Desktop helper is unavailable.";
        }
        return {
          configuration,
          status: {
            installed,
            verified,
            enabled: configuration.enabled,
            stopped: this.halted,
            active: !!this.active,
            ...(this.currentAction ? { currentAction: { ...this.currentAction } } : {}),
            upstreamRef: AGENT_DESKTOP_UPSTREAM_REF,
            protocol: AGENT_DESKTOP_PROTOCOL,
            ...(message ? { message } : {}),
          },
        };
      }
      case "configure": {
        this.owner(principal);
        if (
          input.configuration.allowedApps.some(
            (app) => app.startsWith("-") || hasControlCharacters(app, false),
          )
        )
          throw new Error("Desktop app names must be plain non-option names.");
        if (
          input.configuration.binaryPath &&
          (!isAbsolute(input.configuration.binaryPath) ||
            (process.platform === "win32" &&
              !input.configuration.binaryPath.toLowerCase().endsWith(".exe")))
        )
          throw new Error("Choose an absolute native executable path.");
        const next = {
          ...input.configuration,
          allowedApps: [...new Set(input.configuration.allowedApps)],
          version: configuration.version + 1,
        };
        if (next.enabled) await this.binary(next);
        await this.store.transaction(async () => {
          const current = await this.configuration();
          if (current.version !== input.expectedVersion)
            throw new Error("Desktop settings changed; reload before saving.");
          await this.store.db
            .prepare(
              "INSERT INTO desktop_control_configuration(id,value) VALUES(1,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value",
            )
            .run(JSON.stringify(next));
        }, "critical");
        this.snapshots.clear();
        await this.clearHelperState();
        this.halted = !next.enabled || generation !== this.stopGeneration;
        return { configuration: next };
      }
      case "stop":
        this.owner(principal);
        await this.store.transaction(
          () =>
            this.store.db
              .prepare(
                "INSERT INTO desktop_control_configuration(id,value) VALUES(1,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value",
              )
              .run(
                JSON.stringify({
                  ...configuration,
                  enabled: false,
                  version: configuration.version + 1,
                }),
              ),
          "critical",
        );
        await this.clearHelperState();
        return { ok: true, configuration: await this.configuration() };
      case "resume":
        this.owner(principal);
        await this.binary(configuration);
        if (generation !== this.stopGeneration)
          throw new Error("A newer Stop cancelled this desktop request.");
        await this.store.transaction(
          () =>
            this.store.db
              .prepare("UPDATE desktop_control_configuration SET value=? WHERE id=1")
              .run(
                JSON.stringify({
                  ...configuration,
                  enabled: true,
                  version: configuration.version + 1,
                }),
              ),
          "critical",
        );
        this.halted = generation !== this.stopGeneration;
        return { ok: true, configuration: await this.configuration() };
      case "windows.list": {
        const pid = await this.appProcess(configuration, input.app, principal);
        const windows = await this.windows(configuration, input.app, principal, pid);
        if ((await this.appProcess(configuration, input.app, principal)) !== pid)
          throw new Error("The desktop application process changed during inventory.");
        return { windows };
      }
      case "launch":
      case "clipboard":
        return this.journalCommand(input, configuration, principal);
      case "screenshot": {
        const pid = await this.appProcess(configuration, input.app, principal);
        await this.window(configuration, input.app, input.windowId, principal, pid);
        const data = this.requireData(
          await this.invoke(
            configuration,
            ["screenshot", `--app=${input.app}`, `--window-id=${input.windowId}`],
            principal,
          ),
        );
        const image = z
          .object({
            data: z.string().max(6 * 1024 * 1024),
            format: z.literal("png"),
            width: z.number().int().positive().max(16384),
            height: z.number().int().positive().max(16384),
          })
          .parse(data);
        if (image.width * image.height > 64_000_000 || !/^[A-Za-z0-9+/]+={0,2}$/.test(image.data))
          throw new Error("The desktop screenshot is invalid or oversized.");
        const bytes = Buffer.from(image.data, "base64");
        if (
          bytes.length < 33 ||
          bytes.length > 4 * 1024 * 1024 ||
          !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ||
          bytes.readUInt32BE(8) !== 13 ||
          bytes.toString("ascii", 12, 16) !== "IHDR" ||
          bytes.readUInt32BE(16) !== image.width ||
          bytes.readUInt32BE(20) !== image.height ||
          bytes.toString("base64") !== image.data
        )
          throw new Error("The desktop screenshot is not a bounded PNG.");
        await this.window(configuration, input.app, input.windowId, principal, pid);
        return {
          screenshot: {
            app: input.app,
            windowId: input.windowId,
            mimeType: "image/png",
            data: image.data,
            width: image.width,
            height: image.height,
          },
        };
      }
      case "find": {
        const pid = await this.appProcess(configuration, input.app, principal);
        await this.window(configuration, input.app, input.windowId, principal, pid);
        const filters = Object.entries(input.query).flatMap(([key, value]) =>
          key === "exact"
            ? value
              ? ["--exact"]
              : []
            : typeof value === "string"
              ? [`--${key}=${value}`]
              : [],
        );
        const data = this.requireData(
          await this.invoke(
            configuration,
            [
              "find",
              `--app=${input.app}`,
              `--window-id=${input.windowId}`,
              "--limit",
              "50",
              "--timeout-ms",
              "5000",
              ...filters,
            ],
            principal,
          ),
        );
        const found = z
          .object({
            snapshot_id: z.string().min(1).max(100).optional(),
            matches: z
              .array(
                z.object({
                  ref_id: z.string().max(200).nullable(),
                  role: z.string().max(200),
                  name: z.string().max(4000).optional(),
                  value: z.string().max(16000).nullable(),
                  states: z.array(z.string().max(200)).max(100),
                  interactive: z.boolean(),
                }),
              )
              .max(50),
            truncated: z.boolean(),
          })
          .parse(data);
        await this.window(configuration, input.app, input.windowId, principal, pid);
        if (!found.snapshot_id) return { dataJson: JSON.stringify(found) };
        const refs = new Set(
          found.matches.flatMap((match) => (match.ref_id ? [match.ref_id] : [])),
        );
        if ([...refs].some((ref) => !ref.startsWith(`@${found.snapshot_id}:`)))
          throw new Error("Desktop search returned a foreign ref.");
        if (this.snapshots.size >= 100) this.snapshots.delete(this.snapshots.keys().next().value!);
        this.snapshots.set(found.snapshot_id, {
          id: found.snapshot_id,
          app: input.app,
          pid,
          windowId: input.windowId,
          refs,
          owner: principal.id,
          configurationVersion: configuration.version,
          createdAt: this.now(),
        });
        const treeJson = JSON.stringify({ children: found.matches });
        if (treeJson.length > 500000) {
          this.snapshots.delete(found.snapshot_id);
          throw new Error("Desktop search is too large; narrow the filters.");
        }
        return {
          snapshot: {
            snapshotId: found.snapshot_id,
            app: input.app,
            windowId: input.windowId,
            complete: !found.truncated,
            treeJson,
          },
        };
      }
      case "wait": {
        const snapshot = this.snapshots.get(input.snapshotId);
        if (
          !snapshot ||
          snapshot.owner !== principal.id ||
          snapshot.configurationVersion !== configuration.version ||
          this.now() - snapshot.createdAt > 5 * 60000 ||
          !snapshot.refs.has(input.ref)
        )
          throw new Error("A current desktop ref from this caller is required for waiting.");
        await this.window(configuration, snapshot.app, snapshot.windowId, principal, snapshot.pid);
        const data = this.requireData(
          await this.invoke(
            configuration,
            [
              "wait",
              `--element=${input.ref}`,
              `--app=${snapshot.app}`,
              `--predicate=${input.predicate}`,
              "--timeout",
              String(input.timeoutMs),
            ],
            principal,
          ),
        );
        await this.window(configuration, snapshot.app, snapshot.windowId, principal, snapshot.pid);
        return { dataJson: JSON.stringify(data) };
      }
      case "snapshot": {
        const pid = await this.appProcess(configuration, input.app, principal);
        const args = [
          "snapshot",
          "--app",
          input.app,
          "-i",
          "--compact",
          "--timeout-ms",
          "10000",
          ...(input.windowId ? [`--window-id=${input.windowId}`] : []),
        ];
        const data = this.requireData(await this.invoke(configuration, args, principal));
        const observed = z
          .object({
            app: z.string(),
            window: z.object({ id: z.string() }),
            snapshot_id: z.string().max(100),
            complete: z.boolean(),
            tree: z.unknown(),
          })
          .parse(data);
        if (observed.app !== input.app || (input.windowId && observed.window.id !== input.windowId))
          throw new Error("Desktop observation resolved to a different app or window.");
        const treeJson = JSON.stringify(observed.tree);
        if (treeJson.length > 500000)
          throw new Error("Desktop snapshot is too large; narrow the target window.");
        const refs = new Set<string>();
        const walk = (node: unknown, depth = 0) => {
          if (depth > 100) throw new Error("Desktop tree exceeded its depth limit.");
          if (!node || typeof node !== "object") return;
          const value = node as { ref_id?: unknown; children?: unknown };
          if (typeof value.ref_id === "string") {
            if (!value.ref_id.startsWith(`@${observed.snapshot_id}:`))
              throw new Error("Snapshot contained a foreign ref.");
            refs.add(value.ref_id);
          }
          if (Array.isArray(value.children))
            for (const child of value.children) walk(child, depth + 1);
        };
        walk(observed.tree);
        if (this.snapshots.size >= 100) this.snapshots.delete(this.snapshots.keys().next().value!);
        this.snapshots.set(observed.snapshot_id, {
          id: observed.snapshot_id,
          app: input.app,
          pid,
          windowId: observed.window.id,
          refs,
          owner: principal.id,
          configurationVersion: configuration.version,
          createdAt: this.now(),
        });
        return {
          snapshot: {
            snapshotId: observed.snapshot_id,
            app: observed.app,
            windowId: observed.window.id,
            complete: observed.complete,
            treeJson,
          },
        };
      }
      case "act": {
        const receiptId = `${principal.id}:${input.requestId}`;
        const fingerprint = createHash("sha256").update(JSON.stringify(input)).digest("hex");
        const previous = await this.store.db
          .prepare("SELECT value FROM desktop_control_receipts WHERE id=?")
          .get(receiptId);
        if (previous) {
          const receipt = JSON.parse(previous.value) as Receipt;
          if (receipt.fingerprint !== fingerprint)
            throw new Error("A desktop retry must preserve the original request.");
          this.scheduleAuditDrain();
          return { operation: receipt.operation };
        }
        const snapshot = this.snapshots.get(input.snapshotId);
        if (
          !snapshot ||
          snapshot.owner !== principal.id ||
          snapshot.configurationVersion !== configuration.version ||
          this.now() - snapshot.createdAt > 5 * 60000 ||
          !snapshot.refs.has(input.ref)
        )
          throw new Error("The desktop ref is stale or outside this caller's observed snapshot.");
        if ((await this.appProcess(configuration, snapshot.app, principal)) !== snapshot.pid)
          throw new Error("The observed app process changed; take a fresh snapshot.");
        if (input.action === "press" || input.action === "double-click")
          if (!input.headed)
            throw new Error("This action requires an explicit physical-input grant.");
        if (
          input.headed &&
          (!configuration.allowPhysicalInput ||
            !(
              (await this.physicalAuthorities.getStore()?.()) ||
              (this.ports.physicalGrant &&
                (await this.ports.physicalGrant(principal, {
                  requestId: input.requestId,
                  app: snapshot.app,
                  action: input.action,
                  ref: input.ref,
                })))
            ))
        )
          throw new Error("Physical input is not granted for this exact request.");
        const requiresText = ["set-value", "type", "select", "press"].includes(input.action);
        if (
          (requiresText && input.text === undefined) ||
          (!requiresText && input.text !== undefined)
        )
          throw new Error("Desktop action text did not match the selected command.");
        if (
          input.action === "press" &&
          (!input.text ||
            input.text.length > 100 ||
            hasControlCharacters(input.text, false) ||
            isForbiddenDesktopShortcut(input.text))
        )
          throw new Error("Invalid scoped keyboard shortcut.");
        await this.available(configuration, principal);
        let operation: DesktopControlOperation = {
          requestId: input.requestId,
          state: "unknown",
          ok: false,
          delivery: "unknown",
          retry: "unknown",
        };
        const audit = (value: DesktopControlOperation): DesktopOperationAudit => ({
          id: desktopOperationAuditId(principal, input.requestId, value.state),
          at: this.now(),
          principal: { kind: principal.kind, id: principal.id },
          app: snapshot.app,
          action: input.action,
          headed: input.headed === true,
          operation: {
            requestId: value.requestId,
            state: value.state,
            ok: value.ok,
            delivery: value.delivery,
            retry: value.retry,
          },
        });
        const receipt: Receipt = {
          fingerprint,
          operation,
          audits: [{ event: audit(operation), delivered: false }],
          auditPending: true,
        };
        await this.store.transaction(
          () =>
            this.store.db
              .prepare("INSERT INTO desktop_control_receipts(id,value) VALUES(?,?)")
              .run(receiptId, JSON.stringify(receipt)),
          "critical",
        );
        const args = [
          ...(input.headed ? ["--headed"] : []),
          input.action,
          "--timeout-ms",
          "5000",
          ...(input.action === "press"
            ? ["--app", snapshot.app, "--window-id", snapshot.windowId]
            : []),
          "--",
          ...(input.action === "press"
            ? [input.text!]
            : [input.ref, ...(requiresText ? [input.text!] : [])]),
        ];
        this.currentAction = { app: snapshot.app, action: input.action };
        this.statusChanged();
        try {
          const envelope = await this.invoke(configuration, args, principal, true);
          const report = envelope.ok ? envelope.data : envelope.error;
          const disposition = z
            .object({
              delivery: DesktopControlOperationSchemaDelivery,
              retry: z.enum(["unknown", "safe", "unsafe"]),
            })
            .safeParse(report && !Array.isArray(report) ? report.disposition : undefined);
          operation = {
            requestId: input.requestId,
            state: "settled",
            ok: envelope.ok,
            delivery: disposition.success ? disposition.data.delivery : "unknown",
            retry: disposition.success ? disposition.data.retry : "unknown",
            ...(envelope.error ? { errorCode: envelope.error.code } : {}),
          };
          // The already-attempted effect's receipt must survive caller revocation.
          await this.store.db.runRecoveryBookkeeping(() =>
            this.store.transaction(async () => {
              const row = await this.store.db
                .prepare("SELECT value FROM desktop_control_receipts WHERE id=?")
                .get(receiptId);
              const latest = row ? (JSON.parse(row.value) as Receipt) : receipt;
              latest.operation = operation;
              latest.audits ??= [];
              latest.audits.push({ event: audit(operation), delivered: false });
              latest.auditPending = true;
              await this.store.db
                .prepare("UPDATE desktop_control_receipts SET value=? WHERE id=?")
                .run(JSON.stringify(latest), receiptId);
            }, "critical"),
          );
          this.snapshots.delete(input.snapshotId);
          return {
            operation,
            dataJson: JSON.stringify(envelope.ok ? envelope.data : { code: envelope.error?.code }),
          };
        } catch {
          this.snapshots.delete(input.snapshotId);
          return { operation };
        } finally {
          this.currentAction = undefined;
          this.statusChanged();
          this.scheduleAuditDrain();
        }
      }
    }
  }
}
const DesktopControlOperationSchemaDelivery = z.enum([
  "unknown",
  "not_delivered",
  "delivery_uncertain",
  "delivered_unverified",
  "delivered_verified",
]);
