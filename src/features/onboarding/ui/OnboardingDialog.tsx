import { SurfaceLoading } from "../../../shared/ui/SurfaceLoading";
import { Tooltip } from "../../../shared/ui/Tooltip";
import { surfaceAttributes } from "../../../shared/ui/Surface";
import { Text } from "../../../shared/ui/Text";
import { Alert } from "../../../shared/ui/Alert";
import { LiveText } from "../../../shared/ui/LiveText";
import { Checkbox } from "../../../shared/ui/Checkbox";
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
import { OnboardingHeading } from "./OnboardingHeading";
import { OnboardingAccount } from "./OnboardingAccount";
import { OnboardingStatistics } from "./OnboardingStatistics";
import { OnboardingConnections } from "./OnboardingConnections";
import { markAccountStepSeen } from "../model/onboarding";
import { useOnboardingSteps } from "../model/useOnboardingSteps";
import { loadOnboardingProviders, addOnboardingProviders } from "../model/onboardingProviders";
import "./onboarding.css";

type Props = {
  onFinish: () => void;
  onImported: () => void;
  onOpenProject: (path: string) => void;
};

export default function OnboardingDialog({
  onFinish,
  onImported,
  onOpenProject,
}: Props) {
  useLocale();
  const { machines } = useRemoteMachines();
  const remotes = remoteProjectMachines(machines);
  const steps = useOnboardingSteps().filter((id) => id !== "Machines" || remotes.length > 0);
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
  // Language-change failures belong to the language picker, not to the step body.
  const [languageError, setLanguageError] = useState("");
  const languageAttempt = useRef(0);
  const body = useRef<HTMLDivElement>(null);
  const previousStep = useRef(step);
  const goTo = (next: number) => {
    if (busy) return;
    if (current === "Account") markAccountStepSeen();
    // Moving on ends the previous outcome; a late reply to an older attempt must not reappear.
    languageAttempt.current += 1;
    setLanguageError("");
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
      scroll="none"
      padding="none"
      title={t("Welcome to {p0}", { p0: PRODUCT_IDENTITY.displayName })}
      size="lg"
      height="tall"
      minimalHeader
      bodyText={{ size: "secondary", leading: "inherit" }}
      onClose={busy ? () => undefined : onFinish}
    >
      <div className="onboarding-layout" ref={body}>
        <header {...surfaceAttributes({ frame: "pane", edge: "block-end" }, "onboarding-header")}>
          <div className="onboarding-topline">
            <div className="onboarding-topline-actions">
              <div className="onboarding-language">
                <Select
                  hideLabel
                  label={t("Language")}
                  value={getLanguagePreference()}
                  options={[{ value: "system", label: t("System language") }, ...LANGUAGES]}
                  onValueChange={(value) => {
                    if (value !== "system" && !isLocale(value)) return;
                    const attempt = ++languageAttempt.current;
                    setLanguageError("");
                    void setLanguagePreference(value).catch((reason) => {
                      // Only the newest language change may report; an older reply is stale.
                      if (attempt === languageAttempt.current) setLanguageError(String(reason));
                    });
                  }}
                />
              </div>
            </div>
            {languageError ? <Alert tone="danger">{languageError}</Alert> : null}
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
          </div>
        </header>
        {current !== "Projects" ? (
          <div className="onboarding-stage">
            <div className="onboarding-body" key={step}>
              {current === "Account" ? <OnboardingAccount /> : null}
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
              {current === "Machines" ? (
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
          <Suspense fallback={<SurfaceLoading />}>
            <ConnectionsSettings />
          </Suspense>
        </Modal>
      ) : null}
      {signIn ? (
        <ProviderSignInDialog
          harness={signIn.provider}
          accountId={signIn.accountId}
          onClose={() => setSignIn(null)}
          completeDescription={t("Your agent is connected. Continue setting up your workspace.")}
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
  const importStatus = t("Importing conversations: {p0} / {p1}", {
    p0: progress?.done ?? 0,
    p1: progress?.total ?? 0,
  });
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
        <OnboardingHeading
          title={t("Projects")}
          info={t(
            "Import local projects and conversations from Claude Code and Codex, or choose a folder.",
          )}
        />
        <div className="onboarding-scroll">
          {error ? (
            <Alert tone="danger">{t("Could not complete this action: {p0}", { p0: error })}</Alert>
          ) : null}
          {loading ? (
            <div className="onboarding-scan">
              <Text as="p" size="inherit" tone="muted" leading="normal" role="status">
                {t("Scanning this computer’s conversation history…")}
              </Text>
              {[0, 1, 2, 3].map((row) => (
                <Skeleton key={row} aria-hidden className="h-9 w-full" />
              ))}
            </div>
          ) : null}
          {listing && folders.length > 0 ? (
            <div
              {...surfaceAttributes({ frame: "card", radius: "card" }, "onboarding-projects-frame")}
            >
              <Text
                as="div"
                size="caption"
                tone="secondary"
                leading="inherit"
                {...surfaceAttributes({ frame: "pane", edge: "block-end" }, "onboarding-selection")}
              >
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
                <span>{t("{p0} of {p1} selected", { p0: selected.size, p1: folders.length })}</span>
              </Text>
              <div {...surfaceAttributes({ dividers: "pane" }, "onboarding-projects")}>
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
                          <Folder
                            aria-hidden
                            tone="muted"
                            className="icon-sm onboarding-project-icon"
                          />
                          <Text
                            as="strong"
                            size="inherit"
                            tone="inherit"
                            weight="medium"
                            leading="inherit"
                            truncate
                          >
                            {projectName(folder.path)}
                          </Text>
                          {parent && parent !== folder.path ? (
                            <MiddleTruncate
                              mode="path"
                              size="caption"
                              tone="muted"
                              title={folder.path}
                              className="onboarding-project-path"
                            >
                              {prettyCwd(parent)}
                            </MiddleTruncate>
                          ) : (
                            <Text
                              as="span"
                              size="caption"
                              tone="muted"
                              className="onboarding-project-path"
                            />
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
                          <Tooltip label={t("Sessions")} asChild>
                            <Text
                              size="caption"
                              tone="muted"
                              leading="inherit"
                              className="onboarding-project-count"
                            >
                              {folder.items.length}
                            </Text>
                          </Tooltip>
                        </>
                      }
                      appearance="row"
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
              action={{
                label: t("Choose project folders"),
                pending: adding,
                disabled: busy,
                onClick: () => void addFolders(),
              }}
            />
          ) : null}
          {importing ? (
            <div>
              <Progress
                aria-valuetext={importStatus}
                value={progress?.total ? progress.done : undefined}
                max={progress?.total || 1}
                compact
              />
              <Text as="p" size="inherit" tone="muted" leading="normal">
                <LiveText text={importStatus} />
              </Text>
              <Button onClick={() => abort.current?.abort()} variant="secondary" type="button">
                {t("Stop import")}
              </Button>
            </div>
          ) : null}
          {summary ? (
            <div role="status">
              <Text as="p" size="inherit" tone="muted" leading="normal">
                {t("{p0} conversations imported across {p1} projects.", {
                  p0: summary.imported,
                  p1: summary.projects,
                })}
                {summary.cancelled ? ` ${t("Import cancelled.")}` : ""}
              </Text>
              {summary.failed.length ? (
                <Alert tone="danger">
                  <Text as="p" size="inherit" tone="muted" leading="normal">
                    {t("{p0} conversations could not be imported.", { p0: summary.failed.length })}
                  </Text>
                  {summary.failed.map((failure, index) => (
                    <Text as="p" key={index} size="inherit" tone="muted" leading="normal">
                      {failure.candidate.cwd}: {failure.error}
                    </Text>
                  ))}
                </Alert>
              ) : null}
              {summary.readOnly || summary.truncated ? (
                <Text as="p" size="inherit" tone="muted" leading="normal">
                  {t("{p0} history-only conversations · {p1} shortened transcripts", {
                    p0: summary.readOnly,
                    p1: summary.truncated,
                  })}
                </Text>
              ) : null}
            </div>
          ) : null}
          {addedFolders.length ? (
            <div role="status">
              <Text as="p" size="inherit" tone="muted" leading="normal">
                {t("{p0} project folders added.", { p0: addedFolders.length })}
              </Text>
              {addedFolders.map((path) => (
                <div className="onboarding-project" key={path}>
                  <Check aria-hidden tone="muted" className="icon-sm onboarding-project-icon" />
                  <Text
                    as="strong"
                    size="inherit"
                    tone="inherit"
                    weight="medium"
                    leading="inherit"
                    truncate
                  >
                    {projectName(path)}
                  </Text>
                  <MiddleTruncate
                    mode="path"
                    size="caption"
                    tone="muted"
                    className="onboarding-project-path"
                  >
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
        <Button disabled={busy || !!summary} onClick={onFinish} variant="ghost" type="button">
          {t("Skip import")}
        </Button>
        <Button
          disabled={busy || (!summary && !selected.size)}
          loading={importing}
          onClick={summary ? onFinish : () => void start()}
          reserveLabels={[t("Finish setup"), t("Import {p0} projects", { p0: folders.length })]}
          variant="primary"
          type="button"
        >
          {summary ? t("Finish setup") : t("Import {p0} projects", { p0: selected.size })}
        </Button>
      </OnboardingFooter>
    </>
  );
}
