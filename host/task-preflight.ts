import { constants } from "node:fs";
import { access, lstat, realpath } from "node:fs/promises";
import { join, relative, sep, win32 } from "node:path";
import {
  parseTaskPreflightRequirements,
  taskPreflightResourceKey,
  type TaskPreflightFacts,
  type TaskPreflightObservation,
  type TaskPreflightRequirement,
} from "../src/features/tasks/model/taskPreflight";

type Options = {
  now?: () => number;
  /** Only a trusted host adapter may supply runtime observations; never use retrieved text here. */
  observe?: (
    requirement: TaskPreflightRequirement,
  ) => Promise<TaskPreflightObservation | undefined>;
};
const restricted = (part: string) =>
  /^(?:\.env(?:\..*)?|\.git|\.ssh|\.aws|\.gnupg|\.bycoda(?:-host)?|\.npmrc|\.pypirc|\.netrc|\.git-credentials|id_(?:rsa|dsa|ecdsa|ed25519)(?:\..*)?|credentials(?:\.[^.]+)?|secrets?(?:\.[^.]+)?)$/i.test(
    part,
  ) || /\.(?:pem|key|p12|pfx)$/i.test(part);

/** Checks local access only. It never installs tools, changes permissions or reads source contents. */
export async function checkTaskPreflight(
  cwd: string,
  rawRequirements: readonly TaskPreflightRequirement[],
  options: Options = {},
): Promise<NonNullable<TaskPreflightFacts["resources"]>> {
  const requirements = parseTaskPreflightRequirements(rawRequirements);
  const result: NonNullable<TaskPreflightFacts["resources"]> = {};
  const now = options.now ?? Date.now;
  const observation = (
    state: TaskPreflightObservation["state"],
    detail: string,
  ): TaskPreflightObservation => ({ state, detail, checkedAt: now(), origin: "runtime" });
  let root: string | undefined;
  try {
    root = await realpath(cwd);
    await access(root, constants.R_OK);
  } catch {
    // An unreadable project is unknown; it is never treated as an empty source collection.
  }
  for (const requirement of requirements) {
    const key = taskPreflightResourceKey(requirement);
    if (requirement.kind !== "source" || /^[a-z][a-z\d+.-]*:\/\//i.test(requirement.id)) {
      let value: TaskPreflightObservation | undefined;
      try {
        value = await options.observe?.(requirement);
      } catch {
        /* Unknown does not grant access. */
      }
      result[key] = value ?? observation("unknown", "Runtime access has not been checked.");
      continue;
    }
    const parts = requirement.id.replaceAll("\\", "/").split("/");
    if (
      /^[\\/~]/.test(requirement.id) ||
      win32.isAbsolute(requirement.id) ||
      /^[a-z]:/i.test(requirement.id) ||
      parts.some((part) => part === ".." || restricted(part)) ||
      /[<>*?|:]/.test(requirement.id)
    ) {
      result[key] = observation(
        "disabled",
        "Use a project-relative source path without credentials or links.",
      );
      continue;
    }
    if (!root) {
      result[key] = observation("unknown", "The project folder could not be checked.");
      continue;
    }
    let current = root;
    try {
      for (const part of parts.filter((part) => part && part !== ".")) {
        current = join(current, part);
        const info = await lstat(current);
        if (info.isSymbolicLink()) throw new Error("Source links are not followed.");
      }
      const resolved = await realpath(current);
      const rel = relative(root, resolved);
      if (rel === ".." || rel.startsWith(`..${sep}`) || win32.isAbsolute(rel))
        throw new Error("Source escaped its project.");
      await access(current, constants.R_OK);
      result[key] = observation("ready", "The source is readable on this host.");
    } catch (error) {
      result[key] =
        (error as NodeJS.ErrnoException).code === "ENOENT"
          ? observation("missing", "The source is missing on this host.")
          : observation("disabled", "The source cannot be safely accessed on this host.");
    }
  }
  return result;
}
