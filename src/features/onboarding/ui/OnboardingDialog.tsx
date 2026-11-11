import { Alert } from "../../../shared/ui/Alert";
import { LiveText } from "../../../shared/ui/LiveText";
import { Checkbox } from "../../../shared/ui/Checkbox";
import { Heading } from "../../../shared/ui/Heading";
import { Stepper } from "../../../shared/ui/Stepper";
import { Progress } from "../../../shared/ui/Progress";
import { Button } from "../../../shared/ui/Button";
import { EmptyState } from "../../../shared/ui/EmptyState";
import { MiddleTruncate } from "../../../shared/ui/MiddleTruncate";
import { Select } from "../../../shared/ui/Select";
import { Skeleton } from "../../../shared/ui/Skeleton";
import {
  t,
  useLocale,
  LANGUAGES,
  getLanguagePreference,
  setLanguagePreference,
  isLocale,
} from "../../../shared/i18n";
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { Modal } from "../../../shared/ui/Modal";
import {
  Check,
  Globe,
  ChevronRight,
  ArrowLeft,
  Folder,
  FolderOpen,
  FolderPlus,
} from "../../../shared/ui/icons";
import { PRODUCT_IDENTITY } from "../../../shared/lib/productIdentity";
const ConnectionsSettings = lazy(() =>
  import("../../connections/ui/ConnectionsSettings").then((module) => ({
    default: module.ConnectionsSettings,
  })),
);
import { AddRemoteProjectDialog } from "../../connections/ui/AddRemoteProjectDialog";
import { useRemoteMachines } from "../../connections/model/connections";
import { remoteProjectMachines } from "../../connections/model/localSync";
import { HarnessIcon } from "../../sessions/ui/HarnessIcon";
import { type HarnessId } from "../../sessions/model/session";
import { ProviderSignInDialog } from "../../sessions/ui/ProviderSignInDialog";
import {
  defaultProviderAccountId,
  supportsProviderAccounts,
} from "../../providers/model/providerAccounts";
import {
  discoverImportableSessions,
  type ImportCandidate,
} from "../../../platform/tauri/sessionImport";
import { importedSessionKeys } from "../../sessions/data/sessionStore";
import {
  groupByFolder,
  isAlreadyImported,
  isTemporaryFolder,
} from "../../sessions/import/importModel";
import {
  isUsableProjectFolder,
  runSessionImport,
  type ImportProgress,
  type ImportSummary,
} from "../../sessions/import/importRunner";
import { pickFolders } from "../../../platform/tauri/fs";
import { rememberProject } from "../../projects/model/recents";
import { parentPath, prettyCwd, projectName } from "../../../shared/lib/paths";
import { OnboardingWorkspace, OnboardingAppearance } from "./OnboardingPreferences";
import { OnboardingAgents } from "./OnboardingAgents";
import { OnboardingFooter } from "./OnboardingFooter";
import { OnboardingAccount } from "./OnboardingAccount";
import { OnboardingStatistics } from "./OnboardingStatistics";
import { OnboardingConnections } from "./OnboardingConnections";
import { markAccountStepSeen } from "../model/onboarding";
import { useOnboardingSteps } from "../model/useOnboardingSteps";
import { loadOnboardingProviders, addOnboardingProviders } from "../model/onboardingProviders";
import "./onboarding.css";
import { LoadingText } from "../../../shared/ui/LoadingText";

type Props = {
  onStartGuide?: () => void;
  onFinish: () => void;
  onImported: () => void;
  onOpenProject: (path: string) => void;
};

