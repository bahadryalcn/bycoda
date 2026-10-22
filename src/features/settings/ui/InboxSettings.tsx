import { PasswordField } from "../../../shared/ui/PasswordField";
import { openUrl } from "@tauri-apps/plugin-opener";
import { t, useLocale } from "../../../shared/i18n";
import { PRODUCT_IDENTITY } from "../../../shared/lib/productIdentity";

import { useCallback, useContext, useEffect, useId, useRef, useState } from "react";
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

import { Button } from "../../../shared/ui/Button";
import { TextField } from "../../../shared/ui/TextField";
import "./InboxSettings.css";

import { Group, Row, RevealedSetting } from "./settingsControls";

const INBOX_PROVIDERS = [
  {
    id: "github",
    name: "GitHub",
    description: "Pull requests, reviews, and issues, read through the GitHub CLI.",
    Component: GithubSettings,
  },
  {
    id: "gitlab",
    name: "GitLab",
    description: "Merge requests from GitLab.com or a self-managed instance.",
    Component: GitlabSettings,
  },
  {
    id: "azuredevops",
    name: "Azure DevOps",
    description: "Pull requests and Boards work items from your ADO organization.",
    Component: AzureDevOpsSettings,
  },
  {
    id: "jira",
    name: "Jira",
    description: "Jira Cloud issues from the projects you pick.",
    Component: JiraSettings,
  },
  {
    id: "linear",
    name: "Linear",
    description: "Issues assigned to you, from the teams you pick.",
    Component: LinearSettings,
  },
] as const;

export function InboxPage() {
  useLocale();
  const revealed = useContext(RevealedSetting);
  const [selection, setSelection] = useState(() => ({
    active:
      (INBOX_PROVIDERS.find((provider) => provider.id === revealed)?.id as string) ?? "github",
    revealed,
  }));
  let active = selection.active;
  // Resolve an external Settings search before its scroll/focus effect runs.
  // Manual tab changes remain independent until the search target changes.
  if (selection.revealed !== revealed) {
    active = INBOX_PROVIDERS.find((provider) => provider.id === revealed)?.id ?? active;
    setSelection({ active, revealed });
  }
  const setActive = (next: string) => setSelection((current) => ({ ...current, active: next }));
  const tabsId = useId();
  const tabs = useRef<HTMLDivElement>(null);

  return (
    <div className="inbox-settings">
      <div ref={tabs} role="tablist" aria-label={t("Inbox")} className="inbox-provider-tabs">
        {INBOX_PROVIDERS.map((provider, index) => (
          <Button
            key={provider.id}
            variant="tab"
            role="tab"
            id={`${tabsId}-tab-${provider.id}`}
            aria-controls={`${tabsId}-panel-${provider.id}`}
            aria-selected={active === provider.id}
            selected={active === provider.id}
            tabIndex={active === provider.id ? 0 : -1}
            startIcon={<InboxProviderMark provider={provider.id} className="size-4 shrink-0" />}
            onClick={() => setActive(provider.id)}
            onKeyDown={(event) => {
              const last = INBOX_PROVIDERS.length - 1;
              const next =
                event.key === "ArrowRight"
                  ? (index + 1) % INBOX_PROVIDERS.length
                  : event.key === "ArrowLeft"
                    ? (index + last) % INBOX_PROVIDERS.length
                    : event.key === "Home"
                      ? 0
                      : event.key === "End"
                        ? last
                        : -1;
              if (next < 0) return;
              event.preventDefault();
              event.stopPropagation();
              setActive(INBOX_PROVIDERS[next].id);
              tabs.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus();
            }}
          >
            {provider.name}
          </Button>
        ))}
      </div>
      {INBOX_PROVIDERS.map(({ id, name, description, Component }) => (
        <div
          key={id}
          role="tabpanel"
          id={`${tabsId}-panel-${id}`}
          aria-labelledby={`${tabsId}-tab-${id}`}
          hidden={active !== id}
          tabIndex={0}
        >
          <Group
            layout="full"
            scope={t("This computer · Inbox account")}
            id={id}
            title={name}
            description={t(description)}
          >
            <Component />
          </Group>
        </div>
      ))}
    </div>
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
          <div className="inbox-account-fields">
            <span title={url} className="max-w-56 break-all text-[12px] text-content/50">
              {url}
            </span>
            <SecondaryButton onClick={() => void onDisconnect()} disabled={busy || checking}>
              {busy ? t("Disconnecting") : t("Disconnect")}
            </SecondaryButton>
          </div>
        ) : (
          <div className="inbox-account-fields">
            <TextField
              label={t("GitLab URL")}
              type="url"
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              placeholder="https://gitlab.com"
              aria-label={t("GitLab URL")}
              autoComplete="url"
              spellCheck={false}
              disabled={busy || checking}
            />
            <PasswordField
              label={t("GitLab access token")}

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
            />
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
          <div className="inbox-account-fields">
            <span title={url} className="max-w-56 break-all text-[12px] text-content/50">
              {url}
            </span>
            <SecondaryButton onClick={() => void onDisconnect()} disabled={busy || checking}>
              {busy ? t("Disconnecting") : t("Disconnect")}
            </SecondaryButton>
          </div>
        ) : (
          <div className="inbox-account-fields">
            <TextField
              label={t("Azure DevOps organization URL")}
              type="url"
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              placeholder="https://dev.azure.com/myorg"
              aria-label={t("Azure DevOps organization URL")}
              autoComplete="url"
              spellCheck={false}
              disabled={busy || checking}
            />
            <PasswordField
              label={t("Azure DevOps personal access token")}

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
            />
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
  const teamRequest = useRef(0);

  const loadTeams = useCallback(async () => {
    const generation = ++teamRequest.current;
    setTeamsError(null);
    try {
      const next = await listLinearTeams();
      if (generation === teamRequest.current) setTeams(next);
    } catch (err: unknown) {
      if (generation === teamRequest.current)
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
      teamRequest.current += 1;
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
    request.current += 1;
    teamRequest.current += 1;
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
    request.current += 1;
    teamRequest.current += 1;
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
          <div className="inbox-account-fields">
            <PasswordField
              label={t("Linear API key")}

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
            />
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
                <Button
                  variant="item"
                  aria-pressed={checked}
                  key={team.id}
                  type="button"
                  onClick={() => toggleTeam(team.id)}
                  className="w-full"
                >
                  <span className="min-w-0 flex-1 truncate">
                    {team.name}
                    {team.key ? <span className="ml-1.5 text-content/40">{team.key}</span> : null}
                  </span>
                  {checked ? <Check className="size-3.5 shrink-0" strokeWidth={2.25} /> : null}
                </Button>
              );
            })}
          </div>
        </div>
      ) : null}
    </>
  );
}
