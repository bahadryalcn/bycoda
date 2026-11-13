import "./decisionModels.css";
import { testedSources } from "../model/routingEditor";
import { connectedCandidate } from "../model/presentation";
import { Text } from "../../../shared/ui/Text";
import { useState } from "react";
import { formatNumber, t } from "../../../shared/i18n";
import { Button } from "../../../shared/ui/Button";
import { Disclosure } from "../../../shared/ui/Disclosure";
import { useConfirm } from "../../../shared/ui/ConfirmDialog";
import { Tooltip } from "../../../shared/ui/Tooltip";
import { RefreshCw, Lock } from "../../../shared/ui/icons";
import { Switch } from "../../../shared/ui/Switch";
import { Group } from "../../settings/public/settingsControls";
import { useDecisionModels } from "../hooks/useDecisionModels";
import type { DecisionModelsClient } from "../model/decisionModelsClient";
import type { DecisionSource, DiscoveryCandidate, SourceTestResult } from "../model/decisionTypes";
import { candidateSourceInput } from "../model/decisionView";
import { AddMenu, type AddPath } from "./AddMenu";
import { ApiProviderDialog } from "./ApiProviderDialog";
import { CustomEndpointDialog, type CustomPrefill } from "./CustomEndpointDialog";
import { EditSourceDialog } from "./EditSourceDialog";
import { ErrorNotice } from "./ErrorNotice";
import { FoundList } from "./FoundList";
import { FolderModelDialog } from "./FolderModelDialog";
import { LocalInstallWizard } from "./LocalInstallWizard";
import { ManualPathDialog, type ManualPrefill } from "./ManualPathDialog";
import { RoutingTable } from "./RoutingTable";
import { ScanSettings } from "./ScanSettings";
import { SourcesList } from "./SourcesList";
type Dialog =
  | { kind: "folder"; modelPath?: string }
  | { kind: "manual"; prefill?: ManualPrefill; initialMode?: "endpoint" }
  | { kind: "custom"; prefill?: CustomPrefill }
  | { kind: "api"; preselectId?: string }
  | { kind: "local" }
  | { kind: "edit"; source: DecisionSource }
  | null;
/**
 * The "Decision models" section under Providers. Sources, what the scan found, task routing and the
 * personal-data switch. Each add path opens its own dialog; nothing is connected without an explicit action.
 */
