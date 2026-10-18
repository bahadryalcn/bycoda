import { OPEN_CONNECTIONS_EVENT } from "./connections";

const ADD_MACHINE = "bycoda:add-machine";
let requested = false;

/** Open the existing machine setup flow, including its native security prompts. */
export function requestMachineAdd() {
  requested = true;
  window.dispatchEvent(new Event(ADD_MACHINE));
  window.dispatchEvent(new Event(OPEN_CONNECTIONS_EVENT));
}

export function takeMachineAddRequest() {
  const pending = requested;
  requested = false;
  return pending;
}

export function subscribeMachineAddRequests(listener: () => void) {
  window.addEventListener(ADD_MACHINE, listener);
  return () => window.removeEventListener(ADD_MACHINE, listener);
}
