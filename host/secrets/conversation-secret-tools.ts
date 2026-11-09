import { createHash } from "node:crypto";
import type { HostStore } from "../store";
import type { RuntimeLogPrincipal } from "../execution/runtime-log-tools";
import {
  parseSecretRef,
  parseSecretRequest,
  parseSecretRun,
  type SecretRequestInput,
  type SecretTool,
} from "./secret-schemas";
import { redactSecretValues } from "./secret-redact";
import { limitBytes, runShellCommand } from "./secret-run";
import type { OwnerSecretView, SecretOutcome, SecretStore } from "./secret-store";

export const MAX_SECRET_VALUE_BYTES = 8192;
const UNAVAILABLE = "Owner secret input is unavailable.";

/** Desktop relay port: the owner answers in-app and the value returns over the same relay. */
export type SecretDesktopPort = {
  call(
    action: "secrets.input.authorize",
    input: Record<string, unknown>,
    cwd: string,
    principal: RuntimeLogPrincipal,
    authorized: () => boolean | Promise<boolean>,
  ): Promise<unknown>;
};

const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

/** Accepts exactly `{ cancelled: true }` or `{ value: string }`; anything else is refused without echoing it. */
function answerOutcome(answer: unknown): { value: string } | { cancelled: true } {
  if (!answer || typeof answer !== "object" || Array.isArray(answer)) throw new Error(UNAVAILABLE);
  const keys = Object.keys(answer);
  const record = answer as Record<string, unknown>;
  if (keys.length === 1 && keys[0] === "cancelled" && record.cancelled === true)
    return { cancelled: true };
  if (
    keys.length === 1 &&
    keys[0] === "value" &&
    typeof record.value === "string" &&
    record.value.length > 0 &&
    Buffer.byteLength(record.value, "utf8") <= MAX_SECRET_VALUE_BYTES
  )
    return { value: record.value };
  throw new Error(UNAVAILABLE);
}

/** Project-scoped secret tools, callable from any session of the project. Values never leave through a result or an error. */
export class ConversationSecretTools {
  private readonly inflight = new Map<
    string,
    { signature: string; promise: Promise<SecretOutcome> }
  >();

  constructor(
    private readonly store: Pick<HostStore, "project" | "session">,
    private readonly desktop: SecretDesktopPort,
    private readonly secrets: SecretStore,
  ) {}

  /** Startup cleanup of expired refs and orphan files; resolves once it has run. */
  start(): Promise<void> {
    return this.secrets.ready;
  }

  close(): void {
    this.secrets.close();
  }

  /** Replaces every live secret value of the project in `value`. A vault failure leaves the
   * value as it is: the tools could not read the secrets either. */
  async redact<T>(projectId: string, value: T): Promise<T> {
    try {
      const live = await this.secrets.liveValues(projectId);
      return live.length ? redactSecretValues(value, live) : value;
    } catch {
      return value;
    }
  }

  ownerList(): Promise<OwnerSecretView[]> {
    return this.secrets.listAll();
  }

  ownerRevoke(secretRef: string): Promise<void> {
    return this.secrets.ownerRevoke(secretRef);
  }

  async call(
    action: SecretTool,
    input: Record<string, unknown>,
    principal: RuntimeLogPrincipal,
    authorized: () => boolean | Promise<boolean>,
  ): Promise<unknown> {
    const check = async () => {
      if (!(await authorized())) throw new Error("Session authority revoked.");
    };
    await check();
    await this.store.project(principal.projectId);
    const caller = await this.store.session(principal.sessionId);
    if (caller.projectId !== principal.projectId)
      throw new Error("Session belongs to another project.");
    if (action === "secrets.request")
      return await this.request(parseSecretRequest(input), principal, authorized);
    if (action === "secrets.list") return { secrets: await this.secrets.list(principal.projectId) };
    await check();
    if (action === "secrets.materialize")
      return await this.secrets.materialize(principal.projectId, parseSecretRef(input));
    if (action === "secrets.revoke")
      return await this.secrets.revoke(principal.projectId, parseSecretRef(input));
    if (action === "secrets.run") return await this.run(input, principal, check);
    throw new Error("Unknown secret action");
  }

