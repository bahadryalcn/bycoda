export type NativeServiceKind = "conversation" | "runtime-logs" | "social";
export type NativeAssistantPresence = {
  state: "present" | "idle" | "away" | "dnd";
  /** The owner's own choice; `state` also reflects this computer's idle or away reading. */
  choice?: "present" | "away" | "dnd";
  assistantName?: string;
  setupComplete: boolean;
};
/** Captured by actual paired-device composition; no token/hash is supplied by
 * method params, and scoped tool/peer credentials cannot acquire this port. */
export interface NativeServiceOwnerPorts {
  executeAssistantBackground?(
    input: {
      environmentId: string;
      threadId: string;
      operationId: string;
      operationHash: string;
      challenge: string;
      relayId: string;
    },
    current: () => boolean,
  ): Promise<unknown>;
  browserPanel?(input: Record<string, unknown>): Promise<unknown>;
  observationsIngest?(input: Record<string, unknown>): Promise<unknown>;
  delegation?(
    action:
      | "publicKey"
      | "origin"
      | "nativeChallenge"
      | "attest"
      | "issue"
      | "issue.status"
      | "challenge"
      | "call"
      | "revoke",
    input: Record<string, unknown>,
  ): Promise<unknown>;
  visibilityEpoch?(): Promise<{ epoch: number }>;
  visibilityRevoke?(): Promise<{ epoch: number }>;
  visibilityReopen?(input: Record<string, unknown>): Promise<{ epoch: number }>;
  authorizeAssistantNotification?(input: {
    threadId: string;
    notificationId: string;
    operationHash: string;
  }): Promise<{ authorized: boolean }>;
  authorizeAssistantWorkspace?(input: {
    threadId: string;
    requestId: string;
    operationHash: string;
  }): Promise<{ authorized: boolean }>;
  assistantPresence?(): Promise<NativeAssistantPresence>;
  setAssistantPresence?(state: "present" | "away" | "dnd"): Promise<NativeAssistantPresence>;
  desktopStatus?(): Promise<{
    enabled: boolean;
    active: boolean;
    stopped: boolean;
    currentAction?: { app: string; action: string };
    assistantName?: string;
  }>;
  waitDesktopStatus?(
    afterRevision: string,
    timeoutMs: number,
    signal?: AbortSignal,
  ): Promise<{ revision: string }>;
  stopDesktop?(): Promise<{ stopped: true }>;
  describe(kind: NativeServiceKind): Promise<unknown>;
  issue(kind: NativeServiceKind, sessionId: string, expectedScope: unknown): Promise<unknown>;
  appendTerminal(params: Record<string, unknown>): Promise<unknown>;
  terminalDemand?(params: Record<string, unknown>): Promise<unknown>;
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
