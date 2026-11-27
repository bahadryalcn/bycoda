import { lstatSync, mkdirSync } from "node:fs";
import { link, lstat, mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import {
  EMPTY_SKILL_POLICY,
  parseSkillPolicy,
  type SkillPolicy,
} from "../../src/integrations/harness/core/skillPolicy";
import { skillNameForPath } from "./skills";
import {
  readStateFile,
  readStateFileSync,
  writeFileAtomic,
  writeFileAtomicSync,
  type StateFileResult,
} from "../storage/atomic-write";

const UNREADABLE =
  "Could not read bycoda skill restrictions. Repair the skill policy before continuing.";

function policyDir(home: string): string {
  return join(home, ".bycoda-host");
}

function policyFile(home: string): string {
  return join(policyDir(home), "skill-policy.json");
}

function parsePolicyText(text: string): SkillPolicy {
  return parseSkillPolicy(JSON.parse(text));
}

// Same-process mutations run one after another, so the SQLite lock below only ever
// rejects a rival process. Cross-process writers still get the "in progress" error.
let policyMutations: Promise<unknown> = Promise.resolve();
function serializePolicyMutation<T>(run: () => Promise<T>): Promise<T> {
  const next = policyMutations.then(run);
  policyMutations = next.catch(() => undefined);
  return next;
}

async function readPolicyLockMarker(lock: string): Promise<string | undefined> {
  try {
    return await readFile(lock, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

async function withPolicyLock<T>(home: string, run: () => Promise<T>): Promise<T> {
  const dir = policyDir(home);
  await mkdir(dir, { recursive: true });
  const lock = join(dir, "skill-policy.lock");
  const marker = "bycoda-sqlite-policy-lock-v1\n";
  const database = new DatabaseSync(join(dir, "skill-policy-lock.sqlite3"));
  try {
    // Native and host share this OS-released lock. Never unlink the database.
    database.exec("PRAGMA busy_timeout = 0; BEGIN IMMEDIATE");
  } catch {
    database.close();
    throw new Error("Another skill preference save is in progress. Try again after it finishes.");
  }
  try {
    const existing = await readPolicyLockMarker(lock);
    if (existing !== undefined) {
      // Possessing the SQLite lock proves that no updated writer owns this v1
      // marker. Anonymous legacy sentinels have no such proof; preserve them.
      if (existing !== marker)
        throw new Error(
          "Another skill preference save is in progress. A legacy lock remains; close legacy writers and verify its owner before recovery.",
        );
      await unlink(lock);
    }
    const temporary = join(dir, `skill-policy-lock-${randomUUID()}.tmp`);
    await writeFile(temporary, marker, { mode: 0o600 });
    try {
      // Atomic exclusive publication of initialized metadata also excludes old
      // writers. A crash cannot leave a newly created anonymous/empty sentinel.
      await link(temporary, lock);
    } finally {
      await unlink(temporary);
    }
    try {
      return await run();
    } finally {
      await unlink(lock);
    }
  } finally {
    try {
      database.exec("ROLLBACK");
    } finally {
      database.close();
    }
  }
}

function policyFromState(result: StateFileResult<SkillPolicy>, present: boolean): SkillPolicy {
  if (result.status === "ok") return result.value;
  if (result.status === "corrupt")
    console.warn(
      `Skill policy is unreadable; retained evidence at ${result.quarantined ?? "an unavailable path"}. Skill restrictions stay fail-closed until it is repaired.`,
    );
  if (result.status === "missing" && !present) return { ...EMPTY_SKILL_POLICY };
  throw new Error(UNREADABLE);
}

function policyExists(file: string): boolean {
  try {
    lstatSync(file);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

async function policyExistsAsync(file: string): Promise<boolean> {
  try {
    await lstat(file);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

export function readSkillPolicy(home = homedir()): SkillPolicy {
  const file = policyFile(home);
  // Corrupt/unreadable preferences must not silently re-enable every skill.
  try {
    // Corrupt policy stays in place and still fails closed; a copy is kept as evidence.
    const result = readStateFileSync(file, parsePolicyText, { quarantine: true });
    return policyFromState(result, result.status === "missing" && policyExists(file));
  } catch {
    // Unreadable metadata or data is an unknown policy, not an empty one.
    throw new Error(UNREADABLE);
  }
}

/** Non-blocking read for request paths; same fail-closed contract as readSkillPolicy. */
export async function readSkillPolicyAsync(home = homedir()): Promise<SkillPolicy> {
  const file = policyFile(home);
  try {
    const result = await readStateFile(file, parsePolicyText, { quarantine: true });
    return policyFromState(result, result.status === "missing" && (await policyExistsAsync(file)));
  } catch {
    throw new Error(UNREADABLE);
  }
}

export function saveSkillPolicy(value: unknown, home = homedir()): SkillPolicy {
  const policy = parseSkillPolicy(value);
  mkdirSync(policyDir(home), { recursive: true });
  writeFileAtomicSync(policyFile(home), JSON.stringify(policy), { mode: 0o600 });
  return policy;
}

async function saveSkillPolicyAsync(value: unknown, home: string): Promise<SkillPolicy> {
  const policy = parseSkillPolicy(value);
  await mkdir(policyDir(home), { recursive: true });
  await writeFileAtomic(policyFile(home), JSON.stringify(policy), { mode: 0o600 });
  return policy;
}

export async function setSkillEnabled(
  name: unknown,
  enabled: unknown,
  home = homedir(),
): Promise<SkillPolicy> {
  if (
    typeof name !== "string" ||
    name.length > 300 ||
    !/^[\w.:-]+$/.test(name) ||
    typeof enabled !== "boolean"
  )
    throw new Error("Invalid skill preference");
  return serializePolicyMutation(() =>
    withPolicyLock(home, async () => {
      const policy = await readSkillPolicyAsync(home);
      policy.disabledNames = policy.disabledNames.filter((entry) => entry !== name);
      if (!enabled) policy.disabledNames.push(name);
      else
        policy.disabledPaths = policy.disabledPaths.filter(
          (path) => skillNameForPath(path) !== name,
        );
      return saveSkillPolicyAsync(policy, home);
    }),
  );
}

export async function migrateSkillPolicy(
  legacyPaths: unknown,
  home = homedir(),
): Promise<SkillPolicy> {
  if (await policyExistsAsync(policyFile(home))) return readSkillPolicyAsync(home);
  return serializePolicyMutation(() =>
    withPolicyLock(home, async () => {
      if (await policyExistsAsync(policyFile(home))) return readSkillPolicyAsync(home);
      const disabledPaths = Array.isArray(legacyPaths)
        ? legacyPaths.filter(
            (value): value is string =>
              typeof value === "string" && !!value && !value.startsWith("remote://"),
          )
        : [];
      const disabledNames = disabledPaths.map(skillNameForPath).filter(Boolean);
      return saveSkillPolicyAsync({ disabledNames, disabledPaths }, home);
    }),
  );
}
