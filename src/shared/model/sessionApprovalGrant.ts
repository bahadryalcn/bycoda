export const SESSION_APPROVAL_GRANTS_CAPABILITY = "sessions.approvalGrants.v1";

/** A trusted adapter names the exact tool and operation class. */
export const CLAUDE_WORKSPACE_GLOB = "claude:Glob:workspace-filename-search";

export type SessionApprovalScope = typeof CLAUDE_WORKSPACE_GLOB;
export type SessionApprovalGrant = { id: string; scope: SessionApprovalScope };
