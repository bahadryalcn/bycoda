import { randomBytes } from "node:crypto";
import { mkdir, readdir } from "node:fs/promises";
import { join } from "node:path";
import { readStateFile, writeFileAtomic } from "../storage/atomic-write";
import { OsSocialCredentials } from "../social/social-credentials";
import { removeSecretFile, restrictSecretDirectory, writeSecretFile } from "./secret-file";

export const MAX_SECRETS = 64;
const MAX_REQUESTS = 256;
const SWEEP_MS = 60_000;
/** A materialized file outlives neither this window nor its secret. */
export const FILE_TTL_MS = 10 * 60_000;
const UNAVAILABLE = "Secret store unavailable.";

/** Values live only here. Implementations must not place them in errors. */
export type SecretValueStore = {
  get(ref: string): Promise<string | undefined>;
  set(ref: string, value: string): Promise<void>;
  delete(ref: string): Promise<void>;
};

export type SecretRecord = {
  secretRef: string;
  sessionId: string;
  projectId: string;
  requestId: string;
  name: string;
  purpose: string;
  createdAt: number;
  /** `null` keeps the secret until the owner or the project revokes it. */
  expiresAt: number | null;
  materialized: boolean;
  filePath?: string;
  fileExpiresAt?: number;
};
export type SecretOutcome =
  | { secretRef: string; name: string; expiresAt: number | null; reused?: true }
  | { cancelled: true };
export type SecretRequestRecord = {
  sessionId: string;
  requestId: string;
  signature: string;
  outcome: SecretOutcome;
  createdAt: number;
};
export type SecretView = Pick<
  SecretRecord,
  "secretRef" | "name" | "purpose" | "createdAt" | "expiresAt"
> & {
  materialized: boolean;
};
/** What the owner sees across all projects; never a value. */
export type OwnerSecretView = Pick<
  SecretRecord,
  "secretRef" | "projectId" | "name" | "purpose" | "createdAt" | "expiresAt"
> & { materialized: boolean };
type State = { version: 1; secrets: SecretRecord[]; requests: SecretRequestRecord[] };

const isString = (value: unknown): value is string => typeof value === "string";
const isNumber = (value: unknown): value is number => Number.isSafeInteger(value);

function parseState(text: string): State {
  const parsed: unknown = JSON.parse(text);
  if (!parsed || typeof parsed !== "object") throw new Error("Invalid secret state.");
  const state = parsed as Partial<State>;
  if (state.version !== 1 || !Array.isArray(state.secrets) || !Array.isArray(state.requests))
    throw new Error("Invalid secret state.");
  for (const record of state.secrets) {
    if (
      !isString(record.secretRef) ||
      !isString(record.sessionId) ||
      !isString(record.projectId) ||
      !isString(record.requestId) ||
      !isString(record.name) ||
      !isString(record.purpose) ||
      !isNumber(record.createdAt) ||
      (record.expiresAt !== null && !isNumber(record.expiresAt)) ||
      typeof record.materialized !== "boolean"
    )
      throw new Error("Invalid secret state.");
  }
  return state as State;
}

const emptyState = (): State => ({ version: 1, secrets: [], requests: [] });
const bounded = (requests: SecretRequestRecord[]) => requests.slice(-MAX_REQUESTS);
const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
const isLive = (record: SecretRecord, now: number) =>
  record.expiresAt === null || record.expiresAt > now;
const view = (record: SecretRecord): SecretView => ({
  secretRef: record.secretRef,
  name: record.name,
  purpose: record.purpose,
  createdAt: record.createdAt,
  expiresAt: record.expiresAt,
  materialized: record.materialized,
});

/** Metadata in a state file, values in the OS-backed vault, files under `files/`.
 * Every operation runs through one queue, so expiry is checked before each one. */
export class SecretStore {
  private queue: Promise<unknown> = Promise.resolve();
  private state?: State;
  private readonly timer: ReturnType<typeof setInterval>;
  private readonly now: () => number;
  private readonly stateFile: string;
  private readonly filesDirectory: string;
  /** Startup cleanup: expired entries and orphan files are removed before the first operation. */
  readonly ready: Promise<void>;

  constructor(
    private readonly options: {
      directory: string;
      values: SecretValueStore;
      now?: () => number;
      /** Test seam for the platform ACL step; production uses the owner-only restriction. */
      restrict?: (path: string) => Promise<void>;
      /** Test seam for the secrets directory ACL (Windows only in production). */
      restrictDirectory?: (path: string) => Promise<void>;
    },
  ) {
    this.now = options.now ?? Date.now;
    this.stateFile = join(options.directory, "state.json");
    this.filesDirectory = join(options.directory, "files");
    this.ready = this.locked(async (state) => {
      await this.protectDirectory();
      await this.removeOrphanFiles(state);
    }).then(
      () => undefined,
      () => undefined,
    );
    this.timer = setInterval(() => {
      void this.locked(() => undefined).catch(() => undefined);
    }, SWEEP_MS);
    this.timer.unref();
  }

  close(): void {
    clearInterval(this.timer);
  }

