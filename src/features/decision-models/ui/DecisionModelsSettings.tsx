import "./decisionModels.css";
import { DecisionTarget } from "./DecisionTarget";
import { matchingTest, testedSources, type SourceTestSnapshot } from "../model/routingEditor";
import { connectedCandidate } from "../model/presentation";
import { Text } from "../../../shared/ui/Text";
import { useId, useRef, useState } from "react";
import { formatNumber, t } from "../../../shared/i18n";
import { Button } from "../../../shared/ui/Button";
import { Disclosure } from "../../../shared/ui/Disclosure";
import { InlineError } from "../../../shared/ui/InlineError";
import { forEachConcurrent } from "../../../shared/lib/concurrent";
import { useConfirm } from "../../../shared/ui/ConfirmDialog";
import { RefreshCw, Lock } from "../../../shared/ui/icons";
import { Switch } from "../../../shared/ui/Switch";
import { Group, Row, SettingsFeedback } from "../../../shared/ui/settings";
import { useDecisionModels } from "../hooks/useDecisionModels";
import type { DecisionModelsClient } from "../model/decisionModelsClient";
import type { DecisionSource, DiscoveryCandidate } from "../model/decisionTypes";
import { candidateSourceInput, errorDetail } from "../model/decisionView";
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
const TEST_ALL_CONCURRENCY = 2;

type BatchTestFailure = { name: string; detail?: string };

type Dialog =
  | { kind: "folder"; modelPath?: string }
  | { kind: "manual"; prefill?: ManualPrefill; initialMode?: "endpoint" }
  | { kind: "custom"; prefill?: CustomPrefill }
  | { kind: "api"; preselectId?: string }
  | { kind: "local" }
  | { kind: "edit"; source: DecisionSource }
  | null;
/**
 * The "Decision models" settings page. Sources, what the scan found, decision routing and the
 * personal-data switch. Each add path opens its own dialog; nothing is connected without an explicit action.
 */
