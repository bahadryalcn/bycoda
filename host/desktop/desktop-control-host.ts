import { nativeRun, type DesktopRunner } from "./desktop-control-runner";
export type { DesktopRunner } from "./desktop-control-runner";
import {
  SNAPSHOT_PAGE_DEFAULT_CHARS,
  pageSnapshotText,
  parseSnapshotCursor,
  renderSnapshotTree,
  findResultSchema,
  findFilterArgs,
  parseScreenshotImage,
  observedSnapshotSchema,
} from "./desktop-snapshot-pages";
import {
  desktopActArgs,
  isPhysicalOnlyDesktopAction,
  validateDesktopAct,
} from "./desktop-act-command";
import { DesktopStatusChanges } from "./desktop-status-changes";
import { DesktopSystemPermissions, normalizeDesktopError } from "./desktop-system-permissions";
import { AsyncLocalStorage } from "node:async_hooks";
import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, mkdtemp, readFile, realpath, rm, stat } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative } from "node:path";
import { z } from "zod";
import type { HostStore } from "../store";
import { desktopOperationAuditId, type DesktopOperationAudit } from "./desktop-control-audit";
import {
  isDesktopAppAllowed,
  isPlainDesktopAppName,
  normalizeDesktopConfiguration,
} from "./desktop-control-permission";
import {
  AGENT_DESKTOP_PROTOCOL,
  AGENT_DESKTOP_UPSTREAM_REF,
  DesktopControlRequestValidationSchema,
  DesktopControlResponseSchema,
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
      message: z.string().optional(),
      platform_detail: z.string().optional(),
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
  complete?: boolean;
  /** Rendered tree for paged reads; absent for find results. */
  text?: string;
};
type Receipt = {
  fingerprint: string;
  operation: DesktopControlOperation;
  audits?: { event: DesktopOperationAudit; delivered: boolean }[];
  auditPending?: boolean;
  auditAttempts?: number;
};

/** Optional CLI adapter. The binary is never installed or downloaded here.
 * Exact app observations mint short-lived ref grants. Only supported scoped
 * commands are constructed; output content is neither logged nor persisted. */