  private async run(
    input: Record<string, unknown>,
    principal: RuntimeLogPrincipal,
    check: () => Promise<void>,
  ) {
    const parsed = parseSecretRun(input);
    const names = Object.keys(parsed.env);
    const used = await this.secrets.readValues(
      principal.projectId,
      names.map((name) => parsed.env[name] as string),
    );
    const env = Object.fromEntries(names.map((name, index) => [name, used[index]!.value]));
    const project = await this.store.project(principal.projectId);
    await check();
    const raw = await runShellCommand({
      command: parsed.command,
      cwd: project.cwd,
      env,
      timeoutMs: parsed.timeoutSeconds * 1000,
    });
    const known = [
      ...used.map(({ name, value }) => ({ name, value })),
      ...(await this.secrets.liveValues(principal.projectId).catch(() => [])),
    ];
    const stdout = limitBytes(redactSecretValues(raw.stdout, known));
    const stderr = limitBytes(redactSecretValues(raw.stderr, known));
    return {
      exitCode: raw.exitCode,
      ...(raw.signal ? { signal: raw.signal } : {}),
      timedOut: raw.timedOut,
      stdout: stdout.text,
      stderr: stderr.text,
      truncated: raw.truncated || stdout.truncated || stderr.truncated,
    };
  }

  private async request(
    input: SecretRequestInput,
    principal: RuntimeLogPrincipal,
    authorized: () => boolean | Promise<boolean>,
  ): Promise<SecretOutcome> {
    const signature = digest([input.name, input.purpose, input.ttlMinutes ?? null, input.replace]);
    const replay = await this.secrets.findRequest(principal.sessionId, input.requestId);
    if (replay) {
      if (replay.signature !== signature)
        throw new Error("Request ID was already used for another secret request.");
      return replay.outcome;
    }
    if (!input.replace) {
      const existing = await this.secrets.findByName(principal.projectId, input.name);
      if (existing)
        return {
          secretRef: existing.secretRef,
          name: existing.name,
          expiresAt: existing.expiresAt,
          reused: true,
        };
    }
    // A duplicate call while the owner is still answering shares the prompt; it never opens a second one.
    const key = `${principal.sessionId}\n${input.requestId}`;
    const pending = this.inflight.get(key);
    if (pending) {
      if (pending.signature !== signature)
        throw new Error("Request ID was already used for another secret request.");
      return await pending.promise;
    }
    const promise = this.ask(input, signature, principal, authorized).finally(() =>
      this.inflight.delete(key),
    );
    this.inflight.set(key, { signature, promise });
    return await promise;
  }

  private async ask(
    input: SecretRequestInput,
    signature: string,
    principal: RuntimeLogPrincipal,
    authorized: () => boolean | Promise<boolean>,
  ): Promise<SecretOutcome> {
    const project = await this.store.project(principal.projectId);
    const answer = await this.desktop.call(
      "secrets.input.authorize",
      { name: input.name, purpose: input.purpose },
      project.cwd,
      principal,
      authorized,
    );
    if (!(await authorized())) throw new Error("Session authority revoked.");
    const outcome = answerOutcome(answer);
    if ("cancelled" in outcome) {
      const cancelled: SecretOutcome = { cancelled: true };
      await this.secrets.recordRequest({
        sessionId: principal.sessionId,
        requestId: input.requestId,
        signature,
        outcome: cancelled,
      });
      return cancelled;
    }
    // Revoked while the owner typed: the value is discarded and nothing is stored.
    if (!(await authorized())) throw new Error("Session authority revoked.");
    const replaceRef = input.replace
      ? (await this.secrets.findByName(principal.projectId, input.name))?.secretRef
      : undefined;
    return await this.secrets.create({
      sessionId: principal.sessionId,
      projectId: principal.projectId,
      requestId: input.requestId,
      signature,
      name: input.name,
      purpose: input.purpose,
      ttlMinutes: input.ttlMinutes,
      value: outcome.value,
      replaceRef,
    });
  }
}
