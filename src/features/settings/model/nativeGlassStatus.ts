/** Native window glass sync status, read by the settings UI. */
export type NativeGlassOutcome = { applied: boolean; restartRequired: boolean };

let nativeGlassError = false;
let nativeGlassPending = false;
let nativeGlassRestartRequired = false;
const NATIVE_GLASS_EVENT = "bycoda:native-glass-status";

export function readNativeGlassError() {
  return nativeGlassError;
}
export function readNativeGlassPending() {
  return nativeGlassPending;
}
export function readNativeGlassRestartRequired() {
  return nativeGlassRestartRequired;
}
export function subscribeNativeGlassStatus(listener: () => void) {
  window.addEventListener(NATIVE_GLASS_EVENT, listener);
  return () => window.removeEventListener(NATIVE_GLASS_EVENT, listener);
}
export function setNativeGlassStatus(
  value: boolean,
  pending: boolean,
  restartRequired = nativeGlassRestartRequired,
) {
  nativeGlassError = value;
  nativeGlassPending = pending;
  nativeGlassRestartRequired = restartRequired;
  window.dispatchEvent(new Event(NATIVE_GLASS_EVENT));
}