export default function OnboardingDialog({
  onFinish,
  onImported,
  onOpenProject,
  onStartGuide,
}: Props) {
  useLocale();
  const steps = useOnboardingSteps();
  const [currentId, setCurrentId] = useState(steps[0]);
  const step = Math.max(0, steps.indexOf(currentId));
  const current = steps[step];
  const [visited, setVisited] = useState<ReadonlySet<string>>(new Set([steps[0]]));
  const [connections, setConnections] = useState(false);
  const [remotePicker, setRemotePicker] = useState(false);
  const [signIn, setSignIn] = useState<{
    provider: HarnessId;
    accountId?: string;
  } | null>(null);
  const [signedIn, setSignedIn] = useState<ReadonlySet<string>>(new Set());
  const [providers, setProviders] = useState(loadOnboardingProviders);
  const addProviders = useCallback(
    (ids: readonly HarnessId[]) => setProviders(addOnboardingProviders(ids)),
    [],
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const body = useRef<HTMLDivElement>(null);
  const previousStep = useRef(step);
  const { machines } = useRemoteMachines();
  const remotes = remoteProjectMachines(machines);
  const goTo = (next: number) => {
    if (busy) return;
    if (current === "Account") markAccountStepSeen();
    setVisited((seen) => new Set([...seen, steps[next]]));
    setCurrentId(steps[next]);
  };
  useEffect(() => {
    if (previousStep.current === step) return;
    previousStep.current = step;
    const heading = body.current?.querySelector<HTMLElement>(".onboarding-stage:not([hidden]) h3");
    if (heading) {
      heading.tabIndex = -1;
      heading.focus({ preventScroll: true });
    }
  }, [step]);

  return (
    <Modal
      padding="none"
      title={t("Welcome to {p0}", { p0: PRODUCT_IDENTITY.displayName })}
      size="lg"
      minimalHeader
      className="onboarding-panel"
      onClose={busy ? () => undefined : onFinish}
    >
      <div className="onboarding-layout" ref={body}>
        <header className="onboarding-header">
          <div className="onboarding-topline">
            <div className="onboarding-brand">
              <img src={PRODUCT_IDENTITY.logoSrc} alt="" />
              <span>{PRODUCT_IDENTITY.displayName}</span>
              <small>{t("Quick setup")}</small>
            </div>
            <div className="onboarding-topline-actions">
              {onStartGuide && !busy ? (
                <Button onClick={onStartGuide} variant="ghost" type="button">
                  {t("Usage guide")}
                </Button>
              ) : null}
              <div className="onboarding-language">
                <Select
                  hideLabel
                  label={t("Language")}
                  value={getLanguagePreference()}
                  options={[{ value: "system", label: t("System language") }, ...LANGUAGES]}
                  onValueChange={(value) => {
                    if (value === "system" || isLocale(value))
                      void setLanguagePreference(value).catch((reason) => setError(String(reason)));
                  }}
                />
              </div>
            </div>
          </div>
          <div className="onboarding-stepper-wrap">
            <Stepper
              className="onboarding-stepper"
              label={t("Getting started")}
              steps={steps.map((label) => ({ id: label, label: t(label) }))}
              current={step}
              completed={[...visited].filter((id) => id !== current)}
              selectable="all"
              disabled={busy}
              onStepSelect={goTo}
            />
            <p className="onboarding-step-caption" aria-hidden="true">
              {t("Step {p0} of {p1} · {p2}", {
                p0: step + 1,
                p1: steps.length,
                p2: t(current),
              })}
            </p>
          </div>
        </header>
        {current !== "Projects" ? (
          <div className="onboarding-stage">
            <div className="onboarding-body" key={step}>
              {error ? <Alert tone="danger">{error}</Alert> : null}
              {current === "Account" ? <OnboardingAccount onGuest={() => goTo(step + 1)} /> : null}
              {current === "Statistics" ? <OnboardingStatistics /> : null}
              {current === "Workspace" ? <OnboardingWorkspace /> : null}
              {current === "Appearance" ? <OnboardingAppearance /> : null}
              {current === "Agents" ? (
                <OnboardingAgents
                  onSignIn={(provider) =>
                    setSignIn({
                      provider,
                      accountId: supportsProviderAccounts(provider)
                        ? defaultProviderAccountId(provider)
                        : undefined,
                    })
                  }
                  signedIn={signedIn}
                  providers={providers}
                  onAddProviders={addProviders}
                />
              ) : null}
              {current === "Connections" ? (
                <OnboardingConnections remotes={remotes} onManage={() => setConnections(true)} />
              ) : null}
            </div>
            <OnboardingFooter
              start={
                <Button
                  onClick={step === 0 ? onFinish : () => goTo(step - 1)}
                  variant={step === 0 ? "ghost" : "secondary"}
                  type="button"
                >
                  {step === 0 ? (
                    t("Set up later")
                  ) : (
                    <>
                      <ArrowLeft className="icon-sm" />
                      {t("Back")}
                    </>
                  )}
                </Button>
              }
              note={t("Changes save automatically")}
            >
              <Button onClick={() => goTo(step + 1)} variant="primary" type="button">
                {t("Continue")}
                <ChevronRight className="icon-sm" />
              </Button>
            </OnboardingFooter>
          </div>
        ) : null}
        {visited.has("Projects") ? (
          <div className="onboarding-stage" hidden={current !== "Projects"}>
            <Projects
              onBusy={setBusy}
              onImported={onImported}
              onFinish={onFinish}
              onBack={() => goTo(step - 1)}
              onOpenRemote={remotes.length ? () => setRemotePicker(true) : undefined}
            />
          </div>
        ) : null}
      </div>
      {connections ? (
        <Modal title={t("Connections")} size="lg" onClose={() => setConnections(false)}>
          <Suspense fallback={<LoadingText layout="fill" />}>
            <ConnectionsSettings />
          </Suspense>
        </Modal>
      ) : null}
      {signIn ? (
        <ProviderSignInDialog
          harness={signIn.provider}
          accountId={signIn.accountId}
          onClose={() => setSignIn(null)}
          completeDescription="Your agent is connected. Continue setting up your workspace."
          onSignedIn={() =>
            setSignedIn(
              (current) =>
                new Set([...current, `${signIn.provider}:${signIn.accountId ?? "default"}`]),
            )
          }
        />
      ) : null}
      {remotePicker ? (
        <AddRemoteProjectDialog
          onCancel={() => setRemotePicker(false)}
          onOpen={(path) => {
            onImported();
            onOpenProject(path);
            setRemotePicker(false);
          }}
        />
      ) : null}
    </Modal>
  );
}

function Projects({
  onBusy,
  onImported,
  onFinish,
  onBack,
  onOpenRemote,
}: {
  onBusy: (busy: boolean) => void;
  onImported: () => void;
  onFinish: () => void;
  onBack: () => void;
  onOpenRemote?: () => void;
}) {
  useLocale();
  const [candidates, setCandidates] = useState<ImportCandidate[]>([]);
  const [hiddenTemporary, setHiddenTemporary] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [progress, setProgress] = useState<ImportProgress | null>(null);
  const [summary, setSummary] = useState<ImportSummary | null>(null);
  const [adding, setAdding] = useState(false);
  const [importing, setImporting] = useState(false);
  const [addedFolders, setAddedFolders] = useState<string[]>([]);
  const abort = useRef<AbortController | null>(null);
  const running = useRef(false);
  const folders = groupByFolder(candidates);

  useEffect(() => {
    let alive = true;
    Promise.all([discoverImportableSessions(), importedSessionKeys()])
      .then(([report, keys]) => {
        if (!alive) return;
        const stored = new Set(keys);
        const usable = report.candidates.filter(
          (item) =>
            item.kind === "interactive" &&
            isUsableProjectFolder(item) &&
            !isAlreadyImported(item, stored),
        );
        // Scratch folders (OS temp, e2e runs) stay out of the list; nothing is deleted.
        const next = usable.filter((item) => !isTemporaryFolder(item.cwd));
        setCandidates(next);
        setHiddenTemporary(
          groupByFolder(usable.filter((item) => isTemporaryFolder(item.cwd))).length,
        );
        setSelected(new Set(groupByFolder(next).map((folder) => folder.key)));
      })
      .catch((reason) => {
        if (alive) setError(String(reason));
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
      abort.current?.abort();
    };
  }, []);

  const start = async () => {
    if (running.current) return;
    running.current = true;
    setImporting(true);
    onBusy(true);
    setError("");
    const controller = new AbortController();
    abort.current = controller;
    try {
      const result = await runSessionImport({
        candidates: folders
          .filter((folder) => selected.has(folder.key))
          .flatMap((folder) => folder.items),
        groupProjects: true,
        signal: controller.signal,
        onProgress: setProgress,
      });
      setSummary(result);
    } catch (reason) {
      setError(String(reason));
    } finally {
      running.current = false;
      setImporting(false);
      setProgress(null);
      onBusy(false);
      onImported();
    }
  };
  const addFolders = async () => {
    if (running.current) return;
    running.current = true;
    setAdding(true);
    onBusy(true);
    try {
      const paths = await pickFolders();
      for (const path of paths) await rememberProject(path);
      setAddedFolders((current) => [...new Set([...current, ...paths])]);
      onImported();
    } catch (reason) {
      setError(String(reason));
    } finally {
      running.current = false;
      setAdding(false);
      onBusy(false);
    }
  };
  const busy = importing || adding;
  const listing = !loading && !summary && !importing;
  const empty = listing && !error && folders.length === 0;
  const chooseFolders = (
    <Button
      disabled={busy}
      loading={adding}
      onClick={() => void addFolders()}
      variant="secondary"
      type="button"
    >
      <FolderPlus aria-hidden className="icon-sm" />
      {t("Choose project folders")}
    </Button>
  );
  return (
    <>
      <div className="onboarding-body">
        <div className="onboarding-heading">
          <Heading size="page" level={3}>{t("Choose your projects")}</Heading>
          <p>
            {t(
              "Import local projects and conversations from Claude Code and Codex, or choose a folder.",
            )}
          </p>
        </div>
        <div className="onboarding-scroll">
          {error ? (
            <Alert tone="danger">
              {t("Could not complete this action: ")}
              {error}
            </Alert>
          ) : null}
          {loading ? (
            <div className="onboarding-scan">
              <p role="status">{t("Scanning this computer’s conversation history…")}</p>
              {[0, 1, 2, 3].map((row) => (
                <Skeleton key={row} aria-hidden className="h-9 w-full" />
              ))}
            </div>
          ) : null}
          {listing && folders.length > 0 ? (
            <div className="onboarding-projects-frame">
              <div className="onboarding-selection">
                <Checkbox
                  aria-label={t("Select all")}
                  disabled={busy}
                  checked={selected.size === folders.length}
                  indeterminate={selected.size > 0 && selected.size < folders.length}
                  onChange={() =>
                    setSelected(
                      selected.size === folders.length
                        ? new Set()
                        : new Set(folders.map((folder) => folder.key)),
                    )
                  }
                />
                <span>
                  {selected.size}
                  {t(" of ")}
                  {folders.length}
                  {t(" selected")}
                </span>
                {hiddenTemporary > 0 ? (
                  <small className="onboarding-selection-note">
                    {t("{p0} temporary folders hidden", { p0: hiddenTemporary })}
                  </small>
                ) : null}
              </div>
              <div className="onboarding-projects">
                {folders.map((folder) => {
                  const parent = parentPath(folder.path);
                  return (
                    <Checkbox
                      checked={selected.has(folder.key)}
                      disabled={busy}
                      onChange={(event) => {
                        const checked = event.target.checked;
                        setSelected((current) => {
                          const next = new Set(current);
                          if (checked) next.add(folder.key);
                          else next.delete(folder.key);
                          return next;
                        });
                      }}
                      label={
                        <>
                          <Folder aria-hidden className="icon-sm onboarding-project-icon" />
                          <strong>{projectName(folder.path)}</strong>
                          {parent && parent !== folder.path ? (
                            <MiddleTruncate
                              mode="path"
                              title={folder.path}
                              className="onboarding-project-path"
                            >
                              {prettyCwd(parent)}
                            </MiddleTruncate>
                          ) : (
                            <span className="onboarding-project-path" />
                          )}
                          <span className="onboarding-provider-icons">
                            {[...new Set(folder.items.map((item) => item.provider))].map(
                              (provider) => (
                                <HarnessIcon
                                  key={provider}
                                  harness={provider}
                                  className="icon-sm"
                                />
                              ),
                            )}
                          </span>
                          <span className="onboarding-project-count" title={t("Conversations")}>
                            {folder.items.length}
                          </span>
                        </>
                      }
                      className="onboarding-project"
                      key={folder.key}
                    />
                  );
                })}
              </div>
            </div>
          ) : null}
          {empty ? (
            <EmptyState
              context="panel"
              icon={<FolderOpen aria-hidden width={24} height={24} strokeWidth={1.75} />}
              description={t(
                "No new conversation history found. Choose a project folder to start.",
              )}
              action={chooseFolders}
            />
          ) : null}
          {importing ? (
            <div>
              <Progress
                label={t("Importing conversations: ")}
                value={progress?.total ? progress.done : undefined}
                max={progress?.total || 1}
                compact
              />
              <p>
                <LiveText
                  text={`${t("Importing conversations: ")}${progress?.done ?? 0} / ${progress?.total ?? 0}`}
                />
              </p>
              <Button onClick={() => abort.current?.abort()} variant="secondary" type="button">
                {t("Cancel import")}
              </Button>
            </div>
          ) : null}
          {summary ? (
            <div role="status">
              <p>
                {summary.imported}
                {t(" conversations imported across ")}
                {summary.projects} {t("projects.")}
                {summary.cancelled ? t(" Import cancelled.") : ""}
              </p>
              {summary.failed.length ? (
                <Alert tone="danger">
                  <p>
                    {summary.failed.length}
                    {t(" conversations could not be imported.")}
                  </p>
                  {summary.failed.map((failure, index) => (
                    <p key={index}>
                      {failure.candidate.cwd}: {failure.error}
                    </p>
                  ))}
                </Alert>
              ) : null}
              {summary.readOnly || summary.truncated ? (
                <p>
                  {summary.readOnly}
                  {t(" history-only conversations ·")} {summary.truncated}
                  {t(" shortened transcripts")}
                </p>
              ) : null}
            </div>
          ) : null}
          {addedFolders.length ? (
            <div role="status">
              <p>
                {addedFolders.length}
                {t(" project folders added.")}
              </p>
              {addedFolders.map((path) => (
                <div className="onboarding-project" key={path}>
                  <Check aria-hidden className="icon-sm onboarding-project-icon" />
                  <strong>{projectName(path)}</strong>
                  <MiddleTruncate mode="path" className="onboarding-project-path">
                    {path}
                  </MiddleTruncate>
                </div>
              ))}
            </div>
          ) : null}
          {!empty && !loading ? (
            <div className="onboarding-actions">
              {chooseFolders}
              {onOpenRemote ? (
                <Button disabled={busy} onClick={onOpenRemote} variant="secondary" type="button">
                  <Globe aria-hidden className="icon-sm" />
                  {t("Open a remote project")}
                </Button>
              ) : null}
            </div>
          ) : null}
          {empty && onOpenRemote ? (
            <div className="onboarding-actions">
              <Button disabled={busy} onClick={onOpenRemote} variant="secondary" type="button">
                <Globe aria-hidden className="icon-sm" />
                {t("Open a remote project")}
              </Button>
            </div>
          ) : null}
        </div>
      </div>
      <OnboardingFooter
        start={
          <Button disabled={busy} onClick={onBack} variant="secondary" type="button">
            <ArrowLeft className="icon-sm" />
            {t("Back")}
          </Button>
        }
      >
        {!summary ? (
          <Button disabled={busy} onClick={onFinish} variant="ghost" type="button">
            {t("Skip import")}
          </Button>
        ) : null}
        <Button
          disabled={busy}
          loading={importing}
          onClick={summary || !selected.size ? onFinish : () => void start()}
          variant="primary"
          type="button"
        >
          {summary || !selected.size
            ? t("Finish setup")
            : t("Import {p0} projects", { p0: selected.size })}
        </Button>
      </OnboardingFooter>
    </>
  );
}
