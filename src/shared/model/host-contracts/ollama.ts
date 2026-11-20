import { z } from "zod";
import type { HostRpcMethodDefinition } from "./methods";

/** Bounds only: the wire manifest cannot carry a pattern, so the Host checks `isOllamaModelName`. */
export const OllamaModelNameSchema = z.string().min(1).max(200);

/** Ollama tags as `ollama pull` accepts them: `qwen2.5-coder:14b`, `hf.co/user/repo:Q4_K_M`. */
export function isOllamaModelName(name: string): boolean {
  return name.length <= 200 && /^[A-Za-z0-9][A-Za-z0-9._\-/:]*$/.test(name);
}

const OllamaModelSchema = z.strictObject({
  name: OllamaModelNameSchema,
  size: z.number().int().nonnegative(),
  parameterSize: z.string().max(32).optional(),
  /** Ollama reports `completion`; embedding-only models cannot chat. */
  chat: z.boolean(),
  /** Ollama reports `tools`; OpenCode needs tool calls to edit files and run commands. */
  tools: z.boolean(),
});

const OllamaPullSchema = z.strictObject({
  model: OllamaModelNameSchema,
  state: z.enum(["running", "done", "failed", "cancelled"]),
  completed: z.number().nonnegative(),
  total: z.number().nonnegative(),
  /** Ollama's own bounded message for a failed pull, such as an unknown model name. */
  error: z.string().max(300).optional(),
});

export const OllamaStatusSchema = z.strictObject({
  /** Loopback port the Host uses for Ollama; `portCustom` is false while it follows the default. */
  port: z.number().min(1).max(65535),
  portCustom: z.boolean(),
  runtime: z.enum(["missing", "stopped", "running"]),
  version: z.string().max(64).optional(),
  models: z.array(OllamaModelSchema).max(1000),
  pull: OllamaPullSchema.nullable(),
  opencode: z.strictObject({
    /**
     * `ready` covers a missing file. `comments` is readable JSONC that a rewrite would lose, so
     * it is never written; `invalid` and `unreadable` are not changed either.
     */
    config: z.enum(["ready", "comments", "invalid", "unreadable"]),
    /** Ollama models already listed under `provider.ollama.models`. */
    models: z.array(z.string().max(200)).max(1000),
  }),
});

export type OllamaStatus = z.infer<typeof OllamaStatusSchema>;
export type OllamaModel = OllamaStatus["models"][number];
export type OllamaPull = NonNullable<OllamaStatus["pull"]>;

const EmptyParamsSchema = z.strictObject({});

export const OLLAMA_RPC = {
  "ollama.status": { params: EmptyParamsSchema, result: OllamaStatusSchema, query: true },
  "ollama.start": { params: EmptyParamsSchema, result: OllamaStatusSchema, query: false },
  "ollama.pull.start": {
    params: z.strictObject({ model: OllamaModelNameSchema }),
    result: OllamaStatusSchema,
    query: false,
  },
  "ollama.pull.cancel": { params: EmptyParamsSchema, result: OllamaStatusSchema, query: false },
  /** `null` returns to the default: `OLLAMA_HOST`'s port, else 11434. */
  "ollama.port.set": {
    params: z.strictObject({ port: z.number().min(1).max(65535).nullable() }),
    result: OllamaStatusSchema,
    query: false,
  },
  "ollama.opencode.save": {
    params: z.strictObject({ models: z.array(OllamaModelNameSchema).max(100) }),
    result: OllamaStatusSchema,
    query: false,
  },
} as const;

export type OllamaMethod = keyof typeof OLLAMA_RPC;

/** Owner-RPC inventory for local Ollama models; the caller passes its workflow builder in. */
export function ollamaMethods(
  workflow: (
    requiredCapability: string,
    params: z.ZodType,
    result: z.ZodType,
    query?: boolean,
  ) => HostRpcMethodDefinition,
) {
  const operation = (method: OllamaMethod) => {
    const schema = OLLAMA_RPC[method];
    return workflow("ollama.v1", schema.params, schema.result, schema.query);
  };
  return {
    "ollama.status": operation("ollama.status"),
    // A cold Ollama can need several seconds before it answers.
    "ollama.start": { ...operation("ollama.start"), responseTimeoutMs: 45_000 },
    "ollama.pull.start": operation("ollama.pull.start"),
    "ollama.pull.cancel": operation("ollama.pull.cancel"),
    "ollama.port.set": operation("ollama.port.set"),
    "ollama.opencode.save": operation("ollama.opencode.save"),
  };
}
