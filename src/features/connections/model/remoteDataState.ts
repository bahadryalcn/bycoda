/** Content verification is separate from transport connectivity. */
export type RemoteDataState = {
  phase: "loading" | "refreshing" | "ready" | "empty" | "error" | "stale";
  error?: string;
  /** Local time of the last successful owner read, not a host modification time. */
  updatedAt?: number;
};
