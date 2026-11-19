import { redactDiagnosticText } from "@bycoda/account-contracts";
import { JsonRpcResponseError } from "./jsonRpc";

/** JSON-RPC 2.0 "Method not found": the agent does not implement the request at all. */
const METHOD_NOT_FOUND = -32601;

function diagnosticDetail(error: unknown): string {
  return redactDiagnosticText(error instanceof Error ? error.message : String(error));
}

export type ControlFailureOptions = {
  /**
   * The request was a speculative probe for a control the agent never advertised,
   * so any answered JSON-RPC rejection means "not applicable here". Transport
   * failures and timeouts are still rethrown.
   */
  probe?: boolean;
};

/**
 * Settles a failed ACP control request (`session/set_model`, `set_mode`,
 * `set_config_option`) before a turn runs.
 *
 * Only "method not found" (-32601) is an optional capability the agent lacks,
 * so only that is swallowed. Every other failure means the selected model, mode
 * or setting was not applied, and continuing would run the turn with the wrong
 * configuration without telling the user: a JSON-RPC rejection is rethrown as a
 * `JsonRpcResponseError` with the same code and the agent's own message, and any
 * other error (timeout, closed pipe) is rethrown untouched. Text that reaches
 * logs or the thrown error has secrets redacted.
 */
export function ignoreMissingControlMethod(
  provider: string,
  method: string,
  error: unknown,
  options: ControlFailureOptions = {},
): void {
  if (!(error instanceof JsonRpcResponseError)) {
    console.debug(`[bycoda] ${provider} ${method} failed`, diagnosticDetail(error));
    throw error;
  }
  if (error.code === METHOD_NOT_FOUND || options.probe) {
    console.debug(
      `[bycoda] ${provider} ${method} ignored (${error.code})`,
      diagnosticDetail(error),
    );
    return;
  }
  console.debug(`[bycoda] ${provider} ${method} rejected (${error.code})`, diagnosticDetail(error));
  throw new JsonRpcResponseError(
    `${provider} ${method} rejected: ${diagnosticDetail(error)}`,
    error.code,
  );
}