  private locked<T>(task: (state: State) => Promise<T> | T): Promise<T> {
    const run = this.queue
      .catch(() => undefined)
      .then(async () => {
        const state = await this.sweep(await this.load());
        return await task(state);
      });
    this.queue = run;
    return run;
  }

  private async load(): Promise<State> {
    if (this.state) return this.state;
    const result = await readStateFile(this.stateFile, parseState);
    if (result.status === "corrupt") throw new Error(UNAVAILABLE);
    this.state = result.status === "ok" ? result.value : emptyState();
    return this.state;
  }

  private async commit(next: State): Promise<void> {
    await writeFileAtomic(this.stateFile, JSON.stringify(next), { mode: 0o600 });
    this.state = next;
  }

  private fileFor(secretRef: string): string {
    return join(this.filesDirectory, secretRef);
  }

  private async purge(record: SecretRecord): Promise<void> {
    await this.options.values.delete(record.secretRef);
    await removeSecretFile(this.fileFor(record.secretRef));
  }

  /** Expired records lose their value and file before any read; expired materialized files
   * are deleted while their secret stays. A failed purge stays recorded and is retried, and an
   * expired secret is never served. */
  private async sweep(state: State): Promise<State> {
    const now = this.now();
    const fileDue = (record: SecretRecord) =>
      record.materialized && (record.fileExpiresAt ?? 0) <= now;
    if (!state.secrets.some((record) => !isLive(record, now) || fileDue(record))) return state;
    const remaining: SecretRecord[] = [];
    for (const record of state.secrets) {
      if (!isLive(record, now)) {
        try {
          await this.purge(record);
        } catch {
          remaining.push(record);
        }
        continue;
      }
      if (fileDue(record)) {
        try {
          await removeSecretFile(this.fileFor(record.secretRef));
          const cleared: SecretRecord = { ...record, materialized: false };
          delete cleared.filePath;
          delete cleared.fileExpiresAt;
          remaining.push(cleared);
        } catch {
          remaining.push(record);
        }
        continue;
      }
      remaining.push(record);
    }
    const next = { ...state, secrets: remaining };
    await this.commit(next);
    return next;
  }

  /** Best effort: a directory that cannot be restricted still has owner-only files and a vault. */
  private async protectDirectory(): Promise<void> {
    try {
      await mkdir(this.options.directory, { recursive: true });
      await (this.options.restrictDirectory ?? restrictSecretDirectory)(this.options.directory);
    } catch {
      /* nothing sensitive to record; files are restricted individually */
    }
  }

  private async removeOrphanFiles(state: State): Promise<void> {
    const known = new Set(state.secrets.map((record) => record.secretRef));
    let names: string[];
    try {
      names = await readdir(this.filesDirectory);
    } catch {
      return;
    }
    for (const name of names) {
      if (known.has(name) || !/^[A-Za-z0-9_-]+$/.test(name)) continue;
      await removeSecretFile(this.fileFor(name)).catch(() => undefined);
    }
  }

  async findRequest(
    sessionId: string,
    requestId: string,
  ): Promise<SecretRequestRecord | undefined> {
    return this.locked((state) =>
      state.requests.find(
        (entry) => entry.sessionId === sessionId && entry.requestId === requestId,
      ),
    );
  }

  async recordRequest(entry: Omit<SecretRequestRecord, "createdAt">): Promise<void> {
    await this.locked(async (state) => {
      await this.commit({
        ...state,
        requests: bounded([...state.requests, { ...entry, createdAt: this.now() }]),
      });
    });
  }

  /** Stores a value the owner typed. The caller drops its copy after this resolves. */
  async create(input: {
    sessionId: string;
    projectId: string;
    requestId: string;
    signature: string;
    name: string;
    purpose: string;
    /** Omitted: the secret persists until revoked. */
    ttlMinutes?: number;
    value: string;
    /** A secret of this project that this one supersedes on success. */
    replaceRef?: string;
  }): Promise<SecretOutcome> {
    return this.locked(async (state) => {
      const old = input.replaceRef
        ? state.secrets.find(
            (entry) => entry.secretRef === input.replaceRef && entry.projectId === input.projectId,
          )
        : undefined;
      const inProject = state.secrets.filter((entry) => entry.projectId === input.projectId);
      if (inProject.length - (old ? 1 : 0) >= MAX_SECRETS)
        throw new Error("Too many secrets are stored; revoke one first.");
      const now = this.now();
      const secretRef = `sec_${randomBytes(24).toString("base64url")}`;
      const expiresAt = input.ttlMinutes === undefined ? null : now + input.ttlMinutes * 60_000;
      try {
        await this.options.values.set(secretRef, input.value);
      } catch {
        throw new Error("Secret could not be saved.");
      }
      const outcome: SecretOutcome = { secretRef, name: input.name, expiresAt };
      const record: SecretRecord = {
        secretRef,
        sessionId: input.sessionId,
        projectId: input.projectId,
        requestId: input.requestId,
        name: input.name,
        purpose: input.purpose,
        createdAt: now,
        expiresAt,
        materialized: false,
      };
      try {
        await this.commit({
          ...state,
          secrets: [...state.secrets.filter((entry) => entry !== old), record],
          requests: bounded([
            ...state.requests,
            {
              sessionId: input.sessionId,
              requestId: input.requestId,
              signature: input.signature,
              outcome,
              createdAt: now,
            },
          ]),
        });
      } catch {
        await this.options.values.delete(secretRef).catch(() => undefined);
        throw new Error("Secret could not be saved.");
      }
      // The new secret is durable; drop the superseded one (best effort, its record is gone).
      if (old) await this.purge(old).catch(() => undefined);
      return outcome;
    });
  }