export function DecisionModelsSettings({ client }: { client: DecisionModelsClient }) {
  const model = useDecisionModels(client);
  const [testResults, setTestResults] = useState<Record<string, SourceTestResult>>({});
  const [testingAll, setTestingAll] = useState(false);
  const actions = {
    ...model.actions,
    testSource: async (id: string) => {
      const result = await model.actions.testSource(id);
      setTestResults((current) => ({ ...current, [id]: result }));
      return result;
    },
  };
  const sources = testedSources(model.sources, testResults);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [topError, setTopError] = useState<unknown>(null);
  const { confirm, dialog: confirmDialog } = useConfirm();
  const busy = model.isPending("add") || model.isPending("routing");
  const pick = (path: AddPath) => {
    setTopError(null);
    if (path === "folder") setDialog({ kind: "folder" });
    else if (path === "service") setDialog({ kind: "manual", initialMode: "endpoint" });
    else if (path === "manual") setDialog({ kind: "manual" });
    else if (path === "local") setDialog({ kind: "local" });
    else if (path === "api") setDialog({ kind: "api" });
    else setDialog({ kind: "custom" });
  };
  const addCandidate = (candidate: DiscoveryCandidate) => {
    const input = candidateSourceInput(candidate);
    if (input) {
      setTopError(null);
      setDialog({ kind: "folder", modelPath: input.local?.modelPath });
      return;
    }
    if (candidate.kind === "api_key") setDialog({ kind: "api", preselectId: candidate.id });
    else if (candidate.kind === "local_service") {
      setDialog({ kind: "custom", prefill: { name: candidate.label, endpoint: candidate.detail } });
    } else {
      setDialog({
        kind: "manual",
        prefill: { name: candidate.label, runtimePath: candidate.detail },
      });
    }
  };
  const remove = async (source: DecisionSource, mode: "source" | "local") => {
    const confirmed = await confirm({
      title: mode === "local" ? t("Uninstall this local model?") : t("Remove this source?"),
      message:
        mode === "local"
          ? t(
              "The local model files are removed from this computer. You can install it again later.",
            )
          : t("{p1} is removed from the app, with its saved key.", { p1: source.name }),
      confirmLabel: mode === "local" ? t("Uninstall") : t("Remove"),
      danger: true,
    });
    if (!confirmed) return;
    setTopError(null);
    try {
      if (mode === "local") await actions.localAction("uninstall", source.id);
      else await actions.removeSource(source.id);
    } catch (error: unknown) {
      setTopError(error);
    }
  };
  const changePersonalData = (value: boolean) => {
    setTopError(null);
    actions.changeLocalOnly(value).catch((error: unknown) => setTopError(error));
  };
  const closeDialog = () => setDialog(null);
  const scanAction = model.scanning ? (
    <Button
      variant="ghost"
      size="sm"
      loading={model.isPending("scan-cancel")}
      onClick={() => void actions.cancelScan().catch(() => undefined)}
    >
      {t("Cancel scan")}
    </Button>
  ) : (
    <Button
      variant="ghost"
      size="sm"
      startIcon={<RefreshCw aria-hidden="true" />}
      onClick={() => void actions.scan().catch(() => undefined)}
    >
      {t("Scan again")}
    </Button>
  );
  return (
    <div
      className="decision-models-page"
      style={{ "--settings-group-gap": "var(--space-1)" } as React.CSSProperties}
    >
      <div className="flex min-w-0 flex-wrap items-center justify-end gap-2 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <Lock className="icon-sm shrink-0" aria-hidden="true" />
          <Tooltip
            label={t(
              "Messages, profiles and contacts are sent only to local sources when this is on.",
            )}
          >
            <Text size="caption">{t("Personal data stays on this computer")}</Text>
          </Tooltip>
          <Switch
            aria-label={t("Personal data stays on this computer")}
            checked={model.localOnly}
            disabled={model.isPending("routing-local-only")}
            onCheckedChange={changePersonalData}
          />
        </div>
      </div>
      {topError !== null ? <ErrorNotice error={topError} /> : null}
      <Group
        title={t("Connected models")}
        action={
          <div className="flex shrink-0 items-center justify-end gap-2">
            {(sources?.length ?? 0) > 1 ? (
              <Button
                variant="ghost"
                size="sm"
                loading={testingAll}
                disabled={
                  testingAll || sources?.some((source) => model.isPending(`test:${source.id}`))
                }
                onClick={() => {
                  setTestingAll(true);
                  void Promise.allSettled(
                    (sources ?? []).map((source) => actions.testSource(source.id)),
                  )
                    .then((results) => {
                      setTestingAll(false);
                      const failed = results.find((result) => result.status === "rejected");
                      if (failed?.status === "rejected") setTopError(failed.reason);
                    })
                    .catch((error: unknown) => {
                      setTestingAll(false);
                      setTopError(error);
                    });
                }}
              >
                {t("Test all")}
              </Button>
            ) : null}
            <AddMenu onPick={pick} />
          </div>
        }
      >
        <SourcesList
          sources={model.sources}
          testResults={testResults}
          sourcesError={model.sourcesError}
          onRetry={() => void actions.reloadSources().catch(() => undefined)}
          actions={actions}
          isPending={model.isPending}
          emptyAction={
            <Button variant="primary" size="sm" onClick={() => pick("folder")}>
              {t("Add from folder")}
            </Button>
          }
          onEdit={(source) => setDialog({ kind: "edit", source })}
          onRemove={(source, mode) =>
            void remove(source, mode).catch((error: unknown) => setTopError(error))
          }
        />
      </Group>
      <Disclosure
        summary={
          model.found === null
            ? t("Found on this computer")
            : t("Found on this computer: {p1} not added", {
                p1: formatNumber(
                  model.found.filter((candidate) => !connectedCandidate(candidate, sources ?? []))
                    .length,
                ),
              })
        }
        summaryActions={scanAction}
        variant="row"
      >
        <div className="decision-discovery-body">
          <Group title={null}>
            <FoundList
              found={model.found}
              sources={sources ?? []}
              scanning={model.scanning}
              scanError={model.scanError}
              incomplete={model.scanIncomplete}
              busy={busy}
              onScan={() => void actions.scan().catch(() => undefined)}
              onAdd={addCandidate}
            />
          </Group>
          <Disclosure summary={t("Scan settings")} variant="row">
            <ScanSettings client={client} onScan={actions.scan} scanning={model.scanning} />
          </Disclosure>
        </div>
      </Disclosure>
      <Group title={t("Task routing")}>
        {sources?.length ? (
          <RoutingTable
            routing={model.routing}
            sources={sources}
            busy={model.isPending("routing")}
            onSave={(next) => actions.saveRouting(next)}
          />
        ) : sources !== null ? (
          <Text as="p" size="body" tone="secondary" className="px-4 py-2.5">
            {t("Connect a model before customizing task routing.")}
          </Text>
        ) : null}
        {model.routingError !== null ? (
          <div className="px-4 py-2.5">
            <ErrorNotice error={model.routingError} />
          </div>
        ) : null}
      </Group>
      {dialog?.kind === "folder" ? (
        <FolderModelDialog
          client={client}
          modelPath={dialog.modelPath}
          onAdd={(input) => actions.addSource(input)}
          onTest={(id) => actions.testSource(id)}
          onClose={closeDialog}
        />
      ) : null}
      {dialog?.kind === "manual" ? (
        <ManualPathDialog
          prefill={dialog.prefill}
          initialMode={dialog.initialMode}
          onAdd={(input) => actions.addSource(input)}
          onTest={(id) => actions.testSource(id)}
          onClose={closeDialog}
        />
      ) : null}
      {dialog?.kind === "custom" ? (
        <CustomEndpointDialog
          prefill={dialog.prefill}
          onAdd={(input, apiKey) => actions.addSource(input, apiKey)}
          onTest={(id) => actions.testSource(id)}
          onClose={closeDialog}
        />
      ) : null}
      {dialog?.kind === "api" ? (
        <ApiProviderDialog
          catalog={model.catalog}
          catalogError={model.catalogError}
          preselectId={dialog.preselectId}
          onAdd={(input, apiKey) => actions.addSource(input, apiKey)}
          onTest={(id) => actions.testSource(id)}
          onClose={closeDialog}
        />
      ) : null}
      {dialog?.kind === "local" ? (
        <LocalInstallWizard
          client={client}
          catalog={model.catalog}
          onChooseApi={() => setDialog({ kind: "api" })}
          onInstalled={() => void actions.reloadSources().catch(() => undefined)}
          onClose={closeDialog}
        />
      ) : null}
      {dialog?.kind === "edit" ? (
        <EditSourceDialog
          source={dialog.source}
          onSave={(patch, apiKey) => actions.updateSource(dialog.source.id, patch, apiKey)}
          onClose={closeDialog}
        />
      ) : null}
      {confirmDialog}
    </div>
  );
}
