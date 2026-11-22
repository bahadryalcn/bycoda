import { useDecisionTarget } from "./DecisionTarget";
import { Text } from "../../../shared/ui/Text";
import { useEffect, useState } from "react";
import { t } from "../../../shared/i18n";
import { formatBytes } from "../../../shared/i18n/format";
import { Button } from "../../../shared/ui/Button";
import { InlineMessage } from "../../../shared/ui/InlineError";
import { Modal, ModalActions } from "../../../shared/ui/Modal";
import { Progress } from "../../../shared/ui/Progress";
import { Stepper, type StepperStep } from "../../../shared/ui/Stepper";
import { useLocalInstall } from "../hooks/useLocalInstall";
import type { DecisionModelsClient } from "../model/decisionModelsClient";
import type {
  DecisionCatalogEntry,
  HardwareInfo,
  InstallState,
  LocalPlan,
  LocalRecommendation,
} from "../model/decisionTypes";
import {
  catalogLabel,
  formatHardware,
  localOffer,
  recommendationText,
} from "../model/decisionView";
import { ErrorNotice } from "./ErrorNotice";

type Loaded = { hardware: HardwareInfo; recommendation: LocalRecommendation };

/** Bytes received so far. Indeterminate until the Host reports them, or when no file size is known. */
function InstallProgress({ progress }: { progress: InstallState["progress"] | null }) {
  if (!progress) return <Progress label={t("Installing…")} />;
  if (progress.bytesTotal <= 0)
    return <Progress label={t("Downloading {p1}…", { p1: formatBytes(progress.bytesDone) })} />;
  return (
    <Progress
      value={Math.min(progress.bytesDone, progress.bytesTotal)}
      max={progress.bytesTotal}
      label={t("Downloading {p1} of {p2}…", {
        p1: formatBytes(progress.bytesDone),
        p2: formatBytes(progress.bytesTotal),
      })}
    />
  );
}

/**
 * Local install in two steps: this computer with its recommendation, then an explicit install.
 * An insufficient machine never gets an install button; the API path is offered instead.
 */
