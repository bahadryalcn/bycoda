/** Queue and command admission waits behind a reconnecting socket. Five seconds
 * drops work that the Host would accept once the connection is back. */
export const QUEUE_COMMAND_ADMISSION_TIMEOUT_MS = 90_000;
