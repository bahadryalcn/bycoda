import { t, useLocale } from "../../../shared/i18n";
import { useCallback, useEffect, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { SecondaryButton } from "../../../shared/ui/SecondaryButton";
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
  const [projects, setProjects] = useState<JiraProject[]>([]);
  const [hiddenIds, setHiddenIds] = useState(loadHiddenJiraProjectIds);
  const [allowedBoardIds, setAllowedBoardIds] = useState(loadAllowedJiraBoardIds);
  const [backgroundSync, setBackgroundSync] = useState(jiraBackgroundSyncEnabled);
  const [boards, setBoards] = useState<JiraBoard[]>([]);
  const [boardsError, setBoardsError] = useState<string | null>(null);

  useEffect(() => {
    if (!status?.connected) {
      setBoards([]);
      return;
    }
    let cancelled = false;
    setBoards([]);
    setBoardsError(null);
    void listJiraBoards({ includeUnselected: true })
      .then((next) => {
        if (!cancelled) setBoards(next);
      })
      .catch((err: unknown) => {
        if (!cancelled) setBoardsError(String(err instanceof Error ? err.message : err));
      });
    return () => {
      cancelled = true;
    };
  }, [status?.connected, hiddenIds, projects]);

  const loadProjects = useCallback(async () => {
    try {
      setProjects(await listJiraProjects());
    } catch (err) {
      setProjects([]);
      setError(String(err instanceof Error ? err.message : err));
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    void jiraConnected()
      .then(async (next) => {
        if (cancelled) return;
        setStatus(next);
        if (next.connected) await loadProjects();
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(String(err instanceof Error ? err.message : err));
      })
      .finally(() => {
        if (!cancelled) setChecking(false);
      });
    const onChange = () => {
      setHiddenIds(loadHiddenJiraProjectIds());
      setAllowedBoardIds(loadAllowedJiraBoardIds());
      setBackgroundSync(jiraBackgroundSyncEnabled());
    };
    window.addEventListener(JIRA_CHANGE_EVENT, onChange);
    return () => {
      cancelled = true;
      window.removeEventListener(JIRA_CHANGE_EVENT, onChange);
    };
  }, [loadProjects]);

  const connect = async () => {
    if (busy || checking || !site.trim() || !email.trim() || !token.trim()) return;
    setBusy(true);
    setError(null);
    try {
      setStatus(await saveJiraConfig({ site, email, token }));
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

  return (
    <div className="px-4 py-3.5">
      {checking ? (
        <p className="text-[12px] text-content/45">{t("Checking Jira connection…")}</p>
      ) : status?.connected ? (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0 text-[12px] text-content/65">
            <p className="break-all">{status.site}</p>
            <p className="flex min-w-0">
              <PrivateEmail key={status.email} email={status.email} />
            </p>
          </div>
          <SecondaryButton onClick={() => void disconnect()} disabled={busy}>
            {busy ? t("Disconnecting") : t("Disconnect")}
          </SecondaryButton>
        </div>
      ) : (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void connect();
          }}
          className="flex flex-col gap-3"
        >
          <p className="text-[12px] leading-relaxed text-content/45">
            {t(
              "Connect your Jira Cloud site using your Atlassian email and an API token without scopes. Disconnect deletes the saved credentials.",
            )}
          </p>
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
            <label key={field.label} className="flex flex-col gap-1 text-[12px] text-content/65">
              {field.label}
              <input
                aria-label={field.label}
                type={field.type}
                value={field.value}
                onChange={(event) => field.set(event.target.value)}
                placeholder={field.placeholder}
                disabled={busy}
                required
                autoComplete="off"
                spellCheck={false}
                className="h-8 w-full rounded-md border border-content/10 bg-transparent px-2 text-content outline-none focus:border-content/20"
              />
            </label>
          ))}
          <div className="flex items-center gap-3">
            <SecondaryButton
              type="submit"
              disabled={busy || !site.trim() || !email.trim() || !token.trim()}
            >
              {busy ? t("Connecting") : t("Connect")}
            </SecondaryButton>
            <button
              type="button"
              onClick={() =>
                void openUrl("https://id.atlassian.com/manage-profile/security/api-tokens")
              }
              className="text-[12px] text-content/65 hover:text-content"
            >
              {t("Create API token")}
            </button>
          </div>
        </form>
      )}
      {error ? (
        <p role="alert" className="mt-3 text-[12px] text-red-400/90">
          {error}
        </p>
      ) : null}
      {status?.connected ? (
        <div className="mt-4 flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <span className="text-[13px] font-medium text-content">{t("Projects")}</span>
            <SecondaryButton disabled={busy || checking} onClick={() => void loadProjects()}>
              {t("Refresh projects")}
            </SecondaryButton>
          </div>
          <p className="text-[12px] text-content/45">
            {t("Unchecked projects stay out of the inbox.")}
          </p>
          {projects.map((project) => (
            <label key={project.id} className="flex items-center gap-2 text-[13px] text-content">
              <input
                type="checkbox"
                checked={!hiddenIds.includes(project.id)}
                disabled={busy}
                onChange={() => {
                  const next = hiddenIds.includes(project.id)
                    ? hiddenIds.filter((id) => id !== project.id)
                    : [...hiddenIds, project.id];
                  clearInboxCache();
                  saveHiddenJiraProjectIds(next);
                }}
              />
              {project.name} <span className="text-content/40">{project.key}</span>
            </label>
          ))}
          <span className="text-[13px] font-medium text-content">{t("Boards")}</span>
          <p className="text-[12px] text-content/45">
            {t("Only checked boards from selected projects appear in the inbox.")}
          </p>
          {boardsError ? (
            <p role="alert" className="text-[12px] text-red-400/90">
              {boardsError}
            </p>
          ) : null}
          {boards.map((board) => (
            <label key={board.id} className="flex items-center gap-2 text-[13px] text-content">
              <input
                type="checkbox"
                checked={allowedBoardIds.includes(board.id)}
                disabled={busy}
                onChange={() =>
                  saveAllowedJiraBoardIds(
                    allowedBoardIds.includes(board.id)
                      ? allowedBoardIds.filter((id) => id !== board.id)
                      : [...allowedBoardIds, board.id],
                  )
                }
              />
              {board.name} · {board.kind}
            </label>
          ))}
          <label className="flex items-center gap-2 text-[13px] text-content">
            <input
              type="checkbox"
              checked={backgroundSync}
              disabled={busy}
              onChange={(event) => saveJiraBackgroundSync(event.target.checked)}
            />
            {t("Automatically refresh Jira in the background")}
          </label>
          <p className="text-[12px] text-content/45">
            {t(
              "Off by default. Jira loads when opened or refreshed manually. Background notifications and Jira triggers require this option.",
            )}
          </p>
        </div>
      ) : null}
    </div>
  );
}
