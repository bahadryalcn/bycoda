/** Prompt rules every agent prompt shares: workers, crew members, automations, planners, reviewers. */

/** The reply a run with no owner at hand gives instead of stopping to ask. */
export const UNATTENDED_RULE =
  "This task runs unattended and the owner is unavailable. Do not stop to ask questions: when something is ambiguous, choose the most reasonable option within the task scope, record the assumption and finish. Stop only when a permission, credential or destructive action you are not authorized to take is required. The host-assigned agent and model satisfy any model requirement in the task text.";

/** Work in the checkout other sessions use; the owner reviews the uncommitted result. */
export function sharedCheckoutRule(cwd: string): string {
  return `Work directly in ${cwd}, the selected checkout shared with other sessions. Preserve their uncommitted work and change only your assigned scope. Do not create another worktree or switch branches. Leave changes uncommitted for the owner's review; do not stage, commit, merge or push.`;
}

/** Work on an owned branch; the owner approves delivery separately. */
export function branchWorkRule(cwd: string, branch?: string): string {
  return `Work only in ${cwd}${branch ? ` on ${branch}` : ""}. Commit scoped changes on this branch and finish with a clean tree. Never merge, push or create PRs; the owner approves delivery separately.`;
}

/** Planners and reviewers read the project and never change it. */
export function readOnlyRule(verb: "read" | "inspect"): string {
  return `Only ${verb}: do not edit, create or delete files, and do not commit.`;
}
