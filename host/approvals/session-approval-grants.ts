import { isAbsolute } from "node:path";
import type { HostSession } from "../../src/features/connections/model/protocol";
import {
  CLAUDE_WORKSPACE_GLOB,
  type SessionApprovalGrant,
  type SessionApprovalScope,
} from "../../src/shared/model/sessionApprovalGrant";

export function sessionApprovalOwner(value: HostSession, cwd: string): string | undefined {
  const { session } = value;
  if (
    value.archived ||
    value.executionOwner === "desktop" ||
    session.harness !== "claude" ||
    !isAbsolute(cwd)
  )
    return undefined;
  return JSON.stringify([
    session.id,
    value.authorityGeneration,
    value.projectId,
    session.workspaceId,
    cwd,
    session.providerAccountId,
  ]);
}

/** Runtime authority only. Transcript blocks, copies and command receipts cannot restore it. */
export class SessionApprovalGrants {
  private entries = new Map<string, { owner: string; grant: SessionApprovalGrant }>();

  list(id: string, owner: string | undefined): SessionApprovalGrant[] {
    const entry = this.entries.get(id);
    return entry && entry.owner === owner ? [entry.grant] : [];
  }

  allows(id: string, owner: string, scope: SessionApprovalScope): boolean {
    return this.list(id, owner).some((grant) => grant.scope === scope);
  }

  allow(id: string, owner: string, scope: SessionApprovalScope, occurrenceId: string): void {
    if (scope === CLAUDE_WORKSPACE_GLOB) {
      this.entries.set(id, { owner, grant: { id: occurrenceId, scope } });
    }
  }

  revoke(id: string, owner: string | undefined, grantId: string): void {
    if (this.list(id, owner).some((grant) => grant.id === grantId)) this.entries.delete(id);
  }

  end(id: string): void {
    this.entries.delete(id);
  }

  clear(): void {
    this.entries.clear();
  }
}
