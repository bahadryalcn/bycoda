import { classifyRemoteError } from "../../connections/public/remoteFailure";

/** The Host refused an edit because the task or steward changed in another client
 * after this editor opened it (`assertExpectedConfiguration`). Nothing was saved. */
export function isConfigurationConflict(reason: unknown): boolean {
  return /^Configuration changed in another client\b/.test(classifyRemoteError(reason).message);
}