  private own(state: State, projectId: string, secretRef: string): SecretRecord {
    const record = state.secrets.find(
      (entry) => entry.secretRef === secretRef && entry.projectId === projectId,
    );
    if (!record) throw new Error("Secret is not available in this project.");
    return record;
  }

  async list(projectId: string): Promise<SecretView[]> {
    return this.locked((state) =>
      state.secrets.filter((record) => record.projectId === projectId).map(view),
    );
  }

  /** The live secret of this project with that name (trimmed, case-insensitive), if any. */
  async findByName(projectId: string, name: string): Promise<SecretView | undefined> {
    return this.locked((state) => {
      const record = state.secrets.find(
        (entry) =>
          entry.projectId === projectId && isLive(entry, this.now()) && sameName(entry.name, name),
      );
      return record ? view(record) : undefined;
    });
  }

  private async readValue(secretRef: string): Promise<string> {
    let value: string | undefined;
    try {
      value = await this.options.values.get(secretRef);
    } catch {
      throw new Error(UNAVAILABLE);
    }
    if (value === undefined) throw new Error("Secret value is unavailable; request it again.");
    return value;
  }

  /** Values for refs of this project, for injection into a command. Callers must not log them. */
  async readValues(
    projectId: string,
    secretRefs: readonly string[],
  ): Promise<{ secretRef: string; name: string; value: string }[]> {
    return this.locked(async (state) => {
      const found: { secretRef: string; name: string; value: string }[] = [];
      for (const secretRef of secretRefs) {
        const record = this.own(state, projectId, secretRef);
        found.push({ secretRef, name: record.name, value: await this.readValue(secretRef) });
      }
      return found;
    });
  }

  /** Values of the project's live secrets, for redaction. Unreadable ones are skipped. */
  async liveValues(projectId: string): Promise<{ name: string; value: string }[]> {
    return this.locked(async (state) => {
      const found: { name: string; value: string }[] = [];
      for (const record of state.secrets) {
        if (record.projectId !== projectId || !isLive(record, this.now())) continue;
        try {
          const value = await this.options.values.get(record.secretRef);
          if (value) found.push({ name: record.name, value });
        } catch {
          /* unreadable values cannot be injected either */
        }
      }
      return found;
    });
  }

  async listAll(): Promise<OwnerSecretView[]> {
    return this.locked((state) =>
      state.secrets.map((record) => ({ ...view(record), projectId: record.projectId })),
    );
  }

  async materialize(
    projectId: string,
    secretRef: string,
  ): Promise<{ path: string; expiresAt: number }> {
    return this.locked(async (state) => {
      const record = this.own(state, projectId, secretRef);
      const value = await this.readValue(secretRef);
      const path = this.fileFor(secretRef);
      try {
        await writeSecretFile(path, value, this.options.restrict);
      } catch {
        throw new Error("Secret file could not be written.");
      }
      const fileExpiresAt = this.now() + FILE_TTL_MS;
      await this.commit({
        ...state,
        secrets: state.secrets.map((entry) =>
          entry === record
            ? { ...entry, materialized: true, filePath: path, fileExpiresAt }
            : entry,
        ),
      });
      return { path, expiresAt: fileExpiresAt };
    });
  }

  async revoke(
    projectId: string,
    secretRef: string,
  ): Promise<{ revoked: true; secretRef: string }> {
    return this.locked((state) => this.remove(state, this.own(state, projectId, secretRef)));
  }

  /** Owner removal from Settings: no session or project check. */
  async ownerRevoke(secretRef: string): Promise<void> {
    await this.locked(async (state) => {
      const record = state.secrets.find((entry) => entry.secretRef === secretRef);
      if (record) await this.remove(state, record);
    });
  }

  private async remove(
    state: State,
    record: SecretRecord,
  ): Promise<{ revoked: true; secretRef: string }> {
    try {
      await this.purge(record);
    } catch {
      throw new Error("Secret could not be revoked.");
    }
    await this.commit({ ...state, secrets: state.secrets.filter((entry) => entry !== record) });
    return { revoked: true, secretRef: record.secretRef };
  }
}

/** The social vault's generic token slot; keyed separately from social and tunnels. */
export function osSecretValues(directory: string, environmentId: string): SecretValueStore {
  const vault = new OsSocialCredentials(join(directory, "vault"), `${environmentId}.secrets`);
  return {
    async get(ref) {
      return (await vault.get(ref))?.accessToken;
    },
    set: (ref, value) => vault.set(ref, { accessToken: value }),
    delete: (ref) => vault.delete(ref),
  };
}
