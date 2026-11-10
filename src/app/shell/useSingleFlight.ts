import { useRef } from "react";

/** Runs one async job at a time; a call made while a job is running is ignored. */
export function useSingleFlight(onError: (error: unknown) => void) {
  const running = useRef(false);
  return (job: () => Promise<void>) => {
    if (running.current) return;
    running.current = true;
    job()
      .catch(onError)
      .finally(() => {
        running.current = false;
      });
  };
}
