/** Client-side compatibility names. Only canonical names appear on the WS wire. */
export const HOST_RPC_METHOD_ALIASES = Object.freeze({
  "goals.final-review.recheck": "goals.finalReview.recheck",
} as const);

export function hostRpcWireMethod(method: string): string {
  return Object.prototype.hasOwnProperty.call(HOST_RPC_METHOD_ALIASES, method)
    ? HOST_RPC_METHOD_ALIASES[method as keyof typeof HOST_RPC_METHOD_ALIASES]
    : method;
}
