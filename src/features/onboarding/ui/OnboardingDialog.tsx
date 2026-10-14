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
import { AppWindow, Check, Globe, ChevronRight, ArrowLeft } from "../../../shared/ui/icons";
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
  discoverImportableSessions,
  type ImportCandidate,
} from "../../../platform/tauri/sessionImport";
import { importedSessionKeys } from "../../sessions/data/sessionStore";
import { groupByFolder, isAlreadyImported } from "../../sessions/import/importModel";
import {
  isUsableProjectFolder,
  runSessionImport,
  type ImportProgress,
  type ImportSummary,
} from "../../sessions/import/importRunner";
import { pickFolders } from "../../../platform/tauri/fs";
import { rememberProject } from "../../projects/model/recents";
import { projectName } from "../../../shared/lib/paths";
import { OnboardingWorkspace, OnboardingAppearance } from "./OnboardingPreferences";
import { OnboardingAgents } from "./OnboardingAgents";
import { loadOnboardingProviders, addOnboardingProviders } from "../model/onboardingProviders";
import "./onboarding.css";

const STEPS = ["Workspace", "Appearance", "Agents", "Connections", "Projects"];
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
  const [step, setStep] = useState(0);
  const [visited, setVisited] = useState<ReadonlySet<number>>(new Set([0]));
  const [connections, setConnections] = useState(false);
  const [remotePicker, setRemotePicker] = useState(false);
  const [signIn, setSignIn] = useState<HarnessId | null>(null);
  const [signedIn, setSignedIn] = useState<ReadonlySet<HarnessId>>(new Set());
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
    setVisited((current) => new Set([...current, next]));
    setStep(next);
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
            <label className="onboarding-language">
              <span className="sr-only">{t("Language")}</span>
              <select
                aria-label={t("Language")}
                value={getLanguagePreference()}
                onChange={(event) => {
                  const value = event.target.value;
                  if (value === "system" || isLocale(value))
                    void setLanguagePreference(value).catch((reason) => setError(String(reason)));
                }}
              >
                <option value="system">{t("System language")}</option>
                {LANGUAGES.map(({ value, label }) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <nav aria-label={t("Getting started")}>
            <ol className="onboarding-steps">
              {STEPS.map((label, index) => (
                <li key={label} aria-current={index === step ? "step" : undefined}>
                  <button
                    disabled={busy}
                    aria-label={`${index + 1} ${t(label)}`}
                    title={t(label)}
                    onClick={() => goTo(index)}
                  >
                    <span
                      className={
                        visited.has(index) && index !== step
                          ? "onboarding-number complete"
                          : "onboarding-number"
                      }
                    >
                      {visited.has(index) && index !== step ? (
                        <Check className="size-3" />
                      ) : (
                        index + 1
                      )}
                    </span>
                    <span>{t(label)}</span>
                  </button>
                </li>
              ))}
            </ol>
          </nav>
        </header>
        {step < 4 ? (
          <div className="onboarding-stage">
            <div className="onboarding-body" key={step}>
              {error ? (
                <p className="onboarding-error" role="alert">
                  {error}
                </p>
              ) : null}
              {step === 0 ? <OnboardingWorkspace /> : null}
              {step === 1 ? <OnboardingAppearance /> : null}
              {step === 2 ? (
                <OnboardingAgents
                  onSignIn={setSignIn}
                  signedIn={signedIn}
                  providers={providers}
                  onAddProviders={addProviders}
                />
              ) : null}
              {step === 3 ? (
                <>
                  <div className="onboarding-heading">
                    <h3>{t("Connect your computers")}</h3>
                    <p>
                      {t(
                        "Work here, connect another computer, or pair your phone. This step is optional.",
                      )}
                    </p>
                  </div>
                  <div className="onboarding-card">
                    <AppWindow aria-hidden className="size-5" />
                    <div>
                      <strong>{t("This computer")}</strong>
                      <small>{t("Your local projects and agents")}</small>
                    </div>
                    <span className="onboarding-status">{t("Local")}</span>
                  </div>
                  {remotes.map((machine) => (
                    <div className="onboarding-card" key={machine.id}>
                      <Globe aria-hidden className="size-5" />
                      <div>
                        <strong>{machine.name}</strong>
                        <small>{t("Remote computer")}</small>
                      </div>
                      <button className="onboarding-small" onClick={() => setConnections(true)}>
                        {t("Manage")}
                      </button>
                    </div>
                  ))}
                  <button
                    className="onboarding-connection-action"
                    onClick={() => setConnections(true)}
                  >
                    <Globe aria-hidden className="size-5" />
                    <div>
                      <strong>{t("Manage connections")}</strong>
                      <small>{t("Computers, phone pairing and sharing")}</small>
                    </div>
                    <ChevronRight className="size-4" />
                  </button>
                  <p className="onboarding-hint">
                    {t(
                      "Your remote agents stay on their own computer. You can add connections later in Settings.",
                    )}
                  </p>
                </>
              ) : null}
            </div>
            <footer className="onboarding-footer">
              <button
                className="onboarding-muted"
                onClick={step === 0 ? onFinish : () => goTo(step - 1)}
              >
                {step === 0 ? (
                  t("Set up later")
                ) : (
                  <>
                    <ArrowLeft className="size-3.5" />
                    {t("Back")}
                  </>
                )}
              </button>
              <span className="onboarding-save-note">{t("Changes save automatically")}</span>
              <button className="onboarding-primary" onClick={() => goTo(step + 1)}>
                {t("Continue")}
                <ChevronRight className="size-3.5" />
              </button>
            </footer>
          </div>
        ) : null}
        {visited.has(4) ? (
          <div className="onboarding-stage" hidden={step !== 4}>
            <Projects
              onBusy={setBusy}
              onImported={onImported}
              onFinish={onFinish}
              onStartGuide={onStartGuide}
              onBack={() => goTo(3)}
              onOpenRemote={remotes.length ? () => setRemotePicker(true) : undefined}
            />
          </div>
        ) : null}
      </div>
      {connections ? (
        <Modal title={t("Connections")} size="lg" onClose={() => setConnections(false)}>
          <div className="onboarding-settings">
            <Suspense fallback={<p role="status">{t("Loading…")}</p>}>
              <ConnectionsSettings />
            </Suspense>
          </div>
        </Modal>
      ) : null}
      {signIn ? (
        <ProviderSignInDialog
          harness={signIn}
          onClose={() => setSignIn(null)}
          completeDescription="Your agent is connected. Continue setting up your workspace."
          onSignedIn={() => setSignedIn((current) => new Set([...current, signIn]))}
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
  onStartGuide,
}: {
  onBusy: (busy: boolean) => void;
  onImported: () => void;
  onFinish: () => void;
  onBack: () => void;
  onOpenRemote?: () => void;
  onStartGuide?: () => void;
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
        const next = report.candidates.filter(
          (item) =>
            item.kind === "interactive" &&
            isUsableProjectFolder(item) &&
            !isAlreadyImported(item, stored),
        );
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
    setAdding(true);
    onBusy(true);
    try {
      const paths = await pickFolders();
      for (const path of paths) rememberProject(path);
      setAddedFolders((current) => [...new Set([...current, ...paths])]);
      onImported();
    } catch (reason) {
      setError(String(reason));
    } finally {
      setAdding(false);
      onBusy(false);
    }
  };
  const busy = importing || adding;
  return (
    <>
      <div className="onboarding-body">
        <div className="onboarding-heading">
          <h3>{t("Choose your projects")}</h3>
          <p>
            {t(
              "Import local projects and conversations from Claude Code and Codex, or choose a folder.",
            )}
          </p>
        </div>
        {error ? (
          <p className="onboarding-error" role="alert">
            {t("Could not complete this action: ")}
            {error}
          </p>
        ) : null}
        {loading ? (
          <p role="status">{t("Scanning this computer’s conversation history…")}</p>
        ) : null}
        {!loading && !summary ? (
          <>
            <div className="onboarding-selection">
              <span>
                {selected.size}
                {t(" of ")}
                {folders.length}
                {t(" selected")}
              </span>
              <div>
                <button
                  disabled={busy}
                  onClick={() => setSelected(new Set(folders.map((folder) => folder.key)))}
                >
                  {t("Select all")}
                </button>
                <button disabled={busy} onClick={() => setSelected(new Set())}>
                  {t("Select none")}
                </button>
              </div>
            </div>
            <div className="onboarding-projects">
              {folders.map((folder) => (
                <label className="onboarding-project" key={folder.key}>
                  <input
                    type="checkbox"
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
                  />
                  <div>
                    <strong>{projectName(folder.path)}</strong>
                    <small title={folder.path}>{folder.path}</small>
                  </div>
                  <span className="onboarding-provider-icons">
                    {[...new Set(folder.items.map((item) => item.provider))].map((provider) => (
                      <HarnessIcon key={provider} harness={provider} className="size-3.5" />
                    ))}
                  </span>
                  <span title={t("Conversations")}>{folder.items.length}</span>
                </label>
              ))}
              {!folders.length ? (
                <p>{t("No new conversation history found. Choose a project folder to start.")}</p>
              ) : null}
            </div>
          </>
        ) : null}
        {importing ? (
          <div role="status" aria-live="polite">
            <p>
              {t("Importing conversations: ")}
              {progress?.done ?? 0} / {progress?.total ?? 0}
            </p>
            <button className="onboarding-muted" onClick={() => abort.current?.abort()}>
              {t("Cancel import")}
            </button>
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
              <div role="alert">
                <p>
                  {summary.failed.length}
                  {t(" conversations could not be imported.")}
                </p>
                {summary.failed.map((failure, index) => (
                  <p key={index}>
                    {failure.candidate.cwd}: {failure.error}
                  </p>
                ))}
              </div>
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
                <span>✓</span>
                <div>
                  <strong>{projectName(path)}</strong>
                  <small>{path}</small>
                </div>
              </div>
            ))}
          </div>
        ) : null}
        <div className="onboarding-project-actions">
          <button className="onboarding-muted" disabled={busy} onClick={() => void addFolders()}>
            {t("+ Choose project folders")}
          </button>
          {onOpenRemote ? (
            <button className="onboarding-muted" disabled={busy} onClick={onOpenRemote}>
              {t("+ Open a remote project")}
            </button>
          ) : null}
        </div>
      </div>
      <footer className="onboarding-footer">
        <button className="onboarding-muted" disabled={busy} onClick={onBack}>
          {t("← Back")}
        </button>
        <div className="onboarding-footer-actions">
          {onStartGuide && !busy ? (
            <button className="onboarding-muted" onClick={onStartGuide}>
              {t("Usage guide")}
            </button>
          ) : null}
          {!summary ? (
            <button className="onboarding-muted" disabled={busy} onClick={onFinish}>
              {t("Skip import")}
            </button>
          ) : null}
          <button
            className="onboarding-primary"
            disabled={busy}
            onClick={summary || !selected.size ? onFinish : () => void start()}
          >
            {summary || !selected.size
              ? t("Finish setup")
              : t("Import {p0} projects", { p0: selected.size })}
          </button>
        </div>
      </footer>
    </>
  );
}
