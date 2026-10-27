/** Match native admission semantics; retry policy and method-name prefixes do not establish effects. */
export function hostRpcHasEffect(method: string, kind: string): boolean {
  return (
    kind !== "query" &&
    kind !== "subscription" &&
    !(
      kind === "control" &&
      ["connection.hello", "connection.probe", "requests.cancel"].includes(method)
    )
  );
}