export function DecisionModelsSettings({
  client,
  hostId,
  hostName,
  remote = false,
}: {
  client: DecisionModelsClient;
  hostId?: string;
  hostName?: string;
  remote?: boolean;
}) {
  const model = useDecisionModels(client);
  const privacyControlId = useId();
  const [testResults, setTestResults] = useState<Record<string, SourceTestSnapshot>>({});
  const [testingAll, setTestingAll] = useState(false);
  const [batchTest, setBatchTest] = useState<{
    total: number;
    failed: BatchTestFailure[];
  } | null>(null);
  const [removing, setRemoving] = useState<Record<string, "source" | "local">>({});
  const testGeneration = useRef<Record<string, number>>({});
  const clearTest = (id: string) => {
    testGeneration.current[id] = (testGeneration.current[id] ?? 0) + 1;
    setTestResults((current) => {
      const next = { ...current };
      delete next[id];
      return next;
    });
  };
  const actions = {
    ...model.actions,
    localAction: async (...args: Parameters<typeof model.actions.localAction>) => {
      clearTest(args[1]);
      return model.actions.localAction(...args);
    },
    updateSource: async (...args: Parameters<typeof model.actions.updateSource>) => {
      clearTest(args[0]);
      return model.actions.updateSource(...args);
    },
    testSource: async (id: string) => {
      const source = model.sources?.find((item) => item.id === id);
      clearTest(id);
      const generation = testGeneration.current[id];
      const result = await model.actions.testSource(id);
      if (source && testGeneration.current[id] === generation)
        setTestResults((current) => ({ ...current, [id]: { source, result } }));
      return result;
    },
  };
  const sources = testedSources(model.sources, testResults);
  const visibleTests = Object.fromEntries(
    (model.sources ?? []).flatMap((source) => {
      const result = matchingTest(source, testResults[source.id]);
      return result ? [[source.id, result]] : [];
    }),
  );
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
          ? remote
            ? t(
                "The local model files are removed from Host {p1}. You can install it again later.",
                { p1: hostName ?? "" },
              )
            : t(
                "The local model files are removed from this computer. You can install it again later.",
              )
          : t("{p1} is removed from the app, with its saved key.", { p1: source.name }),
      confirmLabel: mode === "local" ? t("Uninstall") : t("Remove"),
      danger: true,
    });
    if (!confirmed) return;
    setTopError(null);
    setRemoving((current) => ({ ...current, [source.id]: mode }));
    try {
      if (mode === "local") await actions.localAction("uninstall", source.id);
      else await actions.removeSource(source.id);
    } catch (error: unknown) {
      setTopError(error);
    } finally {
      setRemoving((current) => {
        const next = { ...current };
        delete next[source.id];
        return next;
      });
    }
  };
  const runTestAll = async () => {
    const list = sources ?? [];
    const failed: BatchTestFailure[] = [];
    setTestingAll(true);
    setBatchTest(null);
    try {
      await forEachConcurrent(list, TEST_ALL_CONCURRENCY, async (source) => {
        try {
          const result = await actions.testSource(source.id);
          if (!result.ok) failed.push({ name: source.name, detail: result.error });
        } catch (error: unknown) {
          failed.push({ name: source.name, detail: errorDetail(error) });
        }
      });
      if (failed.length > 0) setBatchTest({ total: list.length, failed });
    } finally {
      setTestingAll(false);
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
      {t("Stop scan")}
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
    <DecisionTarget.Provider value={remote ? hostName : undefined}>
      <div className="decision-models-page">
        <Group title={null}>
          <Row
            label={
              <span className="flex min-w-0 items-center gap-2">
                <Lock className="icon-sm shrink-0" aria-hidden="true" />
                {remote
                  ? t("Personal data stays on Host {p1}", { p1: hostName ?? "" })
                  : t("Personal data stays on this computer")}
              </span>
            }
            controlId={model.routingLoaded ? privacyControlId : undefined}
            info={t(
              "Messages, profiles and contacts are sent only to local sources when this is on.",
            )}
          >
            {model.routingLoaded ? (
              <Switch
                id={privacyControlId}
                aria-label={
                  remote
                    ? t("Personal data stays on Host {p1}", { p1: hostName ?? "" })
                    : t("Personal data stays on this computer")
                }
                checked={model.localOnly}
                disabled={
                  !model.routingLoaded ||
                  model.isPending("routing-read") ||
                  model.isPending("routing-local-only")
                }
                onCheckedChange={changePersonalData}
              />
            ) : model.routingError !== null ? (
              <Text>{t("Unavailable")}</Text>
            ) : (
              <SettingsFeedback state="loading">{t("Loading…")}</SettingsFeedback>
            )}
          </Row>
        </Group>
        {topError !== null ? <ErrorNotice error={topError} /> : null}
        {batchTest !== null ? (
          <InlineError
            details={batchTest.failed
              .map((item) => (item.detail ? `${item.name}: ${item.detail}` : item.name))
              .join("\n")}
          >
            {t("{p0} of {p1} connection tests failed", {
              p0: formatNumber(batchTest.failed.length),
              p1: formatNumber(batchTest.total),
            })}
          </InlineError>
        ) : null}
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
                  onClick={() => void runTestAll().catch((error: unknown) => setTopError(error))}
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
            testResults={visibleTests}
            removing={removing}
            sourcesError={model.sourcesError}
            onRetry={() => void actions.reloadSources().catch(() => undefined)}
            actions={actions}
            isPending={model.isPending}
            emptyAction={
              <Button variant="secondary" size="sm" onClick={() => pick("folder")}>
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
              ? remote
                ? t("Found on the Host")
                : t("Found on this computer")
              : remote
                ? t("Found on the Host: {p1} not added", {
                    p1: formatNumber(
                      model.found.filter(
                        (candidate) => !connectedCandidate(candidate, sources ?? []),
                      ).length,
                    ),
                  })
                : t("Found on this computer: {p1} not added", {
                    p1: formatNumber(
                      model.found.filter(
                        (candidate) => !connectedCandidate(candidate, sources ?? []),
                      ).length,
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
          </div>
        </Disclosure>
        <Disclosure summary={t("Scan settings")} variant="row">
          <ScanSettings
            hostId={hostId}
            client={client}
            onScan={actions.scan}
            scanning={model.scanning}
          />
        </Disclosure>
        <Group title={t("Decision routing")}>
          {!model.routingLoaded && model.routingError === null ? (
            <SettingsFeedback state="loading">{t("Loading…")}</SettingsFeedback>
          ) : null}
          {model.routingLoaded && sources?.length ? (
            <RoutingTable
              hostId={hostId}
              routing={model.routing}
              sources={sources}
              busy={
                !model.routingLoaded ||
                model.isPending("routing-read") ||
                model.isPending("routing")
              }
              onSave={(next) => actions.saveRouting(next)}
            />
          ) : sources !== null ? (
            <Text as="p" size="body" tone="secondary" className="px-4 py-2.5">
              {t("Connect a model before customizing task routing.")}
            </Text>
          ) : null}
          {model.routingError !== null ? (
            <div className="px-4 py-2.5">
              <ErrorNotice
                error={model.routingError}
                title={t("Could not load the routing.")}
                onRetry={() => void actions.reloadRouting()}
                retrying={model.isPending("routing-read")}
              />
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
            onRetryCatalog={() => void actions.reloadCatalog()}
            catalogRetrying={model.isPending("catalog-read")}
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
    </DecisionTarget.Provider>
  );
}
