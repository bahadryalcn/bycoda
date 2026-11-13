import { PasswordField } from "../../../shared/ui/PasswordField";
import { Text } from "../../../shared/ui/Text";
import { LoadingText } from "../../../shared/ui/LoadingText";
import { SettingsFeedback, Toggle } from "./settingsControls";
import { InboxScopeCollection } from "./InboxScopeCollection";
import { JiraDefaultProjectSettings } from "./JiraDefaultProjectSettings";
import { t, useLocale } from "../../../shared/i18n";
import { useCallback, useEffect, useRef, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Row } from "./settingsControls";
import {
  InboxAccountActions,
  InboxConnectionStatus,
  InboxConnectionError,
  useConnectionVerification,
} from "./InboxConnectionStatus";
import { TextField } from "../../../shared/ui/TextField";
import { Button } from "../../../shared/ui/Button";
import { PrivateEmail } from "../../../shared/ui/PrivateEmail";
import { clearInboxCache } from "../../inbox/model/githubTasks";
import {
  disconnectJira,
  JIRA_CHANGE_EVENT,
  jiraConnected,
  jiraBackgroundSyncEnabled,
  saveJiraBackgroundSync,
  saveAllowedJiraBoardIds,
  listJiraProjects,
  notifyJiraChange,
  saveHiddenJiraProjectIds,
  saveJiraConfig,
  type JiraProject,
  type JiraStatus,
} from "../../inbox/model/jira";
import { listJiraBoards, type JiraBoard } from "../../inbox/model/jiraBoard";
import {
  isInboxScopeNumber,
  isInboxScopeString,
  useInboxScopePreference,
} from "./useInboxScopePreference";

function readBackgroundSync() {
  try {
    return { value: jiraBackgroundSyncEnabled(), available: true };
  } catch {
    return { value: false, available: false };
  }
}