export class HostDesktopControl {
  readonly ready: Promise<void>;
  readonly statusChanges = new DesktopStatusChanges();
  private statusChanged() {
    this.statusChanges.changed();
    this.ports.onChange?.();
  }
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
  private readonly permissions: DesktopSystemPermissions;
  constructor(
    private readonly store: HostStore,
    private readonly ports: DesktopControlPorts = {},
  ) {
    this.permissions = new DesktopSystemPermissions(ports.run ?? nativeRun, () => this.now());
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
    return normalizeDesktopConfiguration(row ? JSON.parse(row.value) : {});
  }
  /** Owner-set permission mode for the conversation gate; never writable through this call. */
  async permission() {
    await this.ready;
    const { permissionMode } = await this.configuration();
    return { mode: permissionMode };
  }
  /** Whether the conversation gate must ask the owner before this app is used. */
  async appAllowed(app: string) {
    await this.ready;
    return isDesktopAppAllowed(await this.configuration(), app);
  }
  /** Remembers an app after the owner's exact native approval, which the conversation gate
   * holds. Never a model tool. Live snapshots stay valid: adding an app revokes nothing. */
  async allowApp(app: string) {
    await this.ready;
    if (!isPlainDesktopAppName(app))
      throw new Error("Desktop app names must be plain non-option names.");
    await this.store.transaction(async () => {
      const current = await this.configuration();
      if (isDesktopAppAllowed(current, app)) return;
      if (current.allowedApps.length >= 50)
        throw new Error(
          "The approved app list is full. Remove an app in Computer use settings first.",
        );
      const next = {
        ...current,
        allowedApps: [...current.allowedApps, app],
        version: current.version + 1,
      };
      await this.store.db
        .prepare(
          "INSERT INTO desktop_control_configuration(id,value) VALUES(1,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value",
        )
        .run(JSON.stringify(next));
      for (const snapshot of this.snapshots.values())
        if (snapshot.configurationVersion === current.version)
          snapshot.configurationVersion = next.version;
    }, "critical");
    this.statusChanged();
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
    const env = Object.fromEntries(
      Object.entries(process.env).filter(
        ([key]) => !/^AGENT_DESKTOP_/i.test(key) && key.toUpperCase() !== "RUST_LOG",
      ),
    ) as NodeJS.ProcessEnv;
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
      if (!output.ok && output.error) output.error = normalizeDesktopError(output.error);
      return output;
    } finally {
      if (this.active === controller) {
        this.active = undefined;
        this.statusChanged();
      }
    }
  }
  private requireData(envelope: Envelope) {
    if (!envelope.ok || !envelope.data)
      throw new Error(
        envelope.error?.code === "target-elevated"
          ? envelope.error.message
          : `Desktop helper refused observation (${envelope.error?.code ?? "unknown"}).`,
      );
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
    if (!isDesktopAppAllowed(configuration, app))
      throw new Error("The owner has not approved this app for computer use.");
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
      if (!isPlainDesktopAppName(input.app) || !isDesktopAppAllowed(configuration, input.app))
        throw new Error("The owner has not approved this app for computer use.");
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
      permissionMode: configuration.permissionMode,
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
        ...(envelope.error
          ? {
              errorCode: envelope.error.code,
              ...(envelope.error.code === "target-elevated"
                ? { errorMessage: envelope.error.message }
                : {}),
            }
          : {}),
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
  private liveSnapshot(
    input: { snapshotId: string; ref: string },
    configuration: DesktopControlConfiguration,
    principal: DesktopControlPrincipal,
    message: string,
  ) {
    const snapshot = this.snapshots.get(input.snapshotId);
    if (
      !snapshot ||
      snapshot.owner !== principal.id ||
      snapshot.configurationVersion !== configuration.version ||
      this.now() - snapshot.createdAt > 5 * 60000 ||
      !snapshot.refs.has(input.ref)
    )
      throw new Error(message);
    return snapshot;
  }
  private snapshotPage(stored: Snapshot, offset: number, maxChars = SNAPSHOT_PAGE_DEFAULT_CHARS) {
    const { page, ...paging } = pageSnapshotText(stored.text!, stored.id, offset, maxChars);
    const { id: snapshotId, app, windowId } = stored;
    return {
      snapshotId,
      app,
      windowId,
      complete: stored.complete ?? true,
      treeJson: page,
      ...paging,
    };
  }
  private async observe(
    configuration: DesktopControlConfiguration,
    input: { app: string; windowId?: string; maxChars?: number },
    principal: DesktopControlPrincipal,
  ) {
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
    const observed = observedSnapshotSchema.parse(data);
    if (observed.app !== input.app || (input.windowId && observed.window.id !== input.windowId))
      throw new Error("Desktop observation resolved to a different app or window.");
    if (JSON.stringify(observed.tree).length > 500000)
      throw new Error("Desktop snapshot is too large; narrow the target window.");
    const { text, refs } = renderSnapshotTree(observed.tree, observed.snapshot_id);
    if (this.snapshots.size >= 100) this.snapshots.delete(this.snapshots.keys().next().value!);
    const stored: Snapshot = {
      id: observed.snapshot_id,
      app: input.app,
      pid,
      windowId: observed.window.id,
      refs,
      owner: principal.id,
      configurationVersion: configuration.version,
      createdAt: this.now(),
      complete: observed.complete,
      text,
    };
    this.snapshots.set(stored.id, stored);
    return this.snapshotPage(stored, 0, input.maxChars);
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
        const permissions = await this.permissions.read(
          verified ? configuration.binaryPath : undefined,
          verified ? configuration.binarySha256 : undefined,
        );
        return {
          configuration,
          status: {
            installed,
            verified,
            enabled: configuration.enabled,
            stopped: this.halted,
            active: !!this.active,
            permissions,
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
        const next = normalizeDesktopConfiguration({
          ...input.configuration,
          allowedApps: [...new Set(input.configuration.allowedApps)],
          version: configuration.version + 1,
        });
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
        const image = parseScreenshotImage(data);
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
              ...findFilterArgs(input.query),
            ],
            principal,
          ),
        );
        const found = findResultSchema.parse(data);
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
        const snapshot = this.liveSnapshot(
          input,
          configuration,
          principal,
          "A current desktop ref from this caller is required for waiting.",
        );
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
        if (input.cursor) {
          const { offset, snapshotId } = parseSnapshotCursor(input.cursor);
          const stored = this.snapshots.get(snapshotId);
          if (
            !stored?.text ||
            stored.owner !== principal.id ||
            stored.app !== input.app ||
            stored.configurationVersion !== configuration.version ||
            this.now() - stored.createdAt > 5 * 60000
          )
            throw new Error("The desktop snapshot cursor is stale or outside this caller.");
          return { snapshot: this.snapshotPage(stored, offset, input.maxChars) };
        }
        return { snapshot: await this.observe(configuration, input, principal) };
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
        const snapshot = this.liveSnapshot(
          input,
          configuration,
          principal,
          "The desktop ref is stale or outside this caller's observed snapshot.",
        );
        if ((await this.appProcess(configuration, snapshot.app, principal)) !== snapshot.pid)
          throw new Error("The observed app process changed; take a fresh snapshot.");
        if (isPhysicalOnlyDesktopAction(input.action) && !input.headed)
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
        validateDesktopAct(input, snapshot.refs);
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
          permissionMode: configuration.permissionMode,
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
        const args = desktopActArgs(input, snapshot);
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
            ...(envelope.error
              ? {
                  errorCode: envelope.error.code,
                  ...(envelope.error.code === "target-elevated"
                    ? { errorMessage: envelope.error.message }
                    : {}),
                }
              : {}),
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
          // Read-only refresh through the snapshot path; never fails the act.
          const next = await this.observe(
            configuration,
            { app: snapshot.app, windowId: snapshot.windowId, maxChars: 20000 },
            principal,
          ).catch((error: unknown) => ({
            error: (error instanceof Error ? error.message : "Desktop refresh failed.").slice(
              0,
              300,
            ),
          }));
          return {
            operation,
            refsExpired: true,
            next,
            dataJson: JSON.stringify(envelope.ok ? envelope.data : { code: envelope.error?.code }),
          };
        } catch {
          this.snapshots.delete(input.snapshotId);
          return { operation, refsExpired: true };
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
