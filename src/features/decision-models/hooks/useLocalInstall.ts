import { useEffect, useState } from "react";
import { t } from "../../../shared/i18n";
import { useStableCallback } from "../../../shared/hooks/useStableCallback";
import { DECISION_INSTALL_CONFIRMATION } from "../../../shared/model/host-contracts/decision-models";
import type { DecisionModelsClient } from "../model/decisionModelsClient";
import type { InstallState, LocalStatus } from "../model/decisionTypes";

const POLL_MS = 1_000;
/** Consecutive failed progress reads before the install is reported as unreachable. */
const MAX_POLL_FAILURES = 5;

export type LocalInstall = {
  installing: boolean;
  /** Bytes of a tracked install. Null until the Host reports them, and on a Host that only awaits the install. */
  progress: InstallState["progress"] | null;
  result: LocalStatus | null;
  error: unknown;
  cancelled: boolean;
  /** A cancel was sent and the Host has not yet reported the end of the install. */
  cancelling: boolean;
  /** The Host can report progress and cancel (`DECISION_INSTALL_CAPABILITY`). */
  canCancel: boolean;
  install: () => void;
  cancel: () => void;
};

/**
 * One local-model install. A Host that advertises the install capability starts it and answers at
 * once; the install then runs on the Host, so this hook polls its progress and can cancel it, and a
 * reopened window picks a running install up again. An older Host only has the awaited install call:
 * no bytes, no cancel. Nothing is downloaded until `install` is called.
 */
export function useLocalInstall(options: {
  client: DecisionModelsClient;
  modelId: string | undefined;
  onInstalled: () => void;
}): LocalInstall {
  const { client, modelId } = options;
  const onInstalled = useStableCallback(options.onInstalled);
  const [installing, setInstalling] = useState(false);
  const [tracked, setTracked] = useState(false);
  const [progress, setProgress] = useState<InstallState["progress"] | null>(null);
  const [result, setResult] = useState<LocalStatus | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [cancelled, setCancelled] = useState(false);
  const [cancelling, setCancelling] = useState(false);

  const apply = useStableCallback((state: InstallState) => {
    if (state.state === "running") {
      setTracked(true);
      setInstalling(true);
      setProgress(state.progress ?? null);
      return;
    }
    setTracked(false);
    setInstalling(false);
    setCancelling(false);
    if (state.state === "installed") {
      setResult({ state: "installed" });
      onInstalled();
    } else if (state.state === "cancelled") setCancelled(true);
    // `idle` after a start means the Host lost the install (restart): it did not finish.
    else setError(new Error(state.error ?? t("Install did not finish.")));
  });

  // oxlint-disable-next-line bycoda/effect-names-its-sync -- Resume displaying an install that is already running on the Host.
  useEffect(() => {
    if (!modelId) return;
    let alive = true;
    void Promise.resolve()
      .then(() => client.local.installSupported())
      .then((supported) => (supported ? client.local.installProgress({ modelId }) : undefined))
      .then((state) => {
        if (alive && state?.state === "running") apply(state);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [client, modelId, apply]);

  // oxlint-disable-next-line bycoda/effect-names-its-sync -- Poll the Host for the tracked install's progress until it ends.
  useEffect(() => {
    if (!tracked || !modelId) return;
    let alive = true;
    let failures = 0;
    const timer = setInterval(() => {
      void client.local.installProgress({ modelId }).then(
        (state) => {
          failures = 0;
          if (alive) apply(state);
        },
        (failure: unknown) => {
          failures += 1;
          if (!alive || failures < MAX_POLL_FAILURES) return;
          setError(failure);
          setTracked(false);
          setInstalling(false);
          setCancelling(false);
        },
      );
    }, POLL_MS);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [client, modelId, tracked, apply]);

  const install = () => {
    if (!modelId || installing) return;
    const input = { modelId, confirm: DECISION_INSTALL_CONFIRMATION } as const;
    setError(null);
    setCancelled(false);
    setProgress(null);
    setInstalling(true);
    void Promise.resolve()
      .then(() => client.local.installSupported())
      .catch(() => false)
      .then(async (supported) => {
        if (supported) {
          apply(await client.local.installStart(input));
          return;
        }
        const status = await client.local.install(input);
        setResult(status);
        setInstalling(false);
        if (status.state === "installed" || status.state === "running") onInstalled();
      })
      .catch((failure: unknown) => {
        setError(failure);
        setTracked(false);
        setInstalling(false);
      });
  };

  const cancel = () => {
    if (!modelId || !tracked || cancelling) return;
    setCancelling(true);
    void client.local.cancelInstall({ modelId }).then(
      // The poll reports the end; a cancel that found nothing to stop ends the wait now.
      (answer) => {
        if (!answer.cancelled) setCancelling(false);
      },
      (failure: unknown) => {
        setCancelling(false);
        setError(failure);
      },
    );
  };

  return {
    installing,
    progress,
    result,
    error,
    cancelled,
    cancelling,
    canCancel: tracked,
    install,
    cancel,
  };
}
