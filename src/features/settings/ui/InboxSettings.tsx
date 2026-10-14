import { openUrl } from "@tauri-apps/plugin-opener";
import { t, useLocale } from "../../../shared/i18n";
import { PRODUCT_IDENTITY } from "../../../shared/lib/productIdentity";

import { useCallback, useEffect, useRef, useState } from "react";
import { Check } from "../../../shared/ui/icons";

import { SecondaryButton } from "../../../shared/ui/SecondaryButton";

import { JiraSettings } from "./JiraSettings";
import { InboxConnectionStatus, InboxConnectionError } from "./InboxConnectionStatus";

import { InboxProviderMark } from "../../inbox/ui/InboxProviderMark";

import {
  azureDevOpsConnected,
  disconnectAzureDevOps,
  saveAzureDevOpsConfig,
} from "../../inbox/model/azureDevOps";
import { clearInboxCache, githubStatus, type GithubStatus } from "../../inbox/model/githubTasks";
import { disconnectGitlab, gitlabConnected, saveGitlabConfig } from "../../inbox/model/gitlab";
import {
  disconnectLinear,
  LINEAR_CHANGE_EVENT,
  linearConnected,
  listLinearTeams,
  loadHiddenLinearTeamIds,
  notifyLinearChange,
  saveHiddenLinearTeamIds,
  saveLinearToken,
  type LinearTeam,
} from "../../inbox/model/linear";

import { Group, Row } from "./settingsControls";

export function InboxPage() {
  useLocale();
  return (
    <>
      <Group
        layout="full"
        scope={t("This computer · Inbox account")}
        id="github"
        title={
          <span className="flex items-center gap-2">
            <InboxProviderMark provider="github" className="size-4 shrink-0" />
            GitHub
          </span>
        }
        description={t("Pull requests, reviews, and issues, read through the GitHub CLI.")}
      >
        <GithubSettings />
      </Group>

      <Group
        layout="full"
        scope={t("This computer · Inbox account")}
        id="gitlab"
        title={
          <span className="flex items-center gap-2">
            <InboxProviderMark provider="gitlab" className="size-4 shrink-0" />
            GitLab
          </span>
        }
        description={t("Merge requests from GitLab.com or a self-managed instance.")}
      >
        <GitlabSettings />
      </Group>

      <Group
        layout="full"
        scope={t("This computer · Inbox account")}
        id="azuredevops"
        title={
          <span className="flex items-center gap-2">
            <InboxProviderMark provider="azuredevops" className="size-4 shrink-0" />
            Azure DevOps
          </span>
        }
        description={t("Pull requests and Boards work items from your ADO organization.")}
      >
        <AzureDevOpsSettings />
      </Group>

      <Group
        layout="full"
        scope={t("This computer · Inbox account")}
        id="jira"
        title={
          <span className="flex items-center gap-2">
            <InboxProviderMark provider="jira" className="size-4 shrink-0" />
            Jira
          </span>
        }
        description={t("Jira Cloud issues from the projects you pick.")}
      >
        <JiraSettings />
      </Group>

      <Group
        layout="full"
        scope={t("This computer · Inbox account")}
        id="linear"
        title={
          <span className="flex items-center gap-2">
            <InboxProviderMark provider="linear" className="size-4 shrink-0" />
            Linear
          </span>
        }
        description={t("Issues assigned to you, from the teams you pick.")}
      >
        <LinearSettings />
      </Group>
    </>
  );
}

