/** Unsaved files are confirmed first; declining either step must leave the workspace intact. */
export async function confirmWorkspaceClose(
  unsaved?: () => Promise<boolean>,
  terminals?: () => Promise<boolean>,
): Promise<boolean> {
  if (unsaved && !(await unsaved())) return false;
  if (terminals && !(await terminals())) return false;
  return true;
}
