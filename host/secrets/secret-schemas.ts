const ref = { type: "string", minLength: 1, maxLength: 100, pattern: "^[A-Za-z0-9_-]{1,100}$" };
const object = (properties: Record<string, unknown>, required: string[]) => ({
  type: "object",
  properties,
  required,
  additionalProperties: false,
});

export const SECRET_TOOLS = {
  "secrets.request": object(
    {
      requestId: ref,
      name: { type: "string", minLength: 1, maxLength: 80 },
      purpose: { type: "string", minLength: 1, maxLength: 300 },
      ttlMinutes: { type: "integer", minimum: 1, maximum: 1440 },
      replace: { type: "boolean" },
    },
    ["requestId", "name", "purpose"],
  ),
  "secrets.materialize": object({ secretRef: ref }, ["secretRef"]),
  "secrets.run": object(
    {
      command: { type: "string", minLength: 1, maxLength: 8192 },
      env: {
        type: "object",
        minProperties: 1,
        maxProperties: 8,
        propertyNames: { pattern: "^[A-Z_][A-Z0-9_]{0,63}$" },
        additionalProperties: ref,
      },
      timeoutSeconds: { type: "integer", minimum: 1, maximum: 100 },
    },
    ["command", "env"],
  ),
  "secrets.list": object({}, []),
  "secrets.revoke": object({ secretRef: ref }, ["secretRef"]),
};
export type SecretTool = keyof typeof SECRET_TOOLS;
export const isSecretTool = (action: string): action is SecretTool =>
  Object.hasOwn(SECRET_TOOLS, action);
export const describeSecretTool = (action: string): string | undefined =>
  isSecretTool(action)
    ? "Call secrets.request whenever a credential is needed; never ask for it in chat. The owner types it into an in-app dialog and the result is only a secretRef, name and expiry (or cancelled), never the value. Secrets persist for the project until the owner removes them (ttlMinutes optional), so request reuses an existing secret of the same name without prompting; replace:true asks again. Prefer secrets.run: it runs a command in the project directory with env NAME=secretRef injected, the values never enter the agent shell, and output is redacted. Use secrets.materialize only when the command must run in the agent's own shell; it writes an owner-only file whose path is returned and which is deleted after 10 minutes. List shows metadata, never values; revoke deletes."
    : undefined;

export type SecretRequestInput = {
  requestId: string;
  name: string;
  purpose: string;
  ttlMinutes?: number;
  replace: boolean;
};

export type SecretRunInput = {
  command: string;
  env: Record<string, string>;
  timeoutSeconds: number;
};

const REQUEST_ID = /^[A-Za-z0-9_-]{1,100}$/;
const SECRET_REF = /^[A-Za-z0-9_-]{1,100}$/;
const CONTROL = /[\u0000-\u001f\u007f]/;

function text(input: Record<string, unknown>, key: string, max: number): string {
  const value = input[key];
  if (typeof value !== "string" || !value.trim() || value.length > max || CONTROL.test(value))
    throw new Error(`Invalid ${key}.`);
  return value;
}

export function parseSecretRequest(input: Record<string, unknown>): SecretRequestInput {
  const requestId = input.requestId;
  if (typeof requestId !== "string" || !REQUEST_ID.test(requestId))
    throw new Error("Invalid requestId.");
  const ttl = input.ttlMinutes;
  if (
    ttl !== undefined &&
    (!Number.isSafeInteger(ttl) || (ttl as number) < 1 || (ttl as number) > 1440)
  )
    throw new Error("Invalid ttlMinutes.");
  if (input.replace !== undefined && typeof input.replace !== "boolean")
    throw new Error("Invalid replace.");
  return {
    requestId,
    name: text(input, "name", 80),
    purpose: text(input, "purpose", 300),
    ...(ttl === undefined ? {} : { ttlMinutes: ttl as number }),
    replace: input.replace === true,
  };
}

const ENV_NAME = /^[A-Z_][A-Z0-9_]{0,63}$/;

export function parseSecretRun(input: Record<string, unknown>): SecretRunInput {
  const command = input.command;
  if (
    typeof command !== "string" ||
    !command.trim() ||
    command.length > 8192 ||
    command.includes("\u0000")
  )
    throw new Error("Invalid command.");
  const raw = input.env;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("Invalid env.");
  const entries = Object.entries(raw as Record<string, unknown>);
  if (entries.length < 1 || entries.length > 8) throw new Error("Invalid env.");
  const env: Record<string, string> = {};
  for (const [name, ref] of entries) {
    if (!ENV_NAME.test(name)) throw new Error("Invalid env name.");
    if (typeof ref !== "string" || !SECRET_REF.test(ref)) throw new Error("Invalid secretRef.");
    env[name] = ref;
  }
  // The session RPC deadline (120 s, mcp-http.ts) must outlive the command and its kill grace.
  const timeout = input.timeoutSeconds ?? 60;
  if (!Number.isSafeInteger(timeout) || (timeout as number) < 1 || (timeout as number) > 100)
    throw new Error("Invalid timeoutSeconds.");
  return { command, env, timeoutSeconds: timeout as number };
}

export function parseSecretRef(input: Record<string, unknown>): string {
  const value = input.secretRef;
  if (typeof value !== "string" || !SECRET_REF.test(value)) throw new Error("Invalid secretRef.");
  return value;
}
