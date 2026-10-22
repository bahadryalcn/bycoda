import { useEffect, useRef, useSyncExternalStore } from "react";
import { phonePairingApi } from "./phonePairingApi";
import { PhonePairingCoordinator } from "./phonePairingCoordinator";
import type { PhonePairingApi } from "./phonePairingTypes";

export function usePhonePairing(api: PhonePairingApi = phonePairingApi) {
  const coordinatorRef = useRef<PhonePairingCoordinator | null>(null);
  if (!coordinatorRef.current) {
    coordinatorRef.current = new PhonePairingCoordinator(api);
  }
  const coordinator = coordinatorRef.current;
  const state = useSyncExternalStore(coordinator.subscribe, coordinator.getSnapshot);
  const pairingId = state.stage === "qr" ? state.session.pairingId : undefined;

  useEffect(() => () => coordinator.close(), [coordinator]);

  // The host owns pairing acceptance; timers only observe it and expire the QR.
  useEffect(() => {
    if (!pairingId) return;
    const clock = setInterval(coordinator.tick, 1_000);
    const poll = setInterval(() => {
      if (!document.hidden) void coordinator.check();
    }, 2_000);
    const onVisible = () => {
      coordinator.tick();
      if (!document.hidden) void coordinator.check();
    };
    document.addEventListener("visibilitychange", onVisible);
    void coordinator.check();
    return () => {
      clearInterval(clock);
      clearInterval(poll);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [coordinator, pairingId]);

  return { state, coordinator };
}
