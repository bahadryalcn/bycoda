export type NativeServiceKind = "conversation" | "runtime-logs" | "social";
/** Captured by actual paired-device composition; no token/hash is supplied by
 * method params, and scoped tool/peer credentials cannot acquire this port. */
export interface NativeServiceOwnerPorts {
  describe(kind: NativeServiceKind): Promise<unknown>;
  issue(kind: NativeServiceKind, sessionId: string, expectedScope: unknown): Promise<unknown>;
  appendTerminal(params: Record<string, unknown>): Promise<unknown>;
  desktop: {
    take(): Promise<unknown>;
    finish(id: string, result: unknown, error?: string): Promise<unknown>;
    authorize(id: string, action: string): Promise<unknown>;
  };
  social: {
    status(): Promise<unknown>;
    enroll(environmentId: string): Promise<unknown>;
    register(params: Record<string, unknown>): Promise<unknown>;
    authority(params: Record<string, unknown>): Promise<unknown>;
    reset(): Promise<unknown>;
  };
  format(params: Record<string, unknown>): Promise<unknown>;
}
