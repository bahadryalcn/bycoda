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
