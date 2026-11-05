import { createHash, createPublicKey, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { verifyRoomAttestation, type RoomAttestation } from "./assistant-room-attestation";

/** No local Room/session impersonation: a delegated principal is always distinct. */
export type DelegatedRoomPrincipal = Readonly<{
  kind: "delegated-assistant-thread";
  originEnvironmentId: string;
  targetEnvironmentId: string;
  threadId: string;
  projectId: string;
  grantId: string;
}>;
export const DELEGABLE_ROOM_ACTIONS = [
  "sessions.list",
  "sessions.read",
  "tasks.list",
  "tasks.get",
  "tasks.create",
  "tasks.update",
] as const;
export type DelegatedRoomAction = (typeof DELEGABLE_ROOM_ACTIONS)[number];
type Grant = DelegatedRoomPrincipal & {
  tokenHash: string;
  originPublicKey: string;
  originNativeRevision: string;
  actions: DelegatedRoomAction[];
  expiresAt: number;
  revoked: boolean;
};
type Receipt = {
  signature: string;
  state: "pending" | "completed" | "uncertain";
  result?: unknown;
  expiresAt?: number;
};
export type DelegationStore = {
  /** Must serialize the complete callback across restart-capable durable writers. */
  atomic<T>(fn: () => Promise<T>): Promise<T>;
  grant(id: string): Promise<Grant | undefined>;
  saveGrant(grant: Grant): Promise<void>;
  receipt(key: string): Promise<Receipt | undefined>;
  saveReceipt(key: string, receipt: Receipt): Promise<void>;
};
export type DelegationOrigin = Readonly<{ environmentId: string; threadId: string }>;
export type DelegationPorts = {
  targetEnvironmentId: string;
  store: DelegationStore;
  /** Authenticated native owner must verify the live original Host and real thread, not model data. */
  verifyOrigin(origin: DelegationOrigin, publicKey: string): Promise<boolean>;
  /** Target native owner reviews all supplied fields and returns the exact operation hash. */
  approve(operation: {
    action: string;
    input: unknown;
    operationHash: string;
  }): Promise<{ approved?: boolean; operationHash?: string }>;
  /** Canonical target owner must accept this distinct principal and recheck authorized at its effect. */
  execute(
    action: DelegatedRoomAction,
    input: Record<string, unknown>,
    principal: DelegatedRoomPrincipal,
    requestId: string,
    authorized: () => Promise<boolean>,
  ): Promise<unknown>;
  now?: () => number;
};
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
export const roomDelegationScopeHash = (action: string, input: Record<string, unknown>) =>
  hash([action, input]);
const identity = (value: unknown): value is string =>
  typeof value === "string" && /^[A-Za-z0-9_-]{1,200}$/.test(value);
const actionSet = new Set<string>(DELEGABLE_ROOM_ACTIONS);
const readActions = new Set<string>(["sessions.list", "sessions.read", "tasks.list", "tasks.get"]);

/** Target Host admission. Callers authenticate native transport and provide verified origin proof ports. */
export class AssistantRoomDelegation {
  private readonly closing = new Set<string>();
  private readonly active = new Map<string, number>();
  private readonly drains = new Map<string, Array<() => void>>();
  constructor(private readonly ports: DelegationPorts) {}
  private now() {
    return (this.ports.now ?? Date.now)();
  }
  async issue(input: {
    requestId: string;
    originEnvironmentId: string;
    originNativeRevision: string;
    targetEnvironmentId: string;
    threadId: string;
    projectId: string;
    originPublicKey: string;
    actions: DelegatedRoomAction[];
    expiresAt: number;
  }) {
    if (
      ![
        input.requestId,
        input.originEnvironmentId,
        input.targetEnvironmentId,
        input.threadId,
        input.projectId,
      ].every(identity) ||
      !/^[a-f0-9]{64}$/.test(input.originNativeRevision) ||
      typeof input.originPublicKey !== "string" ||
      input.originPublicKey.length > 1000 ||
      !input.originPublicKey.includes("BEGIN PUBLIC KEY") ||
      input.targetEnvironmentId !== this.ports.targetEnvironmentId ||
      input.originEnvironmentId === input.targetEnvironmentId ||
      !Array.isArray(input.actions) ||
      !input.actions.length ||
      input.actions.length > DELEGABLE_ROOM_ACTIONS.length ||
      new Set(input.actions).size !== input.actions.length ||
      input.actions.some((action) => !actionSet.has(action)) ||
      !Number.isSafeInteger(input.expiresAt) ||
      input.expiresAt <= this.now() ||
      input.expiresAt > this.now() + 24 * 60 * 60 * 1000
    )
      throw new Error("Invalid delegated Room scope.");
    try {
      if (createPublicKey(input.originPublicKey).asymmetricKeyType !== "ed25519") throw new Error();
    } catch {
      throw new Error("Invalid delegated Room public key.");
    }
    const origin = { environmentId: input.originEnvironmentId, threadId: input.threadId };
    if (!(await this.ports.verifyOrigin(origin, input.originPublicKey)))
      throw new Error("Original Room source is unavailable.");
    const signature = hash(["issue", input]);
    const key = `delegation-issue:${input.requestId}`;
    await this.ports.store.atomic(async () => {
      const receipt = await this.ports.store.receipt(key);
      if (receipt)
        throw new Error(
          receipt.signature === signature
            ? "Grant issuance already attempted; inspect or revoke it."
            : "Request ID reused with different delegation.",
        );
      await this.ports.store.saveReceipt(key, { signature, state: "pending" });
    });
    const approval = await this.ports.approve({
      action: "assistant.delegation.issue",
      input,
      operationHash: signature,
    });
    if (
      !approval.approved ||
      approval.operationHash !== signature ||
      !(await this.ports.verifyOrigin(origin, input.originPublicKey))
    )
      throw new Error("Exact native approval and live Room source required.");
    const token = randomBytes(32).toString("base64url");
    const grant: Grant = {
      kind: "delegated-assistant-thread",
      originEnvironmentId: input.originEnvironmentId,
      originNativeRevision: input.originNativeRevision,
      targetEnvironmentId: input.targetEnvironmentId,
      threadId: input.threadId,
      projectId: input.projectId,
      grantId: randomUUID(),
      tokenHash: hash(token),
      originPublicKey: input.originPublicKey,
      actions: [...input.actions],
      expiresAt: input.expiresAt,
      revoked: false,
    };
    await this.ports.store.atomic(async () => {
      if (input.expiresAt <= this.now()) throw new Error("Original Room source expired.");
      await this.ports.store.saveGrant(grant);
      await this.ports.store.saveReceipt(key, {
        signature,
        state: "completed",
        result: { grantId: grant.grantId },
      });
    });
    return { grantId: grant.grantId, token, expiresAt: grant.expiresAt };
  }
  /** Caller must be authenticated target native owner; returns only after admitted effects settle. */
  async revoke(grantId: string) {
    if (!identity(grantId)) throw new Error("Invalid grant identity.");
    this.closing.add(grantId);
    await this.ports.store.atomic(async () => {
      const grant = await this.ports.store.grant(grantId);
      if (!grant || grant.targetEnvironmentId !== this.ports.targetEnvironmentId)
        throw new Error("Delegation not found.");
      await this.ports.store.saveGrant({ ...grant, revoked: true });
    });
    if (this.active.get(grantId))
      await new Promise<void>((resolve) => {
        const waiting = this.drains.get(grantId) ?? [];
        waiting.push(resolve);
        this.drains.set(grantId, waiting);
      });
  }
  /** Native owner can reconcile lost issuance without ever recovering a secret. */
  async issueStatus(requestId: string) {
    if (!identity(requestId)) throw new Error("Invalid grant request identity.");
    const receipt = await this.ports.store.receipt(`delegation-issue:${requestId}`);
    if (!receipt) return { requestId, state: "unknown" };
    return {
      requestId,
      state: receipt.state === "pending" ? "uncertain" : receipt.state,
      ...(receipt.result ? { result: receipt.result } : {}),
    };
  }
  /** Caller is the authenticated target native coordinator; challenge is bound before origin signs it. */
  async challenge(input: {
    grantId: string;
    token: string;
    action: DelegatedRoomAction;
    requestId: string;
    input: Record<string, unknown>;
  }) {
    if (
      !identity(input.grantId) ||
      typeof input.token !== "string" ||
      !identity(input.requestId) ||
      !actionSet.has(input.action) ||
      !input.input ||
      typeof input.input !== "object" ||
      Array.isArray(input.input) ||
      Buffer.byteLength(JSON.stringify(input.input)) > 32768
    )
      throw new Error("Invalid delegated Room challenge.");
    const nonce = randomBytes(32).toString("hex");
    const expiresAt = this.now() + 20_000;
    await this.ports.store.atomic(async () => {
      const grant = await this.ports.store.grant(input.grantId);
      if (
        this.closing.has(input.grantId) ||
        !grant ||
        grant.revoked ||
        grant.expiresAt <= this.now() ||
        !grant.actions.includes(input.action)
      )
        throw new Error("Delegated Room authority unavailable.");
      if (
        !timingSafeEqual(Buffer.from(grant.tokenHash, "hex"), Buffer.from(hash(input.token), "hex"))
      )
        throw new Error("Delegated Room authority unavailable.");
      await this.ports.store.saveReceipt(`delegation-nonce:${input.grantId}:${nonce}`, {
        signature: hash([
          input.action,
          input.requestId,
          roomDelegationScopeHash(input.action, input.input),
        ]),
        state: "pending",
        expiresAt,
      });
    });
    return { nonce, expiresAt, scopeHash: roomDelegationScopeHash(input.action, input.input) };
  }
  async call(input: {
    grantId: string;
    token: string;
    originEnvironmentId: string;
    threadId: string;
    projectId: string;
    action: DelegatedRoomAction;
    requestId: string;
    input: Record<string, unknown>;
    attestation: RoomAttestation;
    signature: string;
  }) {
    if (
      ![
        input.grantId,
        input.originEnvironmentId,
        input.threadId,
        input.projectId,
        input.requestId,
      ].every(identity) ||
      !actionSet.has(input.action) ||
      typeof input.token !== "string" ||
      !input.input ||
      typeof input.input !== "object" ||
      Array.isArray(input.input) ||
      Buffer.byteLength(JSON.stringify(input.input)) > 32768
    )
      throw new Error("Invalid delegated Room operation.");
    if (this.closing.has(input.grantId)) throw new Error("Delegated Room authority unavailable.");
    this.active.set(input.grantId, (this.active.get(input.grantId) ?? 0) + 1);
    try {
      return await this.callActive(input);
    } finally {
      const remaining = (this.active.get(input.grantId) ?? 1) - 1;
      if (remaining) this.active.set(input.grantId, remaining);
      else {
        this.active.delete(input.grantId);
        for (const resolve of this.drains.get(input.grantId) ?? []) resolve();
        this.drains.delete(input.grantId);
      }
    }
  }
  private async callActive(input: {
    grantId: string;
    token: string;
    originEnvironmentId: string;
    threadId: string;
    projectId: string;
    action: DelegatedRoomAction;
    requestId: string;
    input: Record<string, unknown>;
    attestation: RoomAttestation;
    signature: string;
  }) {
    const origin = { environmentId: input.originEnvironmentId, threadId: input.threadId };
    const current = async () => {
      const grant = await this.ports.store.grant(input.grantId);
      if (
        this.closing.has(input.grantId) ||
        !grant ||
        grant.revoked ||
        grant.expiresAt <= this.now() ||
        grant.targetEnvironmentId !== this.ports.targetEnvironmentId ||
        grant.originEnvironmentId !== input.originEnvironmentId ||
        grant.threadId !== input.threadId ||
        grant.projectId !== input.projectId ||
        !grant.actions.includes(input.action)
      )
        return undefined;
      const expected = Buffer.from(grant.tokenHash, "hex"),
        actual = Buffer.from(hash(input.token), "hex");
      if (
        !timingSafeEqual(expected, actual) ||
        !(await this.ports.verifyOrigin(origin, grant.originPublicKey))
      )
        return undefined;
      const latest = await this.ports.store.grant(input.grantId);
      if (
        this.closing.has(input.grantId) ||
        !latest ||
        latest.revoked ||
        latest.expiresAt <= this.now() ||
        hash(latest) !== hash(grant)
      )
        return undefined;
      return grant;
    };
    const grant = await current();
    if (!grant) throw new Error("Delegated Room authority unavailable.");
    const proof = input.attestation;
    if (
      !proof ||
      proof.originEnvironmentId !== grant.originEnvironmentId ||
      proof.originNativeRevision !== grant.originNativeRevision ||
      proof.targetEnvironmentId !== grant.targetEnvironmentId ||
      proof.threadId !== grant.threadId ||
      proof.projectId !== grant.projectId ||
      proof.grantId !== grant.grantId ||
      proof.action !== input.action ||
      proof.requestId !== input.requestId ||
      proof.scopeHash !== roomDelegationScopeHash(input.action, input.input) ||
      !verifyRoomAttestation(grant.originPublicKey, proof, input.signature, this.now())
    )
      throw new Error("Invalid delegated Room attestation.");
    await this.ports.store.atomic(async () => {
      const nonceKey = `delegation-nonce:${grant.grantId}:${proof.nonce}`;
      const challenge = await this.ports.store.receipt(nonceKey);
      if (
        !challenge ||
        challenge.state !== "pending" ||
        challenge.expiresAt === undefined ||
        challenge.expiresAt <= this.now() ||
        proof.expiresAt > challenge.expiresAt ||
        challenge.signature !== hash([input.action, input.requestId, proof.scopeHash])
      )
        throw new Error("Delegated Room challenge is unavailable or already used.");
      await this.ports.store.saveReceipt(nonceKey, { ...challenge, state: "completed" });
    });
    const principal: DelegatedRoomPrincipal = {
      kind: grant.kind,
      originEnvironmentId: grant.originEnvironmentId,
      targetEnvironmentId: grant.targetEnvironmentId,
      threadId: grant.threadId,
      projectId: grant.projectId,
      grantId: grant.grantId,
    };
    const authorized = async () => !!(await current());
    if (readActions.has(input.action)) {
      const value = await this.ports.execute(
        input.action,
        input.input,
        principal,
        input.requestId,
        authorized,
      );
      if (!(await authorized())) throw new Error("Delegated Room authority revoked.");
      return value;
    }
    const signature = hash([input.action, input.input, principal]);
    const key = `delegation-operation:${grant.grantId}:${input.requestId}`;
    const previous = await this.ports.store.atomic(async () => {
      const saved = await this.ports.store.receipt(key);
      if (saved) {
        if (saved.signature !== signature)
          throw new Error("Request ID reused with different operation.");
        return saved;
      }
      await this.ports.store.saveReceipt(key, { signature, state: "pending" });
      return undefined;
    });
    if (previous)
      return {
        requestId: input.requestId,
        ...previous,
        state: previous.state === "pending" ? "uncertain" : previous.state,
      };
    try {
      const operation = {
        action: input.action,
        input: { principal, requestId: input.requestId, input: input.input },
        operationHash: signature,
      };
      const approval = await this.ports.approve(operation);
      if (!approval.approved || approval.operationHash !== signature || !(await authorized()))
        throw new Error("Exact native approval and live delegation required.");
      const result = await this.ports.execute(
        input.action,
        input.input,
        principal,
        input.requestId,
        authorized,
      );
      if (!(await authorized())) throw new Error("Delegated Room authority revoked.");
      const receipt: Receipt = { signature, state: "completed", result };
      await this.ports.store.atomic(() => this.ports.store.saveReceipt(key, receipt));
      return { requestId: input.requestId, ...receipt };
    } catch (error) {
      await this.ports.store.atomic(() =>
        this.ports.store.saveReceipt(key, { signature, state: "uncertain" }),
      );
      throw error;
    }
  }
}