export function GithubSettings() {
  useLocale();
  const [status, setStatus] = useState<GithubStatus | null>(null);
  const [checking, setChecking] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const request = useRef(0);

  const checkStatus = useCallback(async () => {
    const generation = ++request.current;
    setChecking(true);
    setError(null);
    try {
      const next = await githubStatus();
      if (generation === request.current) setStatus(next);
    } catch (err: unknown) {
      if (generation === request.current) {
        setError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      if (generation === request.current) setChecking(false);
    }
  }, []);

  useEffect(() => {
    void checkStatus();
    return () => {
      request.current += 1;
    };
  }, [checkStatus]);

  const description = error
    ? t("Could not check GitHub CLI. Retry on this computer.")
    : checking || !status
      ? t("Checking GitHub CLI on this computer.")
      : status?.connected
        ? t("GitHub CLI is installed and authenticated. {p0} uses it for GitHub inbox items.", {
            p0: PRODUCT_IDENTITY.displayName,
          })
        : status?.installed
          ? t("Run gh auth login on this computer, complete sign-in, then check again.")
          : t(
              "Install GitHub CLI on this computer from cli.github.com, run gh auth login, then check again.",
            );
  const label = checking
    ? t("Checking")
    : error || !status
      ? t("Check failed")
      : status?.connected
        ? t("Connected")
        : status?.installed
          ? t("Sign in required")
          : t("Not installed");

  return (
    <>
      <Row
        label={t("Connection")}
        description={description}
        scope={t("This computer · GitHub CLI account")}
      >
        <span role="status" aria-live="polite" className="text-[12px] text-content/50">
          {label}
        </span>
        {!checking && status && !status.installed ? (
          <SecondaryButton
            onClick={() => {
              void openUrl("https://cli.github.com/").catch((err: unknown) =>
                setError(String(err)),
              );
            }}
          >
            {t("Installation guide")}
          </SecondaryButton>
        ) : null}
        <SecondaryButton onClick={() => void checkStatus()} disabled={checking}>
          {checking ? t("Checking") : t("Check again")}
        </SecondaryButton>
      </Row>
      <InboxConnectionError error={error} />
    </>
  );
}

export function GitlabSettings() {
  useLocale();
  const [url, setUrl] = useState("https://gitlab.com");
  const [token, setToken] = useState("");
  const [connected, setConnected] = useState(false);
  const [checking, setChecking] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const request = useRef(0);
  const checkStatus = useCallback(async (hydrate = false) => {
    const generation = ++request.current;
    setChecking(true);
    setError(null);
    try {
      const status = await gitlabConnected();
      if (generation !== request.current) return;
      setConnected(status.connected);
      if (hydrate) setUrl(status.url);
    } catch (err: unknown) {
      if (generation === request.current)
        setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (generation === request.current) setChecking(false);
    }
  }, []);

  useEffect(() => {
    void checkStatus(true);
    return () => {
      request.current += 1;
    };
  }, [checkStatus]);

  const onSave = async () => {
    if (!url.trim() || !token.trim() || busy || checking) return;
    setBusy(true);
    setError(null);
    try {
      const status = await saveGitlabConfig(url, token);
      if (!status.connected)
        throw new Error(t("Connection test failed. Check your credentials and retry."));
      setUrl(status.url);
      setToken("");
      setConnected(status.connected);
      clearInboxCache();
    } catch (err: unknown) {
      setConnected(false);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const onDisconnect = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const status = await disconnectGitlab(url);
      setConnected(false);
      setUrl(status.url);
      clearInboxCache();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <InboxConnectionStatus
        checking={checking}
        busy={busy || Boolean(token)}
        configured={connected}
        error={error}
        onCheck={() => void checkStatus()}
      />
      <Row
        label={t("Account configuration")}
        persistence={{ mode: "explicit", state: busy ? "saving" : token ? "dirty" : "idle" }}
        description={t(
          "Connect GitLab.com or a self-managed GitLab instance. Use a personal access token with API access; the token is stored locally and Disconnect deletes it.",
        )}
      >
        {connected ? (
          <div className="flex min-w-0 max-w-full flex-wrap items-center gap-2">
            <span title={url} className="max-w-56 break-all text-[12px] text-content/50">
              {url}
            </span>
            <SecondaryButton onClick={() => void onDisconnect()} disabled={busy || checking}>
              {busy ? t("Disconnecting") : t("Disconnect")}
            </SecondaryButton>
          </div>
        ) : (
          <div className="flex min-w-0 max-w-full flex-wrap items-center gap-2">
            <label className="flex w-64 max-w-full flex-col gap-1 text-[12px] text-content/65">
              {t("GitLab URL")}
              <input
                type="url"
                value={url}
                onChange={(event) => setUrl(event.target.value)}
                placeholder="https://gitlab.com"
                aria-label={t("GitLab URL")}
                autoComplete="url"
                spellCheck={false}
                disabled={busy || checking}
                className="h-8 min-w-0 rounded-md border border-content/10 bg-transparent px-2 text-[12px] text-content focus-visible:outline-2 focus-visible:outline-accent placeholder:text-content/35"
              />
            </label>
            <label className="flex w-64 max-w-full flex-col gap-1 text-[12px] text-content/65">
              {t("GitLab access token")}
              <input
                type="password"
                value={token}
                onChange={(event) => setToken(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") void onSave();
                }}
                placeholder={t("glpat-…")}
                aria-label={t("GitLab access token")}
                autoComplete="off"
                spellCheck={false}
                disabled={busy || checking}
                className="h-8 min-w-0 rounded-md border border-content/10 bg-transparent px-2 text-[12px] text-content focus-visible:outline-2 focus-visible:outline-accent placeholder:text-content/35"
              />
            </label>
            <SecondaryButton
              onClick={() => void onSave()}
              disabled={busy || checking || !url.trim() || !token.trim()}
            >
              {busy
                ? t("Saving and testing…")
                : error
                  ? t("Retry save and test")
                  : t("Save and test connection")}
            </SecondaryButton>
          </div>
        )}
      </Row>
      <InboxConnectionError error={error} />
    </>
  );
}

export function AzureDevOpsSettings() {
  useLocale();
  const [url, setUrl] = useState("https://dev.azure.com/myorg");
  const [token, setToken] = useState("");
  const [connected, setConnected] = useState(false);
  const [checking, setChecking] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const request = useRef(0);
  const checkStatus = useCallback(async (hydrate = false) => {
    const generation = ++request.current;
    setChecking(true);
    setError(null);
    try {
      const status = await azureDevOpsConnected();
      if (generation !== request.current) return;
      setConnected(status.connected);
      if (hydrate && status.url) setUrl(status.url);
    } catch (err: unknown) {
      if (generation === request.current)
        setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (generation === request.current) setChecking(false);
    }
  }, []);

  useEffect(() => {
    void checkStatus(true);
    return () => {
      request.current += 1;
    };
  }, [checkStatus]);

  const onSave = async () => {
    if (!url.trim() || !token.trim() || busy || checking) return;
    setBusy(true);
    setError(null);
    try {
      const status = await saveAzureDevOpsConfig(url, token);
      if (!status.connected)
        throw new Error(t("Connection test failed. Check your credentials and retry."));
      setUrl(status.url);
      setToken("");
      setConnected(status.connected);
      clearInboxCache();
    } catch (err: unknown) {
      setConnected(false);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const onDisconnect = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const status = await disconnectAzureDevOps(url);
      setConnected(false);
      setUrl(status.url || url);
      clearInboxCache();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <InboxConnectionStatus
        checking={checking}
        busy={busy || Boolean(token)}
        configured={connected}
        error={error}
        onCheck={() => void checkStatus()}
      />
      <Row
        label={t("Account configuration")}
        persistence={{ mode: "explicit", state: busy ? "saving" : token ? "dirty" : "idle" }}
        description={t(
          "Connect your ADO organization with a personal access token (Boards + Repos read & write for comments). The token is stored locally and Disconnect deletes it.",
        )}
      >
        {connected ? (
          <div className="flex min-w-0 max-w-full flex-wrap items-center gap-2">
            <span title={url} className="max-w-56 break-all text-[12px] text-content/50">
              {url}
            </span>
            <SecondaryButton onClick={() => void onDisconnect()} disabled={busy || checking}>
              {busy ? t("Disconnecting") : t("Disconnect")}
            </SecondaryButton>
          </div>
        ) : (
          <div className="flex min-w-0 max-w-full flex-wrap items-center gap-2">
            <label className="flex w-64 max-w-full flex-col gap-1 text-[12px] text-content/65">
              {t("Azure DevOps organization URL")}
              <input
                type="url"
                value={url}
                onChange={(event) => setUrl(event.target.value)}
                placeholder="https://dev.azure.com/myorg"
                aria-label={t("Azure DevOps organization URL")}
                autoComplete="url"
                spellCheck={false}
                disabled={busy || checking}
                className="h-8 min-w-0 rounded-md border border-content/10 bg-transparent px-2 text-[12px] text-content focus-visible:outline-2 focus-visible:outline-accent placeholder:text-content/35"
              />
            </label>
            <label className="flex w-64 max-w-full flex-col gap-1 text-[12px] text-content/65">
              {t("Azure DevOps personal access token")}
              <input
                type="password"
                value={token}
                onChange={(event) => setToken(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") void onSave();
                }}
                placeholder={t("PAT…")}
                aria-label={t("Azure DevOps personal access token")}
                autoComplete="off"
                spellCheck={false}
                disabled={busy || checking}
                className="h-8 min-w-0 rounded-md border border-content/10 bg-transparent px-2 text-[12px] text-content focus-visible:outline-2 focus-visible:outline-accent placeholder:text-content/35"
              />
            </label>
            <SecondaryButton
              onClick={() => void onSave()}
              disabled={busy || checking || !url.trim() || !token.trim()}
            >
              {busy
                ? t("Saving and testing…")
                : error
                  ? t("Retry save and test")
                  : t("Save and test connection")}
            </SecondaryButton>
          </div>
        )}
      </Row>
      <InboxConnectionError error={error} />
    </>
  );
}

export function LinearSettings() {
  useLocale();
  const [token, setToken] = useState("");
  const [connected, setConnected] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(true);
  const [teamsError, setTeamsError] = useState<string | null>(null);
  const [teams, setTeams] = useState<LinearTeam[]>([]);
  const [hiddenTeamIds, setHiddenTeamIds] = useState(loadHiddenLinearTeamIds);

  const loadTeams = useCallback(async () => {
    setTeamsError(null);
    try {
      const next = await listLinearTeams();
      setTeams(next);
    } catch (err: unknown) {
      setTeamsError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  const request = useRef(0);
  const checkStatus = useCallback(async () => {
    const generation = ++request.current;
    setChecking(true);
    setError(null);
    try {
      const status = await linearConnected();
      if (generation !== request.current) return;
      setConnected(status.connected);
      if (status.connected) await loadTeams();
    } catch (err: unknown) {
      if (generation === request.current)
        setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (generation === request.current) setChecking(false);
    }
  }, [loadTeams]);

  useEffect(() => {
    void checkStatus();
    return () => {
      request.current += 1;
    };
  }, [checkStatus]);

  // The inbox filter menu writes the same list, so follow it while both are mounted.
  useEffect(() => {
    const onChange = () => setHiddenTeamIds(loadHiddenLinearTeamIds());
    window.addEventListener(LINEAR_CHANGE_EVENT, onChange);
    return () => window.removeEventListener(LINEAR_CHANGE_EVENT, onChange);
  }, []);

  const onSave = async () => {
    if (!token.trim() || busy || checking) return;
    setBusy(true);
    setError(null);
    try {
      const status = await saveLinearToken(token);
      if (!status.connected)
        throw new Error(t("Connection test failed. Check your credentials and retry."));
      setToken("");
      setConnected(true);
      clearInboxCache();
      notifyLinearChange();
      await loadTeams();
    } catch (err: unknown) {
      setConnected(false);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const onDisconnect = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await disconnectLinear();
      setConnected(false);
      setTeams([]);
      setTeamsError(null);
      clearInboxCache();
      notifyLinearChange();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const toggleTeam = (id: string) => {
    const next = new Set(hiddenTeamIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    const ids = [...next];
    setHiddenTeamIds(ids);
    saveHiddenLinearTeamIds(ids);
    clearInboxCache();
  };

  return (
    <>
      <InboxConnectionStatus
        checking={checking}
        busy={busy || Boolean(token)}
        configured={connected}
        error={error}
        onCheck={() => void checkStatus()}
      />
      <Row
        persistence={{ mode: "explicit", state: busy ? "saving" : token ? "dirty" : "idle" }}
        label={t("API key")}
        description={t(
          "Create a personal API key in Linear → Settings → Security & Access. Disconnect deletes it.",
        )}
      >
        {connected ? (
          <SecondaryButton onClick={() => void onDisconnect()} disabled={busy || checking}>
            {t("Disconnect")}
          </SecondaryButton>
        ) : (
          <div className="flex max-w-full flex-wrap items-center gap-2">
            <label className="flex w-64 max-w-full flex-col gap-1 text-[12px] text-content/65">
              {t("Linear API key")}
              <input
                type="password"
                value={token}
                onChange={(event) => setToken(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") void onSave();
                }}
                placeholder={t("lin_api_…")}
                aria-label={t("Linear API key")}
                autoComplete="off"
                spellCheck={false}
                disabled={busy || checking}
                className="h-8 min-w-0 rounded-md border border-content/10 bg-transparent px-2 text-[12px] text-content focus-visible:outline-2 focus-visible:outline-accent placeholder:text-content/35"
              />
            </label>
            <SecondaryButton
              onClick={() => void onSave()}
              disabled={busy || checking || !token.trim()}
            >
              {busy
                ? t("Saving and testing…")
                : error
                  ? t("Retry save and test")
                  : t("Save and test connection")}
            </SecondaryButton>
          </div>
        )}
      </Row>
      <InboxConnectionError error={error} />
      {connected ? (
        <Row label={t("Teams")} persistence={{ mode: "automatic" }}>
          <SecondaryButton disabled={busy || checking} onClick={() => void loadTeams()}>
            {teamsError ? t("Retry") : t("Refresh teams")}
          </SecondaryButton>
        </Row>
      ) : null}
      <InboxConnectionError error={teamsError} />
      {connected && teams.length > 0 ? (
        <div className="border-b border-content/5 px-4 py-3.5 last:border-b-0">
          <div className="text-[13px] font-medium text-content">{t("Teams")}</div>
          <p className="mt-1 text-[12px] leading-relaxed text-content/45">
            {t("Unchecked teams stay out of the inbox.")}
          </p>
          <div className="-mx-2 mt-2 flex flex-col gap-0.5">
            {teams.map((team) => {
              const checked = !hiddenTeamIds.includes(team.id);
              return (
                <button
                  key={team.id}
                  type="button"
                  onClick={() => toggleTeam(team.id)}
                  className="flex h-7 items-center gap-2 rounded-md px-2 text-left text-[13px] text-content hover:bg-content/5"
                >
                  <span className="min-w-0 flex-1 truncate">
                    {team.name}
                    {team.key ? <span className="ml-1.5 text-content/40">{team.key}</span> : null}
                  </span>
                  {checked ? <Check className="size-3.5 shrink-0" strokeWidth={2.25} /> : null}
                </button>
              );
            })}
          </div>
        </div>
      ) : null}
    </>
  );
}
