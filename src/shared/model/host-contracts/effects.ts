/** Effect admission is independent of retries, cost, and read-like names. */
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
