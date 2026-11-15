import { invoke } from "@tauri-apps/api/core";

/**
 * Copies a provider transcript from one local provider account to another so
 * the same provider thread id can be resumed. Resolves false when the source
 * transcript cannot be found (callers should fall back to a summary handoff).
 */
export async function transferProviderSession(input: {
  provider: "claude" | "codex" | "grok";
  fromAccountId?: string;
  toAccountId?: string;
  providerSessionId: string;
  cwd: string;
}): Promise<boolean> {
  // Grok Build transcripts live in its own session store; there is no copy
  // path yet, so callers fall back to a summary handoff.
  if (input.provider === "grok") return false;
  return invoke<boolean>("provider_transfer_session", {
    provider: input.provider,
    fromAccountId: input.fromAccountId ?? null,
    toAccountId: input.toAccountId ?? null,
    providerSessionId: input.providerSessionId,
    cwd: input.cwd,
  });
}
