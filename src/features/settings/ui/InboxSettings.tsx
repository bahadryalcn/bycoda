import { PasswordField } from "../../../shared/ui/PasswordField";
import { openUrl } from "@tauri-apps/plugin-opener";
import { t, useLocale } from "../../../shared/i18n";
import { PRODUCT_IDENTITY } from "../../../shared/lib/productIdentity";

import { useCallback, useContext, useEffect, useId, useRef, useState } from "react";
import { InboxScopeCollection } from "./InboxScopeCollection";

import { JiraSettings } from "./JiraSettings";
import {
  InboxAccountActions,
  InboxConnectionStatus,
  InboxConnectionError,
  useConnectionVerification,
} from "./InboxConnectionStatus";

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
  notifyLinearChange,
  saveHiddenLinearTeamIds,
  saveLinearToken,
  type LinearTeam,
} from "../../inbox/model/linear";

import { Badge } from "../../../shared/ui/Badge";
import { Button } from "../../../shared/ui/Button";
import { TextField } from "../../../shared/ui/TextField";
import "./InboxSettings.css";

import { Group, Row, RevealedSetting } from "./settingsControls";
import { isInboxScopeString, useInboxScopePreference } from "./useInboxScopePreference";
import { SettingsFeedback } from "./settingsControls";

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
  // Providers stay mounted once opened, so their drafts survive tab changes.
  const [selection, setSelection] = useState(() => {
    const initial =
      (INBOX_PROVIDERS.find((provider) => provider.id === revealed)?.id as string) ?? "github";
    return { active: initial, revealed, visited: new Set([initial]) };
  });
  let active = selection.active;
  let visited = selection.visited;
  // Resolve an external Settings search before its scroll/focus effect runs.
  // Manual tab changes remain independent until the search target changes.
  if (selection.revealed !== revealed) {
    active = INBOX_PROVIDERS.find((provider) => provider.id === revealed)?.id ?? active;
    visited = visited.has(active) ? visited : new Set([...visited, active]);
    setSelection({ active, revealed, visited });
  }
  const setActive = (next: string) =>
    setSelection((current) => ({
      ...current,
      active: next,
      visited: current.visited.has(next) ? current.visited : new Set([...current.visited, next]),
    }));
  const tabsId = useId();
  const tabs = useRef<HTMLDivElement>(null);

  return (
    <div className="inbox-settings">
      <div ref={tabs} role="tablist" aria-label={t("Inbox")} className="inbox-provider-tabs">
        {INBOX_PROVIDERS.map((provider, index) => (
          <Button stableWidth
            key={provider.id}
            variant="tab"
            role="tab"
            id={`${tabsId}-tab-${provider.id}`}
            aria-controls={`${tabsId}-panel-${provider.id}`}
            aria-selected={active === provider.id}
            selected={active === provider.id}
            tabIndex={active === provider.id ? 0 : -1}
            startIcon={<InboxProviderMark provider={provider.id} className="icon-md shrink-0" />}
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
      {INBOX_PROVIDERS.map(({ id, description, Component }) => (
        <div
          key={id}
          role="tabpanel"
          id={`${tabsId}-panel-${id}`}
          aria-labelledby={`${tabsId}-tab-${id}`}
          hidden={active !== id}
          tabIndex={0}
        >
          <div className="settings-topics grid min-w-0 gap-6">
            <Group
              layout="full"
              scope={t("This computer · Inbox account")}
              id={id}
              title={t("Connection")}
              info={t(description)}
            >
              {active === id || visited.has(id) ? (
                id === "jira" ? (
                  <JiraSettings active={active === id} />
                ) : (
                  <Component />
                )
              ) : null}
            </Group>
          </div>
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
  const [helpError, setHelpError] = useState<string | null>(null);
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
        info={description}
        scope={t("This computer · GitHub CLI account")}
      >
        <Badge minWidth="16ch" role="status" aria-live="polite" aria-busy={checking || undefined}>{label}</Badge>
        {!checking && status && !status.installed ? (
          <Button stableWidth
            className="shrink-0"
            onClick={() => {
              setHelpError(null);
              void openUrl("https://cli.github.com/").catch((err: unknown) =>
                setHelpError(String(err)),
              );
            }}
          >
            {t("Installation guide")}
          </Button>
        ) : null}
        <Button stableWidth reserveLabels={[t("Checking")]} className="shrink-0" onClick={() => void checkStatus()} loading={checking}>
          {checking ? t("Checking") : t("Check again")}
        </Button>
      </Row>
      <InboxConnectionError error={error} />
      <InboxConnectionError error={helpError} />
    </>
  );
}

export function GitlabSettings() {
  useLocale();
  const verification = useConnectionVerification();
  const [url, setUrl] = useState("https://gitlab.com");
  const [savedUrl, setSavedUrl] = useState("https://gitlab.com");
  const [editing, setEditing] = useState(false);
  const mutation = useRef(false);
  const [token, setToken] = useState("");
  const [connected, setConnected] = useState(false);
  const [checking, setChecking] = useState(true);
  const [operation, setOperation] = useState<"save" | "disconnect" | null>(null);
  const busy = operation !== null;
  const [error, setError] = useState<string | null>(null);

  const [statusError, setStatusError] = useState<string | null>(null);
  const request = useRef(0);
  const checkStatus = useCallback(async (hydrate = false) => {
    const generation = ++request.current;
    setChecking(true);
    setStatusError(null);
    try {
      const status = await gitlabConnected();
      if (generation !== request.current) return;
      setConnected(status.connected);
      setSavedUrl((previous) => status.url || previous);
      if (hydrate) setUrl(status.url);
    } catch (err: unknown) {
      if (generation === request.current)
        setStatusError(err instanceof Error ? err.message : String(err));
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
    if (!url.trim() || !token.trim() || busy || checking || mutation.current) return;
    mutation.current = true;
    request.current += 1;
    setOperation("save");
    setError(null);
    try {
      const status = await saveGitlabConfig(url, token);
      if (!status.connected)
        throw new Error(t("Connection test failed. Check your credentials and retry."));
      setUrl(status.url);
      setSavedUrl(status.url);
      setStatusError(null);
      verification.markVerified();
      setEditing(false);
      setToken("");
      setConnected(status.connected);
      clearInboxCache();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      mutation.current = false;
      setOperation(null);
    }
  };

  const onDisconnect = async () => {
    if (busy || checking || mutation.current) return;
    mutation.current = true;
    request.current += 1;
    setOperation("disconnect");
    setError(null);
    try {
      const status = await disconnectGitlab(savedUrl);
      setConnected(false);
      verification.clearVerified();
      setUrl(status.url);
      clearInboxCache();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      mutation.current = false;
      setOperation(null);
    }
  };

  return (
    <>
      <InboxConnectionStatus
        checking={checking}
        busy={busy || Boolean(token)}
        configured={connected}
        verifiedAt={verification.verifiedAt}
        error={statusError}
        onCheck={() => void checkStatus()}
      />
      <Row
        label={t("Account")}
        persistence={{
          mode: "explicit",
          state: operation === "save" ? "saving" : token ? "dirty" : "idle",
        }}
        info={t(
          "Connect GitLab.com or a self-managed GitLab instance. Use a personal access token with API access; the token is stored locally and Disconnect deletes it.",
        )}
      >
        {connected && !editing ? (
          <div className="inbox-account-fields" data-state="summary">
            <span
              title={savedUrl}
              className="max-w-56 break-all text-ui-caption text-(--ui-text-muted)"
            >
              {savedUrl}
            </span>
            <Button stableWidth
              disabled={busy || checking}
              onClick={() => {
                setUrl(savedUrl);
                setEditing(true);
              }}
            >
              {t("Edit")}
            </Button>
            <InboxAccountActions onDisconnect={() => void onDisconnect()} loading={operation === "disconnect"} disabled={busy || checking} />
          </div>
        ) : (
          <div className="inbox-account-fields" data-state="form">
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
            <Button stableWidth reserveLabels={[t("Saving and testing…"), t("Retry save and test")]}
              className="shrink-0"
              onClick={() => void onSave()}
              loading={operation === "save"}
              disabled={busy || checking || !url.trim() || !token.trim()}
            >
              {busy
                ? t("Saving and testing…")
                : error
                  ? t("Retry save and test")
                  : t("Save and test connection")}
            </Button>
            {connected ? (
              <Button stableWidth
                disabled={busy}
                onClick={() => {
                  setEditing(false);
                  setUrl(savedUrl);
                  setToken("");
                }}
              >
                {t("Cancel")}
              </Button>
            ) : null}
          </div>
        )}
      </Row>
      <InboxConnectionError error={error} />
    </>
  );
}

export function AzureDevOpsSettings() {
  useLocale();
  const verification = useConnectionVerification();
  const [url, setUrl] = useState("https://dev.azure.com/myorg");
  const [savedUrl, setSavedUrl] = useState("https://dev.azure.com/myorg");
  const [editing, setEditing] = useState(false);
  const mutation = useRef(false);
  const [token, setToken] = useState("");
  const [connected, setConnected] = useState(false);
  const [checking, setChecking] = useState(true);
  const [operation, setOperation] = useState<"save" | "disconnect" | null>(null);
  const busy = operation !== null;
  const [error, setError] = useState<string | null>(null);

  const [statusError, setStatusError] = useState<string | null>(null);
  const request = useRef(0);
  const checkStatus = useCallback(async (hydrate = false) => {
    const generation = ++request.current;
    setChecking(true);
    setStatusError(null);
    try {
      const status = await azureDevOpsConnected();
      if (generation !== request.current) return;
      setConnected(status.connected);
      setSavedUrl((previous) => status.url || previous);
      if (hydrate && status.url) setUrl(status.url);
    } catch (err: unknown) {
      if (generation === request.current)
        setStatusError(err instanceof Error ? err.message : String(err));
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
    if (!url.trim() || !token.trim() || busy || checking || mutation.current) return;
    mutation.current = true;
    request.current += 1;
    setOperation("save");
    setError(null);
    try {
      const status = await saveAzureDevOpsConfig(url, token);
      if (!status.connected)
        throw new Error(t("Connection test failed. Check your credentials and retry."));
      setUrl(status.url);
      setSavedUrl(status.url);
      setStatusError(null);
      verification.markVerified();
      setEditing(false);
      setToken("");
      setConnected(status.connected);
      clearInboxCache();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      mutation.current = false;
      setOperation(null);
    }
  };

  const onDisconnect = async () => {
    if (busy || checking || mutation.current) return;
    mutation.current = true;
    request.current += 1;
    setOperation("disconnect");
    setError(null);
    try {
      const status = await disconnectAzureDevOps(savedUrl);
      setConnected(false);
      verification.clearVerified();
      setUrl(status.url || url);
      clearInboxCache();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      mutation.current = false;
      setOperation(null);
    }
  };

  return (
    <>
      <InboxConnectionStatus
        checking={checking}
        busy={busy || Boolean(token)}
        configured={connected}
        verifiedAt={verification.verifiedAt}
        error={statusError}
        onCheck={() => void checkStatus()}
      />
      <Row
        label={t("Account")}
        persistence={{
          mode: "explicit",
          state: operation === "save" ? "saving" : token ? "dirty" : "idle",
        }}
        info={t(
          "Connect your ADO organization with a personal access token (Boards + Repos read & write for comments). The token is stored locally and Disconnect deletes it.",
        )}
      >
        {connected && !editing ? (
          <div className="inbox-account-fields" data-state="summary">
            <span
              title={savedUrl}
              className="max-w-56 break-all text-ui-caption text-(--ui-text-muted)"
            >
              {savedUrl}
            </span>
            <Button stableWidth
              disabled={busy || checking}
              onClick={() => {
                setUrl(savedUrl);
                setEditing(true);
              }}
            >
              {t("Edit")}
            </Button>
            <InboxAccountActions onDisconnect={() => void onDisconnect()} loading={operation === "disconnect"} disabled={busy || checking} />
          </div>
        ) : (
          <div className="inbox-account-fields" data-state="form">
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
            <Button stableWidth reserveLabels={[t("Saving and testing…"), t("Retry save and test")]}
              className="shrink-0"
              onClick={() => void onSave()}
              loading={operation === "save"}
              disabled={busy || checking || !url.trim() || !token.trim()}
            >
              {busy
                ? t("Saving and testing…")
                : error
                  ? t("Retry save and test")
                  : t("Save and test connection")}
            </Button>
            {connected ? (
              <Button stableWidth
                disabled={busy}
                onClick={() => {
                  setEditing(false);
                  setUrl(savedUrl);
                  setToken("");
                }}
              >
                {t("Cancel")}
              </Button>
            ) : null}
          </div>
        )}
      </Row>
      <InboxConnectionError error={error} />
    </>
  );
}

export function LinearSettings() {
  useLocale();
  const verification = useConnectionVerification();
  const [token, setToken] = useState("");
  const [connected, setConnected] = useState(false);
  const [editing, setEditing] = useState(false);
  const [accountEpoch, setAccountEpoch] = useState(0);
  const mutation = useRef(false);
  const [operation, setOperation] = useState<"save" | "disconnect" | null>(null);
  const busy = operation !== null;
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(true);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [teamsError, setTeamsError] = useState<string | null>(null);
  const [teamsLoading, setTeamsLoading] = useState(false);
  const [teams, setTeams] = useState<LinearTeam[]>([]);
  const teamScope = useInboxScopePreference(
    "bycoda.linearHiddenTeams",
    LINEAR_CHANGE_EVENT,
    isInboxScopeString,
    saveHiddenLinearTeamIds,
    `linear:${connected}:${accountEpoch}`,
  );
  const hiddenTeamIds = teamScope.value;
  const teamRequest = useRef(0);

  const loadTeams = useCallback(async () => {
    const generation = ++teamRequest.current;
    setTeamsLoading(true);
    setTeamsError(null);
    try {
      const next = await listLinearTeams();
      if (generation === teamRequest.current) setTeams(next);
    } catch (err: unknown) {
      if (generation === teamRequest.current)
        setTeamsError(err instanceof Error ? err.message : String(err));
    } finally {
      if (generation === teamRequest.current) setTeamsLoading(false);
    }
  }, []);

  const request = useRef(0);
  const checkStatus = useCallback(async () => {
    const generation = ++request.current;
    setChecking(true);
    setStatusError(null);
    try {
      const status = await linearConnected();
      if (generation !== request.current) return;
      setConnected(status.connected);
      if (status.connected) await loadTeams();
    } catch (err: unknown) {
      if (generation === request.current)
        setStatusError(err instanceof Error ? err.message : String(err));
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

  const onSave = async () => {
    if (!token.trim() || busy || checking || mutation.current) return;
    mutation.current = true;
    request.current += 1;
    teamRequest.current += 1;
    setTeamsLoading(false);
    setOperation("save");
    setError(null);
    try {
      const status = await saveLinearToken(token);
      if (!status.connected)
        throw new Error(t("Connection test failed. Check your credentials and retry."));
      setToken("");
      setEditing(false);
      setConnected(true);
      setStatusError(null);
      verification.markVerified();
      setAccountEpoch((value) => value + 1);
      setTeams([]);
      clearInboxCache();
      notifyLinearChange();
      await loadTeams();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      mutation.current = false;
      setOperation(null);
    }
  };

  const onDisconnect = async () => {
    if (busy || checking || mutation.current) return;
    mutation.current = true;
    request.current += 1;
    teamRequest.current += 1;
    setTeamsLoading(false);
    setOperation("disconnect");
    setError(null);
    try {
      await disconnectLinear();
      setConnected(false);
      verification.clearVerified();
      setAccountEpoch((value) => value + 1);
      setTeams([]);
      setTeamsError(null);
      clearInboxCache();
      notifyLinearChange();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      mutation.current = false;
      setOperation(null);
    }
  };

  const setVisibleTeams = (visible: string[]) => {
    const known = new Set(teams.map((team) => team.id));
    teamScope.update((current) => [
      ...current.filter((id) => !known.has(id)),
      ...teams.filter((team) => !visible.includes(team.id)).map((team) => team.id),
    ]);
    clearInboxCache();
  };

  return (
    <>
      <InboxConnectionStatus
        checking={checking}
        busy={busy || Boolean(token)}
        configured={connected}
        verifiedAt={verification.verifiedAt}
        error={statusError}
        onCheck={() => void checkStatus()}
      />
      <Row
        persistence={{
          mode: "explicit",
          state: operation === "save" ? "saving" : token ? "dirty" : "idle",
        }}
        label={t("API key")}
        info={t(
          "Create a personal API key in Linear → Settings → Security & Access. Disconnect deletes it.",
        )}
      >
        {connected && !editing ? (
          <div className="inbox-account-fields" data-state="summary">
            <span className="text-ui-caption text-(--ui-text-secondary)">
              {t("API key saved on this computer")}
            </span>
            <Button stableWidth disabled={busy || checking} onClick={() => setEditing(true)}>
              {t("Edit")}
            </Button>
            <InboxAccountActions onDisconnect={() => void onDisconnect()} loading={operation === "disconnect"} disabled={busy || checking} />
          </div>
        ) : (
          <div className="inbox-account-fields" data-state="form">
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
            <Button stableWidth reserveLabels={[t("Saving and testing…"), t("Retry save and test")]}
              className="shrink-0"
              onClick={() => void onSave()}
              loading={operation === "save"}
              disabled={busy || checking || !token.trim()}
            >
              {busy
                ? t("Saving and testing…")
                : error
                  ? t("Retry save and test")
                  : t("Save and test connection")}
            </Button>
            {connected ? (
              <Button stableWidth
                disabled={busy}
                onClick={() => {
                  setEditing(false);
                  setToken("");
                }}
              >
                {t("Cancel")}
              </Button>
            ) : null}
          </div>
        )}
      </Row>
      <InboxConnectionError error={error} />
      {connected ? (
        <Row
          stacked
          label={t("Teams")}
          info={t("Unchecked teams stay out of the inbox.")}
          persistence={{ mode: "automatic" }}
          feedback={
            teamScope.error ? (
              <SettingsFeedback
                state="error"
                action={<Button stableWidth onClick={teamScope.retry}>{t("Retry")}</Button>}
              >
                {t("Saved Inbox scope is unavailable. Retry before changing it.")}
              </SettingsFeedback>
            ) : undefined
          }
        >
          {teamScope.available ? (
            <InboxScopeCollection
              label={t("Teams")}
              searchLabel={t("Search teams")}
              items={teams.map((team) => ({ id: team.id, title: team.name, meta: team.key }))}
              selectedIds={teams
                .filter((team) => !hiddenTeamIds.includes(team.id))
                .map((team) => team.id)}
              onChange={setVisibleTeams}
              disabled={busy || checking || teamsLoading || Boolean(teamsError)}
              loading={teamsLoading}
              summary={(count, total) => t("{p0} of {p1} teams selected", { p0: count, p1: total })}
              emptyLabel={t("No teams available. Refresh teams to try again.")}
              noMatchLabel={t("No matching teams")}
              actions={
                <Button stableWidth
                  className="shrink-0"
                  size="sm"
                  loading={teamsLoading}
                  disabled={busy || checking}
                  onClick={() => void loadTeams()}
                >
                  {teamsError ? t("Retry") : t("Refresh teams")}
                </Button>
              }
            />
          ) : null}
        </Row>
      ) : null}
      <InboxConnectionError error={teamsError} />
    </>
  );
}
