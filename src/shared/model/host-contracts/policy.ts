/** The WS wire is negotiated independently from the legacy HTTP protocol. */
export const WS_SUBPROTOCOL = "bycoda.rpc.v2";
export const WS_WIRE_VERSION = 2;
export const HOST_SCHEMA_VERSION = 1;

/** Initial resource ceilings; domain-specific smaller limits still apply. */
export const WS_LIMITS = Object.freeze({
  maxMessageBytes: 1_048_576,
  streamChunkBytes: 65_536,
  maxPendingRpc: 64,
  maxAuthenticatedSockets: 64,
  maxSocketsPerDevice: 12,
  maxUnauthenticatedSockets: 16,
  maxUnauthenticatedSocketsPerSource: 4,
  maxAuthenticationJobs: 16,
  maxAuthenticationJobsPerSource: 4,
  maxReadJobs: 256,
  maxReadJobsPerDevice: 64,
  maxControlJobs: 64,
  maxControlJobsPerDevice: 8,
  handshakeTimeoutMs: 5_000,
  maxSubscriptionsPerSocket: 64,
  maxSubscriptionsPerHost: 512,
  maxUnacknowledgedEvents: 32,
  maxSubscriptionWindowBytes: 2_097_152,
  maxSocketQueuedBytes: 8_388_608,
  maxReplayEvents: 2_048,
  maxReplayBytes: 8_388_608,
  maxReplayAgeMs: 300_000,
  maxHostReplayBytes: 67_108_864,
  heartbeatIntervalMs: 25_000,
  heartbeatResponseTimeoutMs: 10_000,
  defaultResponseTimeoutMs: 12_000,
  defaultAdmissionTimeoutMs: 5_000,
  minResponseTimeoutMs: 1_000,
  maxResponseTimeoutMs: 600_000,
});

/** A physical transport owner schedules retries; views never own another loop. */
export const WS_RETRY_POLICY = Object.freeze({
  initialDelayMs: 250,
  maxDelayMs: 30_000,
  stableReadyMs: 30_000,
  jitter: "full" as const,
  blockedCategories: ["authentication", "identity", "schema"] as const,
});

export const RPC_ERROR_CODES = Object.freeze({
  parseError: -32700,
  invalidRequest: -32600,
  methodNotFound: -32601,
  invalidParams: -32602,
  internalError: -32603,
  unauthorized: -32001,
  wrongEnvironment: -32002,
  notReady: -32003,
  overloaded: -32004,
  deadlineExceeded: -32005,
  cancelled: -32006,
  resyncRequired: -32007,
  /** A pre-execution refusal (category "conflict", delivery "not-sent"). Retry once it clears. */
  conflict: -32008,
});
