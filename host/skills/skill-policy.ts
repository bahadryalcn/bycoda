import {
  existsSync,
  linkSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
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
import { readStateFileSync, writeFileAtomicSync } from "../storage/atomic-write";

function withPolicyLock<T>(home: string, run: () => T): T {
  const dir = join(home, ".bycoda-host");
  mkdirSync(dir, { recursive: true });
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
    if (existsSync(lock)) {
      // Possessing the SQLite lock proves that no updated writer owns this v1
      // marker. Anonymous legacy sentinels have no such proof; preserve them.
      if (readFileSync(lock, "utf8") !== marker)
        throw new Error(
          "Another skill preference save is in progress. A legacy lock remains; close legacy writers and verify its owner before recovery.",
        );
      unlinkSync(lock);
    }
    const temporary = join(dir, `skill-policy-lock-${randomUUID()}.tmp`);
    writeFileSync(temporary, marker, { mode: 0o600 });
    try {
      // Atomic exclusive publication of initialized metadata also excludes old
      // writers. A crash cannot leave a newly created anonymous/empty sentinel.
      linkSync(temporary, lock);
    } finally {
      unlinkSync(temporary);
    }
    try {
      return run();
    } finally {
      unlinkSync(lock);
    }
  } finally {
    try {
      database.exec("ROLLBACK");
    } finally {
      database.close();
    }
  }
}

export function readSkillPolicy(home = homedir()): SkillPolicy {
  const file = join(home, ".bycoda-host", "skill-policy.json");
  // Corrupt/unreadable preferences must not silently re-enable every skill.
  try {
    // Corrupt policy stays in place and still fails closed; a copy is kept as evidence.
    const result = readStateFileSync(file, (text) => parseSkillPolicy(JSON.parse(text)), {
      quarantine: true,
    });
    if (result.status === "ok") return result.value;
    if (result.status === "corrupt")
      console.warn(
        `Skill policy is unreadable; retained evidence at ${result.quarantined ?? "an unavailable path"}. Skill restrictions stay fail-closed until it is repaired.`,
      );
    if (result.status === "missing" && !policyExists(file)) return { ...EMPTY_SKILL_POLICY };
  } catch {
    // Unreadable metadata or data is an unknown policy, not an empty one.
  }
  throw new Error(
    "Could not read bycoda skill restrictions. Repair the skill policy before continuing.",
  );
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

export function saveSkillPolicy(value: unknown, home = homedir()): SkillPolicy {
  const policy = parseSkillPolicy(value);
  const dir = join(home, ".bycoda-host");
  mkdirSync(dir, { recursive: true });
  const file = join(dir, "skill-policy.json");
  writeFileAtomicSync(file, JSON.stringify(policy), { mode: 0o600 });
  return policy;
}

export function setSkillEnabled(name: unknown, enabled: unknown, home = homedir()): SkillPolicy {
  if (
    typeof name !== "string" ||
    name.length > 300 ||
    !/^[\w.:-]+$/.test(name) ||
    typeof enabled !== "boolean"
  )
    throw new Error("Invalid skill preference");
  return withPolicyLock(home, () => {
    const policy = readSkillPolicy(home);
    policy.disabledNames = policy.disabledNames.filter((entry) => entry !== name);
    if (!enabled) policy.disabledNames.push(name);
    else
      policy.disabledPaths = policy.disabledPaths.filter((path) => skillNameForPath(path) !== name);
    return saveSkillPolicy(policy, home);
  });
}

export function migrateSkillPolicy(legacyPaths: unknown, home = homedir()): SkillPolicy {
  if (policyExists(join(home, ".bycoda-host", "skill-policy.json"))) return readSkillPolicy(home);
  return withPolicyLock(home, () => {
    if (policyExists(join(home, ".bycoda-host", "skill-policy.json"))) return readSkillPolicy(home);
    const disabledPaths = Array.isArray(legacyPaths)
      ? legacyPaths.filter(
          (value): value is string =>
            typeof value === "string" && !!value && !value.startsWith("remote://"),
        )
      : [];
    const disabledNames = disabledPaths.map(skillNameForPath).filter(Boolean);
    return saveSkillPolicy({ disabledNames, disabledPaths }, home);
  });
}
