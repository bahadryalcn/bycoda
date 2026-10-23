import { InfoPopover } from "../../../shared/ui/InfoPopover";
import { SettingsFeedback, Toggle } from "./settingsControls";
import { SearchableSelect } from "../../../shared/ui/SearchableSelect";
import { t, useLocale } from "../../../shared/i18n";
import { useCallback, useEffect, useRef, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Row } from "./settingsControls";
import { InboxConnectionStatus, InboxConnectionError } from "./InboxConnectionStatus";
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
  loadAllowedJiraBoardIds,
  saveAllowedJiraBoardIds,
  listJiraProjects,
  loadHiddenJiraProjectIds,
  notifyJiraChange,
  saveHiddenJiraProjectIds,
  saveJiraConfig,
  type JiraProject,
  type JiraStatus,
} from "../../inbox/model/jira";
import { listJiraBoards, type JiraBoard } from "../../inbox/model/jiraBoard";

export function JiraSettings() {
  useLocale();
  const [status, setStatus] = useState<JiraStatus | null>(null);
  const [site, setSite] = useState("");
  const [email, setEmail] = useState("");
  const [token, setToken] = useState("");
  const [checking, setChecking] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const request = useRef(0);
  const [projectsError, setProjectsError] = useState<string | null>(null);
  const [projectsLoading, setProjectsLoading] = useState(false);
  const [boardsLoading, setBoardsLoading] = useState(false);
  const [boardsRevision, setBoardsRevision] = useState(0);
  const [projects, setProjects] = useState<JiraProject[]>([]);
  const [hiddenIds, setHiddenIds] = useState(loadHiddenJiraProjectIds);
  const [allowedBoardIds, setAllowedBoardIds] = useState(loadAllowedJiraBoardIds);
  const [backgroundSync, setBackgroundSync] = useState(jiraBackgroundSyncEnabled);
  const [boards, setBoards] = useState<JiraBoard[]>([]);
  const [boardsError, setBoardsError] = useState<string | null>(null);

  useEffect(() => {
    if (!status?.connected) {
      setBoards([]);
      setBoardsLoading(false);
      return;
    }
    let cancelled = false;
    setBoards([]);
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
  }, [status?.connected, hiddenIds, projects, boardsRevision]);

  const loadProjects = useCallback(async () => {
    setProjectsError(null);
    setProjectsLoading(true);
    try {
      setProjects(await listJiraProjects());
    } catch (err) {
      setProjectsError(String(err instanceof Error ? err.message : err));
    } finally {
      setProjectsLoading(false);
    }
  }, []);

  const checkStatus = useCallback(async () => {
    const generation = ++request.current;
    setChecking(true);
    setError(null);
    try {
      const next = await jiraConnected();
      if (generation !== request.current) return;
      setStatus(next);
      if (next.connected) await loadProjects();
    } catch (err: unknown) {
      if (generation === request.current)
        setError(String(err instanceof Error ? err.message : err));
    } finally {
      if (generation === request.current) setChecking(false);
    }
  }, [loadProjects]);

  useEffect(() => {
    void checkStatus();
    const onChange = () => {
      setHiddenIds(loadHiddenJiraProjectIds());
      setAllowedBoardIds(loadAllowedJiraBoardIds());
      setBackgroundSync(jiraBackgroundSyncEnabled());
    };
    window.addEventListener(JIRA_CHANGE_EVENT, onChange);
    return () => {
      request.current += 1;
      window.removeEventListener(JIRA_CHANGE_EVENT, onChange);
    };
  }, [checkStatus]);

  const connect = async () => {
    if (busy || checking || !site.trim() || !email.trim() || !token.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const next = await saveJiraConfig({ site, email, token });
      if (!next.connected)
        throw new Error(t("Connection test failed. Check your credentials and retry."));
      setStatus(next);
      setToken("");
      clearInboxCache();
      // Reconnecting must preserve the owner's existing scope choices.
      notifyJiraChange();
      await loadProjects();
    } catch (err) {
      setError(String(err instanceof Error ? err.message : err));
    } finally {
      setBusy(false);
    }
  };

  const disconnect = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      setStatus(await disconnectJira());
      setProjects([]);
      setToken("");
      clearInboxCache();
      notifyJiraChange();
    } catch (err) {
      setError(String(err instanceof Error ? err.message : err));
    } finally {
      setBusy(false);
    }
  };

  const setVisibleProjects = (visible: string[]) => {
    const known = new Set(projects.map((project) => project.id));
    clearInboxCache();
    saveHiddenJiraProjectIds([
      ...hiddenIds.filter((id) => !known.has(id)),
      ...projects.filter((project) => !visible.includes(project.id)).map((project) => project.id),
    ]);
  };
  const setAllowedBoards = (selected: string[]) => {
    const known = new Set(boards.map((board) => board.id));
    saveAllowedJiraBoardIds([
      ...allowedBoardIds.filter((id) => !known.has(id)),
      ...boards.filter((board) => selected.includes(String(board.id))).map((board) => board.id),
    ]);
  };

  return (
    <>
      <InboxConnectionStatus
        checking={checking}
        busy={busy || Boolean(token)}
        configured={Boolean(status?.connected)}
        error={error}
        onCheck={() => void checkStatus()}
      />
      <Row
        label={t("Account configuration")}
        description={t(
          "Connect your Jira Cloud site using your Atlassian email and an API token without scopes. Disconnect deletes the saved credentials.",
        )}
        persistence={{ mode: "explicit", state: busy ? "saving" : token ? "dirty" : "idle" }}
      >
        <div className="w-full min-w-0">
          {checking ? (
            <p className="text-ui-caption text-(--ui-text-muted)">
              {t("Checking Jira connection…")}
            </p>
          ) : status?.connected ? (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0 text-ui-caption text-(--ui-text-secondary)">
                <p className="break-all">{status.site}</p>
                <p className="flex min-w-0">
                  <PrivateEmail key={status.email} email={status.email} />
                </p>
              </div>
              <Button className="shrink-0" onClick={() => void disconnect()} disabled={busy}>
                {busy ? t("Disconnecting") : t("Disconnect")}
              </Button>
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
              ).map((field) => (
                <TextField
                  key={field.label}
                  label={field.label}
                  aria-label={field.label}
                  type={field.type}
                  value={field.value}
                  onChange={(event) => field.set(event.target.value)}
                  placeholder={field.placeholder}
                  disabled={busy}
                  required
                  autoComplete="off"
                  spellCheck={false}
                />
              ))}
              <div className="flex items-center gap-3">
                <Button
                  className="shrink-0"
                  type="submit"
                  disabled={busy || !site.trim() || !email.trim() || !token.trim()}
                >
                  {busy
                    ? t("Saving and testing…")
                    : error
                      ? t("Retry save and test")
                      : t("Save and test connection")}
                </Button>
                <Button
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
        <Row label={t("Inbox scope")} persistence={{ mode: "automatic" }}>
          <div className="inbox-scope">
            <section aria-label={t("Projects")}>
              <div className="inbox-scope-heading">
                <span className="inline-flex items-center gap-1 text-ui-secondary font-medium text-content">
                  {t("Projects")}
                  <InfoPopover className="shrink-0">
                    <p>{t("Unchecked projects stay out of the inbox.")}</p>
                  </InfoPopover>
                </span>
                <Button
                  className="shrink-0"
                  disabled={busy || checking || projectsLoading}
                  onClick={() => void loadProjects()}
                >
                  {projectsLoading ? t("Loading…") : t("Refresh projects")}
                </Button>
              </div>
              <InboxConnectionError error={projectsError} />
              <SearchableSelect
                multiple
                label={t("Projects")}
                options={projects.map((project) => ({
                  value: project.id,
                  label: `${project.name} · ${project.key}`,
                  keywords: project.key,
                }))}
                value={projects
                  .filter((project) => !hiddenIds.includes(project.id))
                  .map((project) => project.id)}
                onChange={setVisibleProjects}
                disabled={busy}
                placeholder={t("{p0} of {p1} projects selected", { p0: 0, p1: projects.length })}
                searchPlaceholder={t("Search projects")}
                emptyLabel={t("No matching projects")}
                selectionLabels={{
                  summary: (count) =>
                    t("{p0} of {p1} projects selected", { p0: count, p1: projects.length }),
                }}
              />
              {projects.length === 0 && !projectsError && !projectsLoading ? (
                <p className="inbox-scope-help">
                  {t("No projects available. Refresh projects to try again.")}
                </p>
              ) : null}
            </section>
            <section aria-label={t("Boards")}>
              <div className="inbox-scope-heading">
                <span className="inline-flex items-center gap-1 text-ui-secondary font-medium text-content">
                  {t("Boards")}
                  <InfoPopover className="shrink-0">
                    <p>{t("Only checked boards from selected projects appear in the inbox.")}</p>
                  </InfoPopover>
                </span>
                <Button
                  className="shrink-0"
                  disabled={busy || checking || boardsLoading}
                  onClick={() => setBoardsRevision((value) => value + 1)}
                >
                  {boardsLoading ? t("Loading…") : boardsError ? t("Retry") : t("Refresh boards")}
                </Button>
              </div>
              {boardsError ? (
                <SettingsFeedback state="error">{boardsError}</SettingsFeedback>
              ) : null}
              {boards.length > 0 ? (
                <SearchableSelect
                  multiple
                  label={t("Boards")}
                  options={boards.map((board) => ({
                    value: String(board.id),
                    label: `${board.name} · ${board.kind}`,
                  }))}
                  value={boards
                    .filter((board) => allowedBoardIds.includes(board.id))
                    .map((board) => String(board.id))}
                  onChange={setAllowedBoards}
                  disabled={busy}
                  placeholder={t("{p0} of {p1} boards selected", { p0: 0, p1: boards.length })}
                  searchPlaceholder={t("Search boards")}
                  selectionLabels={{
                    summary: (count) =>
                      t("{p0} of {p1} boards selected", { p0: count, p1: boards.length }),
                  }}
                />
              ) : null}
              {boards.length === 0 && !boardsError && !boardsLoading ? (
                <p className="inbox-scope-help">
                  {t("No boards available. Select projects and refresh boards.")}
                </p>
              ) : null}
            </section>
          </div>
        </Row>
      ) : null}
      {status?.connected ? (
        <Row
          label={t("Automatically refresh Jira in the background")}
          description={t(
            "Off by default. Jira loads when opened or refreshed manually. Background notifications and Jira triggers require this option.",
          )}
          persistence={{ mode: "automatic" }}
        >
          <Toggle
            label={t("Automatically refresh Jira in the background")}
            on={backgroundSync}
            disabled={busy}
            onChange={saveJiraBackgroundSync}
          />
        </Row>
      ) : null}
    </>
  );
}
