import { invoke } from "@tauri-apps/api/core";

// gh's plain GraphQL errors do not carry reset headers. In that case wait
// conservatively, rather than repeatedly spending requests on an exhausted account.
const RATE_LIMIT_WAIT_MS = 60 * 60_000;
const blocks = new Map<string, { until: number; message: string }>();

export async function withGithubRead<T>(work: () => Promise<T>, scope = "local"): Promise<T> {
  const block = blocks.get(scope);
  if (block && Date.now() < block.until) throw new Error(block.message);
  try {
    return await work();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/rate limit|secondary rate|abuse detection/i.test(message)) {
      const until = Date.now() + RATE_LIMIT_WAIT_MS;
      const paused = `${message} Automatic GitHub reads paused until ${new Date(until).toLocaleTimeString()}.`;
      blocks.set(scope, { until, message: paused });
      throw new Error(paused);
    }
    throw error;
  }
}

export async function githubRead<T>(command: string, args: Record<string, unknown>): Promise<T> {
  return withGithubRead(() => invoke<T>(command, args));
}