export function JiraSettings({ active = true }: { active?: boolean } = {}) {
  useLocale();
  const verification = useConnectionVerification();
  const [status, setStatus] = useState<JiraStatus | null>(null);
  const [site, setSite] = useState("");
  const [email, setEmail] = useState("");
  const [token, setToken] = useState("");
  const [checking, setChecking] = useState(true);
  const [operation, setOperation] = useState<"save" | "disconnect" | null>(null);
  const busy = operation !== null;
  const [error, setError] = useState<string | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const mutation = useRef(false);
  const request = useRef(0);
  const projectRequest = useRef(0);
  const [projectsError, setProjectsError] = useState<string | null>(null);
  const [projectsLoading, setProjectsLoading] = useState(false);
  const [boardsLoading, setBoardsLoading] = useState(false);
  const [boardsRevision, setBoardsRevision] = useState(0);
  const [projects, setProjects] = useState<JiraProject[]>([]);
  const scopeOwner = `${status?.site ?? ""}\0${status?.email ?? ""}`;
  const projectScope = useInboxScopePreference(
    "bycoda.jiraHiddenProjects",
    JIRA_CHANGE_EVENT,
    isInboxScopeString,
    saveHiddenJiraProjectIds,
    scopeOwner,
  );
  const boardScope = useInboxScopePreference(
    "bycoda.jiraAllowedBoards",
    JIRA_CHANGE_EVENT,
    isInboxScopeNumber,
    saveAllowedJiraBoardIds,
    scopeOwner,
  );
  const hiddenIds = projectScope.value;
  const allowedBoardIds = boardScope.value;
  const [backgroundState, setBackgroundState] = useState(readBackgroundSync);
  const projectOwner = useRef("");
  const [boards, setBoards] = useState<JiraBoard[]>([]);
  const [boardsError, setBoardsError] = useState<string | null>(null);
  const boardsOwner = useRef(scopeOwner);

  useEffect(() => {
    if (busy || !active) return;
    if (!status?.connected) {
      setBoards([]);
      setBoardsLoading(false);
      return;
    }
    let cancelled = false;
    if (boardsOwner.current !== scopeOwner) setBoards([]);
    boardsOwner.current = scopeOwner;
    setBoardsError(null);
    setBoardsLoading(true);
    void listJiraBoards({ includeUnselected: true })
      .then((next) => {
        if (!cancelled) setBoards(next);
      })
      .catch((err: unknown) => {
        if (!cancelled) setBoardsError(String(err instanceof Error ? err.message : err));
      })
      .finally(() => {
        if (!cancelled) setBoardsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [status?.connected, scopeOwner, busy, active, hiddenIds, projects, boardsRevision]);

  const loadProjects = useCallback(async () => {
    const generation = ++projectRequest.current;
    const account = request.current;
    setProjectsError(null);
    setProjectsLoading(true);
    try {
      const next = await listJiraProjects();
      if (generation === projectRequest.current && account === request.current) setProjects(next);
    } catch (err) {
      if (generation === projectRequest.current && account === request.current)
        setProjectsError(String(err instanceof Error ? err.message : err));
    } finally {
      if (generation === projectRequest.current && account === request.current)
        setProjectsLoading(false);
    }
  }, []);

  const checkStatus = useCallback(async () => {
    const generation = ++request.current;
    setChecking(true);
    setStatusError(null);
    try {
      const next = await jiraConnected();
      if (generation !== request.current) return;
      const owner = `${next.site}\0${next.email}`;
      if (projectOwner.current !== owner) setProjects([]);
      projectOwner.current = owner;
      setStatus(next);
      if (next.connected) await loadProjects();
    } catch (err: unknown) {
      if (generation === request.current)
        setStatusError(String(err instanceof Error ? err.message : err));
    } finally {
      if (generation === request.current) setChecking(false);
    }
  }, [loadProjects]);

  useEffect(() => {
    void checkStatus();
    const onChange = () => {
      setBackgroundState(readBackgroundSync());
    };
    const onStorage = (event: StorageEvent) => {
      if (event.key === null || event.key === "bycoda.jiraBackgroundSync") onChange();
    };
    window.addEventListener(JIRA_CHANGE_EVENT, onChange);
    window.addEventListener("storage", onStorage);
    return () => {
      request.current += 1;
      projectRequest.current += 1;
      window.removeEventListener(JIRA_CHANGE_EVENT, onChange);
      window.removeEventListener("storage", onStorage);
    };
  }, [checkStatus]);

  const connect = async () => {
    if (busy || checking || mutation.current || !site.trim() || !email.trim() || !token.trim())
      return;
    mutation.current = true;
    request.current += 1;
    projectRequest.current += 1;
    setProjectsLoading(false);
    setBoardsLoading(false);
    setOperation("save");
    setError(null);
    try {
      const next = await saveJiraConfig({ site, email, token });
      if (!next.connected)
        throw new Error(t("Connection test failed. Check your credentials and retry."));
      const owner = `${next.site}\0${next.email}`;
      if (projectOwner.current !== owner) setProjects([]);
      projectOwner.current = owner;
      setStatus(next);
      setEditing(false);
      setStatusError(null);
      verification.markVerified();
      setToken("");
      clearInboxCache();
      // Reconnecting must preserve the owner's existing scope choices.
      notifyJiraChange();
      await loadProjects();
    } catch (err) {
      setError(String(err instanceof Error ? err.message : err));
    } finally {
      mutation.current = false;
      setOperation(null);
    }
  };

  const disconnect = async () => {
    if (busy || checking || mutation.current) return;
    mutation.current = true;
    request.current += 1;
    projectRequest.current += 1;
    setProjectsLoading(false);
    setBoardsLoading(false);
    setOperation("disconnect");
    setError(null);
    try {
      setStatus(await disconnectJira());
      verification.clearVerified();
      setProjects([]);
      setToken("");
      clearInboxCache();
      notifyJiraChange();
    } catch (err) {
      setError(String(err instanceof Error ? err.message : err));
    } finally {
      mutation.current = false;
      setOperation(null);
    }
  };

  const setVisibleProjects = (visible: string[]) => {
    const known = new Set(projects.map((project) => project.id));
    clearInboxCache();
    projectScope.update((current) => [
      ...current.filter((id) => !known.has(id)),
      ...projects.filter((project) => !visible.includes(project.id)).map((project) => project.id),
    ]);
  };
  const setAllowedBoards = (selected: string[]) => {
    const known = new Set(boards.map((board) => board.id));
    boardScope.update((current) => [
      ...current.filter((id) => !known.has(id)),
      ...boards.filter((board) => selected.includes(String(board.id))).map((board) => board.id),
    ]);
  };

  return (
    <>
      <InboxConnectionStatus
        checking={checking}
        busy={busy || Boolean(token)}
        configured={Boolean(status?.connected)}
        verifiedAt={verification.verifiedAt}
        error={statusError}
        onCheck={() => void checkStatus()}
      />
      <Row
        label={t("Account")}
        stacked={!checking && !(status?.connected && !editing)}
        info={t(
          "Connect your Jira Cloud site using your Atlassian email and an API token without scopes. Disconnect deletes the saved credentials.",
        )}
        persistence={{
          mode: "explicit",
          state: operation === "save" ? "saving" : token ? "dirty" : "idle",
        }}
      >
        <div
          className="inbox-credential w-full min-w-0"
          data-state={checking || (status?.connected && !editing) ? "summary" : "form"}
        >
          {checking ? (
            <LoadingText>{t("Checking Jira connection…")}</LoadingText>
          ) : status?.connected && !editing ? (
            <div className="inbox-account-summary">
              <Text as="div" size="caption" tone="secondary" className="min-w-0">
                <p className="break-all">{status.site}</p>
                <p className="flex min-w-0">
                  <PrivateEmail key={status.email} email={status.email} />
                </p>
              </Text>
              <Button
                stableWidth
                disabled={busy}
                onClick={() => {
                  setSite(status.site);
                  setEmail(status.email);
                  setEditing(true);
                }}
              >
                {t("Edit")}
              </Button>
              <InboxAccountActions
                onDisconnect={() => void disconnect()}
                loading={operation === "disconnect"}
                disabled={busy}
              />
            </div>
          ) : (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void connect();
              }}
              className="flex flex-col gap-3"
            >
              {(
                [
                  {
                    get label() {
                      return t("Jira site");
                    },
                    value: site,
                    set: setSite,
                    type: "text",
                    get placeholder() {
                      return t("yourteam.atlassian.net");
                    },
                  },
                  {
                    get label() {
                      return t("Atlassian email");
                    },
                    value: email,
                    set: setEmail,
                    type: "email",
                    get placeholder() {
                      return t("you@example.com");
                    },
                  },
                  {
                    get label() {
                      return t("Jira API token");
                    },
                    value: token,
                    set: setToken,
                    type: "password",
                    get placeholder() {
                      return t("API token");
                    },
                  },
                ] as const
              ).map((field) => {
                const Input = field.type === "password" ? PasswordField : TextField;
                return (
                  <Input
                    key={field.label}
                    label={field.label}
                    aria-label={field.label}
                    {...(field.type === "password" ? {} : { type: field.type })}
                    value={field.value}
                    onChange={(event) => field.set(event.target.value)}
                    placeholder={field.placeholder}
                    disabled={busy}
                    required
                    autoComplete="off"
                    spellCheck={false}
                  />
                );
              })}
              <div className="flex items-center gap-3">
                {status?.connected ? (
                  <Button
                    stableWidth
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      setEditing(false);
                      setToken("");
                    }}
                  >
                    {t("Cancel")}
                  </Button>
                ) : null}
                <Button
                  stableWidth
                  className="shrink-0"
                  type="submit"
                  loading={operation === "save"}
                  disabled={busy || !site.trim() || !email.trim() || !token.trim()}
                  reserveLabels={[t("Saving and testing…"), t("Retry save and test")]}
                >
                  {busy
                    ? t("Saving and testing…")
                    : error
                      ? t("Retry save and test")
                      : t("Save and test connection")}
                </Button>
                <Button
                  stableWidth
                  variant="link"
                  type="button"
                  onClick={() =>
                    void openUrl(
                      "https://id.atlassian.com/manage-profile/security/api-tokens",
                    ).catch((err: unknown) => setError(String(err)))
                  }
                >
                  {t("Create API token")}
                </Button>
              </div>
            </form>
          )}
        </div>
      </Row>
      <InboxConnectionError error={error} />
      {status?.connected ? (
        <>
          <JiraDefaultProjectSettings
            projects={projects}
            boards={boards}
            disabled={busy || checking}
          />
          <Row
            stacked
            label={t("Projects")}
            info={t("Unchecked projects stay out of the inbox.")}
            persistence={{ mode: "automatic" }}
          >
            <div className="inbox-scope">
              <InboxConnectionError error={projectsError} />
              {projectScope.error ? (
                <SettingsFeedback
                  state="error"
                  action={
                    <Button stableWidth onClick={projectScope.retry}>
                      {t("Retry")}
                    </Button>
                  }
                >
                  {t("Saved Inbox scope is unavailable. Retry before changing it.")}
                </SettingsFeedback>
              ) : null}
              {projectScope.available ? (
                <InboxScopeCollection
                  label={t("Projects")}
                  searchLabel={t("Search projects")}
                  items={projects.map((project) => ({
                    id: project.id,
                    title: project.name,
                    meta: project.key,
                  }))}
                  selectedIds={projects
                    .filter((project) => !hiddenIds.includes(project.id))
                    .map((project) => project.id)}
                  onChange={setVisibleProjects}
                  disabled={busy || checking || projectsLoading || Boolean(projectsError)}
                  loading={projectsLoading}
                  summary={(count, total) =>
                    t("{p0} of {p1} projects selected", { p0: count, p1: total })
                  }
                  emptyLabel={t("No projects available. Refresh projects to try again.")}
                  noMatchLabel={t("No matching projects")}
                  actions={
                    <Button
                      stableWidth
                      className="shrink-0"
                      size="sm"
                      loading={projectsLoading}
                      disabled={busy || checking || projectsLoading}
                      onClick={() => void loadProjects()}
                    >
                      {projectsLoading ? t("Loading…") : t("Refresh projects")}
                    </Button>
                  }
                />
              ) : null}
            </div>
          </Row>
          <Row
            stacked
            label={t("Boards")}
            info={t("Only checked boards from selected projects appear in the inbox.")}
            persistence={{ mode: "automatic" }}
          >
            <div className="inbox-scope">
              {boardsError ? (
                <SettingsFeedback state="error">{boardsError}</SettingsFeedback>
              ) : null}
              {boardScope.error ? (
                <SettingsFeedback
                  state="error"
                  action={
                    <Button stableWidth onClick={boardScope.retry}>
                      {t("Retry")}
                    </Button>
                  }
                >
                  {t("Saved Inbox scope is unavailable. Retry before changing it.")}
                </SettingsFeedback>
              ) : null}
              {boardScope.available ? (
                <InboxScopeCollection
                  label={t("Boards")}
                  searchLabel={t("Search boards")}
                  items={boards.map((board) => ({
                    id: String(board.id),
                    title: board.name,
                    meta: board.kind,
                  }))}
                  selectedIds={boards
                    .filter((board) => allowedBoardIds.includes(board.id))
                    .map((board) => String(board.id))}
                  onChange={setAllowedBoards}
                  disabled={busy || checking || boardsLoading || Boolean(boardsError)}
                  loading={boardsLoading}
                  summary={(count, total) =>
                    t("{p0} of {p1} boards selected", { p0: count, p1: total })
                  }
                  emptyLabel={t("No boards available. Select projects and refresh boards.")}
                  noMatchLabel={t("No matching boards")}
                  actions={
                    <Button
                      stableWidth
                      className="shrink-0"
                      size="sm"
                      loading={boardsLoading}
                      disabled={busy || checking || boardsLoading}
                      onClick={() => setBoardsRevision((value) => value + 1)}
                    >
                      {boardsLoading
                        ? t("Loading…")
                        : boardsError
                          ? t("Retry")
                          : t("Refresh boards")}
                    </Button>
                  }
                />
              ) : null}
            </div>
          </Row>
        </>
      ) : null}
      {status?.connected ? (
        <Row
          label={t("Automatically refresh Jira in the background")}
          info={t(
            "Off by default. Jira loads when opened or refreshed manually. Background notifications and Jira triggers require this option.",
          )}
          persistence={{ mode: "automatic" }}
          feedback={
            !backgroundState.available ? (
              <SettingsFeedback
                state="error"
                action={
                  <Button stableWidth onClick={() => setBackgroundState(readBackgroundSync())}>
                    {t("Retry")}
                  </Button>
                }
              >
                {t("Saved Inbox scope is unavailable. Retry before changing it.")}
              </SettingsFeedback>
            ) : undefined
          }
        >
          <Toggle
            label={t("Automatically refresh Jira in the background")}
            on={backgroundState.value}
            disabled={busy || !backgroundState.available}
            onChange={(next) => {
              try {
                saveJiraBackgroundSync(next);
                setBackgroundState(readBackgroundSync());
              } catch {
                setBackgroundState((previous) => ({ ...previous, available: false }));
              }
            }}
          />
        </Row>
      ) : null}
    </>
  );
}
