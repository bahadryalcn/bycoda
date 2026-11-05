import { isTauri } from "@tauri-apps/api/core";
import { useCallback, useEffect, useRef, useState } from "react";
import { listenWindow } from "../../../platform/tauri/listenWindow";
import { t } from "../../../shared/i18n";
import { listSshForwards, type ForwardStatus } from "../model/sshForwards";

export type ForwardChanged = {
  machine: string;
  connectionId: string;
  forwardId: string;
  generation: string;
  revision: number;
};

/** Native owns forwards in this window. Events only invalidate their captured SSH profile. */
export function useForwardStatuses(source: string, active: boolean) {
  const [result, setResult] = useState<{
    source: string;
    statuses: ForwardStatus[];
    error: string;
  }>({ source, statuses: [], error: "" });
  const owner = useRef({ source, active });
  owner.current = { source, active };
  const sequence = useRef(0);
  const flight = useRef(false);
  const queued = useRef(false);
  const run = useRef<() => void>(() => {});
  const refresh = useCallback((expectedSource: string) => {
    if (owner.current.source !== expectedSource || !owner.current.active) return;
    ++sequence.current;
    if (document.hidden) return;
    if (flight.current) {
      queued.current = true;
      return;
    }
    run.current();
  }, []);
  useEffect(() => {
    if (!active || !source) return;
    let disposed = false;
    run.current = () => {
      if (disposed || document.hidden || flight.current) return;
      const request = ++sequence.current;
      flight.current = true;
      void listSshForwards()
        .then(
          (statuses) => {
            if (
              !disposed &&
              request === sequence.current &&
              owner.current.source === source &&
              owner.current.active
            )
              setResult({
                source,
                statuses: statuses.filter((item) => item.connectionId === source),
                error: "",
              });
          },
          () => {
            if (
              !disposed &&
              request === sequence.current &&
              owner.current.source === source &&
              owner.current.active
            )
              setResult((old) => ({
                source,
                statuses: old.source === source ? old.statuses : [],
                error: t("Couldn’t read forwarding status."),
              }));
          },
        )
        .finally(() => {
          flight.current = false;
          if (queued.current) {
            queued.current = false;
            run.current();
          }
        });
    };
    refresh(source);
    const release = isTauri()
      ? listenWindow<ForwardChanged>("ssh-forward-changed", ({ payload }) => {
          if (payload?.machine === "local" && payload.connectionId === source) refresh(source);
        })
      : () => {};
    const timer = window.setInterval(() => refresh(source), 30_000);
    const onVisibility = () => {
      if (!document.hidden) refresh(source);
      else ++sequence.current;
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      disposed = true;
      ++sequence.current;
      release();
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [source, active, refresh]);
  return {
    statuses: result.source === source ? result.statuses : [],
    statusError: result.source === source ? result.error : "",
    refresh,
  };
}
