import { invoke } from "@tauri-apps/api/core";

/**
 * Copies a provider transcript from one local provider account to another so
 * the same provider thread id can be resumed. Resolves false when the source
 * transcript cannot be found (callers should fall back to a summary handoff).
 */
export async function transferProviderSession(input: {
  provider: "claude" | "codex";
  fromAccountId?: string;
  toAccountId?: string;
  providerSessionId: string;
  cwd: string;
}): Promise<boolean> {
  return invoke<boolean>("provider_transfer_session", {
    provider: input.provider,
    fromAccountId: input.fromAccountId ?? null,
    toAccountId: input.toAccountId ?? null,
    providerSessionId: input.providerSessionId,
    cwd: input.cwd,
  });
}
