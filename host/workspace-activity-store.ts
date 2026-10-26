import type { WorkspaceActivity, WorkspaceReservation } from "./workspace-contracts";

/** Host-local durable admission state. Implementations atomically reject activities
 * and reservations belonging to the same workspace. Unknown surviving activity is
 * retained until its owner explicitly reconciles/stops it. */
export interface WorkspaceActivityPersistence {
  load(): Promise<{ activities: WorkspaceActivity[]; reservations: WorkspaceReservation[] }>;
  saveActivity(activity: WorkspaceActivity): Promise<void>;
  removeActivity(activityId: string): Promise<void>;
  saveReservation(reservation: WorkspaceReservation): Promise<void>;
  removeReservation(reservationId: string): Promise<void>;
}

export interface WorkspaceActivityReconciliation {
  released: string[];
  blocked: { activityId: string; reason: string }[];
}

/** Startup may exclude the journal whose recovery needs this process fence;
 * all other pending operations still prevent activity retirement. */
export interface WorkspaceActivityReconciliationRequest {
  workspaceId?: string;
  operationId?: string;
}
