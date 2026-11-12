import { Text } from "../../../shared/ui/Text";
import { useEffect, useState } from "react";
import { t } from "../../../shared/i18n";
import { formatBytes } from "../../../shared/i18n/format";
import { DECISION_INSTALL_CONFIRMATION } from "../../../shared/model/host-contracts/decision-models";
import { Button } from "../../../shared/ui/Button";
import { InlineMessage } from "../../../shared/ui/InlineError";
import { Modal, ModalActions } from "../../../shared/ui/Modal";
import { Progress } from "../../../shared/ui/Progress";
import { Stepper, type StepperStep } from "../../../shared/ui/Stepper";
import type { DecisionModelsClient } from "../model/decisionModelsClient";
import type {
  DecisionCatalogEntry,
  HardwareInfo,
  LocalPlan,
  LocalRecommendation,
  LocalStatus,
} from "../model/decisionTypes";
import {
  catalogLabel,
  formatHardware,
  localOffer,
  recommendationText,
} from "../model/decisionView";
import { ErrorNotice } from "./ErrorNotice";

type Loaded = { hardware: HardwareInfo; recommendation: LocalRecommendation };

/**
 * Local install in three steps: this computer, the recommendation, then an explicit install.
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
  const [step, setStep] = useState(0);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [attempt, setAttempt] = useState(0);
  const [installing, setInstalling] = useState(false);
  const [result, setResult] = useState<LocalStatus | null>(null);
  const [installError, setInstallError] = useState<unknown>(null);
  const [plan, setPlan] = useState<LocalPlan | null>(null);
  const [planError, setPlanError] = useState<unknown>(null);

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
  }, [client, modelId, offer]);

  const install = () => {
    if (!modelId) return;
    setInstallError(null);
    setInstalling(true);
    void client.local
      .install({ modelId, confirm: DECISION_INSTALL_CONFIRMATION })
      .then(
        (status) => {
          setResult(status);
          if (status.state === "installed" || status.state === "running") onInstalled();
        },
        (error: unknown) => setInstallError(error),
      )
      .finally(() => setInstalling(false));
  };

  const steps: StepperStep[] = [
    { id: "computer", label: t("This computer") },
    { id: "recommendation", label: t("Recommendation") },
    {
      id: "install",
      label: t("Install"),
      error: installError !== null ? t("Install did not finish.") : undefined,
    },
  ];
  const installed = result?.state === "installed" || result?.state === "running";

  return (
    <Modal
      title={t("Install on this computer")}
      description={t("A local model runs on this computer and needs no key.")}
      size="lg"
      onClose={onClose}
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
          {step === 0 ? (
            <Button variant="primary" disabled={!loaded} onClick={() => setStep(1)}>
              {t("Continue")}
            </Button>
          ) : null}
          {step === 1 && offer === "install" ? (
            <Button variant="primary" onClick={() => setStep(2)}>
              {t("Continue")}
            </Button>
          ) : null}
          {step === 1 && offer === "api" ? (
            <Button variant="primary" onClick={onChooseApi}>
              {t("Choose an API provider")}
            </Button>
          ) : null}
          {step === 2 && !installed ? (
            <Button
              variant="primary"
              loading={installing}
              disabled={installing || !modelId || result !== null}
              onClick={install}
            >
              {t("Install")}
            </Button>
          ) : null}
          {step === 2 && installed ? (
            <Button variant="primary" onClick={onClose}>
              {t("Done")}
            </Button>
          ) : null}
        </ModalActions>
      }
    >
      <div className="flex min-w-0 flex-col gap-4">
        <Stepper steps={steps} current={step} label={t("Install steps")} compact />
        {step === 0 ? (
          <div className="flex min-w-0 flex-col gap-2">
            {loadError !== null ? (
              <ErrorNotice error={loadError} onRetry={() => setAttempt((value) => value + 1)} />
            ) : null}
            {loaded === null && loadError === null ? (
              <Progress label={t("Checking this computer…")} />
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
        {step === 1 && loaded ? (
          <div className="flex min-w-0 flex-col gap-2">
            <p>{recommendationText(loaded.recommendation.tier)}</p>
            {offer === "install" ? (
              <>
                <Text as="p" size="caption" tone="secondary">
                  {t("Model: {p1}", { p1: modelName })}
                </Text>
                {planError !== null ? <ErrorNotice error={planError} /> : null}
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
                {t("No local model is listed for this computer yet.")}
              </InlineMessage>
            ) : null}
          </div>
        ) : null}
        {step === 2 ? (
          <div className="flex min-w-0 flex-col gap-2">
            {result === null && !installing && installError === null ? (
              <p>{t("Install {p1} on this computer?", { p1: modelName })}</p>
            ) : null}
            {installing ? <Progress label={t("Installing…")} /> : null}
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
