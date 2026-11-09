/** Whether a row path is in the set; a missing path never is. */
export function hasMember(members: ReadonlySet<string>, path: string | null): boolean {
  return path !== null && members.has(path);
}

/** Whether a path set differs for any of this directory's immediate rows. */
export function membersChanged(
  before: ReadonlySet<string>,
  after: ReadonlySet<string>,
  members: ReadonlySet<string>,
): boolean {
  if (before === after) return false;
  if (members.size <= before.size + after.size) {
    for (const path of members) if (before.has(path) !== after.has(path)) return true;
    return false;
  }
  for (const path of before) if (!after.has(path) && members.has(path)) return true;
  for (const path of after) if (!before.has(path) && members.has(path)) return true;
  return false;
}