export function LocalInstallWizard({
  client,
  catalog,
  onChooseApi,
  onInstalled,
  onClose,
}: {
  client: DecisionModelsClient;
  catalog: DecisionCatalogEntry[] | null;
  onChooseApi: () => void;
  onInstalled: () => void;
  onClose: () => void;
}) {
  const target = useDecisionTarget();
  const [step, setStep] = useState(0);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [attempt, setAttempt] = useState(0);
  const [plan, setPlan] = useState<LocalPlan | null>(null);
  const [planError, setPlanError] = useState<unknown>(null);
  const [planAttempt, setPlanAttempt] = useState(0);

  useEffect(() => {
    let alive = true;
    void Promise.all([client.local.hardware({}), client.local.recommend({})]).then(
      ([hardware, recommendation]) => {
        if (alive) setLoaded({ hardware, recommendation });
      },
      (error: unknown) => {
        if (alive) setLoadError(error);
      },
    );
    return () => {
      alive = false;
      setLoadError(null);
    };
  }, [client, attempt]);

  const offer = localOffer(loaded?.recommendation);
  const modelId = loaded?.recommendation.modelId;
  const model = catalog?.find((entry) => entry.id === modelId);
  const modelName = model ? catalogLabel(model) : (modelId ?? "");

  // The plan only reads the catalog and the disk; nothing is downloaded until Install is confirmed.
  useEffect(() => {
    if (!modelId || offer !== "install") return;
    let alive = true;
    void client.local.plan({ modelId }).then(
      (result) => {
        if (alive) setPlan(result);
      },
      (error: unknown) => {
        if (alive) setPlanError(error);
      },
    );
    return () => {
      alive = false;
      setPlan(null);
      setPlanError(null);
    };
  }, [client, modelId, offer, planAttempt]);

  const readyToInstall = plan !== null && plan.installable && plan.fits && planError === null;
  const local = useLocalInstall({ client, modelId, onInstalled });
  const { installing, result, error: installError } = local;
  const install = () => {
    if (readyToInstall) local.install();
  };
  const [wasInstalling, setWasInstalling] = useState(installing);
  if (wasInstalling !== installing) {
    setWasInstalling(installing);
    if (installing) setStep(1);
  }

  const steps: StepperStep[] = [
    { id: "recommendation", label: t("Recommendation") },
    {
      id: "install",
      label: t("Install"),
      error: installError !== null ? t("Install did not finish.") : undefined,
    },
  ];
  const installed = result?.state === "installed" || result?.state === "running";
  // One primary action per step keeps the footer a single decision.
  const planBlocked = plan !== null && (!plan.installable || !plan.fits);
  const primary =
    step === 0 && offer === "install" && !planBlocked
      ? { label: t("Continue"), disabled: !readyToInstall, onClick: () => setStep(1) }
      : step === 0 && (offer === "api" || planBlocked)
        ? { label: t("Choose an API provider"), onClick: onChooseApi }
        : step === 0
          ? { label: t("Continue"), disabled: true, onClick: () => setStep(1) }
          : step === 1 && !installed
            ? {
                label: t("Install"),
                loading: installing,
                disabled: installing || !modelId || !readyToInstall || result !== null,
                onClick: install,
              }
            : step === 1 && installed
              ? { label: t("Done"), onClick: onClose }
              : null;

  return (
    <Modal
      title={target ? t("Install on Host {p1}", { p1: target }) : t("Install on this computer")}
      description={
        target
          ? t("A local model runs on Host {p1} and needs no key.", { p1: target })
          : t("A local model runs on this computer and needs no key.")
      }
      size="lg"
      height="tall"
      onClose={onClose}
      closeDisabled={installing}
      footer={
        <ModalActions>
          <Button variant="ghost" disabled={installing} onClick={onClose}>
            {t("Cancel")}
          </Button>
          <Button
            variant="ghost"
            disabled={step === 0 || installing}
            onClick={() => setStep(step - 1)}
          >
            {t("Back")}
          </Button>
          {primary ? (
            <Button
              variant="primary"
              loading={primary.loading}
              disabled={primary.disabled}
              onClick={primary.onClick}
            >
              {primary.label}
            </Button>
          ) : null}
        </ModalActions>
      }
    >
      <div className="flex min-w-0 flex-col gap-4">
        <Stepper steps={steps} current={step} label={t("Install steps")} />
        {step === 0 ? (
          <div className="flex min-w-0 flex-col gap-2">
            {loadError !== null ? (
              <ErrorNotice
                title={t("Could not check this computer.")}
                error={loadError}
                onRetry={() => setAttempt((value) => value + 1)}
              />
            ) : null}
            {loaded === null && loadError === null ? (
              <Progress
                label={
                  target ? t("Checking Host {p0}…", { p0: target }) : t("Checking this computer…")
                }
              />
            ) : null}
            {loaded ? (
              <Text as="ul" className="flex min-w-0 flex-col gap-1">
                {formatHardware(loaded.hardware).map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </Text>
            ) : null}
          </div>
        ) : null}
        {step === 0 && loaded ? (
          <div className="flex min-w-0 flex-col gap-2">
            <p>{recommendationText(loaded.recommendation.tier)}</p>
            {offer === "install" ? (
              <>
                <Text as="p" size="caption" tone="secondary">
                  {t("Model: {p0}", { p0: modelName })}
                </Text>
                {planError !== null ? (
                  <ErrorNotice
                    error={planError}
                    title={t("Could not prepare the install.")}
                    onRetry={() => setPlanAttempt((value) => value + 1)}
                  />
                ) : null}
                {plan === null && planError === null ? (
                  <Progress
                    label={
                      target
                        ? t("Checking Host {p0}…", { p0: target })
                        : t("Checking this computer…")
                    }
                  />
                ) : null}
                {plan !== null && !plan.installable ? (
                  <InlineMessage tone="warning">
                    {t("No verified download exists for this model yet.")}
                  </InlineMessage>
                ) : null}
                {plan !== null && plan.installable && !plan.fits ? (
                  <InlineMessage tone="warning">
                    {t("Not enough free disk space: {p1} needed.", {
                      p1: formatBytes(plan.downloadBytes),
                    })}
                  </InlineMessage>
                ) : null}
                {plan !== null && plan.installable && plan.fits ? (
                  <InlineMessage tone="neutral">
                    {t("Download {p1}. Free disk space: {p2}.", {
                      p1: formatBytes(plan.downloadBytes),
                      p2: formatBytes(plan.freeDiskBytes),
                    })}
                  </InlineMessage>
                ) : null}
              </>
            ) : null}
            {offer === "unknown" ? (
              <InlineMessage tone="neutral">
                {target
                  ? t("No local model is listed for Host {p1} yet.", { p1: target })
                  : t("No local model is listed for this computer yet.")}
              </InlineMessage>
            ) : null}
          </div>
        ) : null}
        {step === 1 ? (
          <div className="flex min-w-0 flex-col gap-2">
            {result === null && !installing && installError === null && !local.cancelled ? (
              <p>
                {target
                  ? t("Install {p1} on Host {p2}?", { p1: modelName, p2: target })
                  : t("Install {p1} on this computer?", { p1: modelName })}
              </p>
            ) : null}
            {installing ? <InstallProgress progress={local.progress} /> : null}
            {installing && local.canCancel ? (
              <div className="flex">
                <Button
                  variant="secondary"
                  size="sm"
                  loading={local.cancelling}
                  onClick={local.cancel}
                >
                  {local.cancelling ? t("Cancelling…") : t("Cancel install")}
                </Button>
              </div>
            ) : null}
            {local.cancelled ? (
              <InlineMessage tone="neutral">
                {t("Install cancelled. Nothing was kept.")}
              </InlineMessage>
            ) : null}
            {installed ? (
              <InlineMessage tone="success">
                {t("Installed. You can start it from the source list.")}
              </InlineMessage>
            ) : null}
            {result !== null && !installed ? (
              <InlineMessage tone="warning">
                {t("The local install did not complete.")}
              </InlineMessage>
            ) : null}
            {installError !== null ? (
              <ErrorNotice error={installError} onRetry={install} retrying={installing} />
            ) : null}
          </div>
        ) : null}
      </div>
    </Modal>
  );
}
