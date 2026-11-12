import { Text } from "../../../shared/ui/Text";
import { PasswordField } from "../../../shared/ui/PasswordField";
import { t, useLocale } from "../../../shared/i18n";
import { PRODUCT_IDENTITY } from "../../../shared/lib/productIdentity";
import { useCallback, useEffect, useRef, useState } from "react";
import { InboxScopeCollection } from "./InboxScopeCollection";
import { JiraSettings } from "./JiraSettings";
import {
  InboxAccountActions,
  InboxAccountChecking,
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
import { isInboxScopeString, useInboxScopePreference } from "./useInboxScopePreference";
import { Row, SettingsFeedback } from "./settingsControls";

export const INBOX_PROVIDERS = [
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

export const inboxProviderMark = (id: (typeof INBOX_PROVIDERS)[number]["id"]) => (
  <InboxProviderMark provider={id} className="icon-md shrink-0" />
);

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

  // While the pinned copy installs, poll until it is ready or has failed.
  useEffect(() => {
    if (!status?.installing) return;
    const timer = window.setTimeout(() => checkStatus().catch(() => undefined), 2000);
    return () => window.clearTimeout(timer);
  }, [status, checkStatus]);

  const description = error
    ? t("Could not check GitHub CLI. Retry on this computer.")
    : checking || !status
      ? t("Checking GitHub CLI on this computer.")
      : status.connected
        ? t("GitHub CLI is installed and authenticated. {p0} uses it for GitHub inbox items.", {
            p0: PRODUCT_IDENTITY.displayName,
          })
        : status.installed
          ? t("Run gh auth login on this computer, complete sign-in, then check again.")
          : status.installError
            ? t(
                "GitHub CLI could not be set up automatically. Check your internet connection, then check again.",
              )
            : t("Installing GitHub CLI on this computer. This takes about a minute.");
  const label = checking
    ? t("Checking")
    : error || !status
      ? t("Check failed")
      : status.connected
        ? t("Connected")
        : status.installed
          ? t("Sign in required")
          : status.installError
            ? t("Setup failed")
            : t("Installing");

  return (
    <>
      <Row
        label={t("Connection")}
        info={description}
        scope={t("This computer · GitHub CLI account")}
      >
        <Badge
          size="sm"
          appearance="subtle"
          role="status"
          aria-live="polite"
          aria-busy={checking || undefined}
        >
          {label}
        </Badge>
        <Button
          stableWidth
          reserveLabels={[t("Checking")]}
          className="shrink-0"
          onClick={() => void checkStatus()}
          loading={checking}
        >
          {checking ? t("Checking") : t("Check again")}
        </Button>
      </Row>
      <InboxConnectionError error={error} />
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
        stacked={!checking && !(connected && !editing)}
        persistence={{
          mode: "explicit",
          state: operation === "save" ? "saving" : token ? "dirty" : "idle",
        }}
        info={t(
          "Connect GitLab.com or a self-managed GitLab instance. Use a personal access token with API access; the token is stored locally and Disconnect deletes it.",
        )}
      >
        {checking ? (
          <InboxAccountChecking />
        ) : connected && !editing ? (
          <div className="inbox-account-fields" data-state="summary">
            <Text size="caption" tone="muted" className="max-w-56 break-all">
              {savedUrl}
            </Text>
            <Button
              stableWidth
              disabled={busy || checking}
              onClick={() => {
                setUrl(savedUrl);
                setEditing(true);
              }}
            >
              {t("Edit")}
            </Button>
            <InboxAccountActions
              onDisconnect={() => void onDisconnect()}
              loading={operation === "disconnect"}
              disabled={busy || checking}
            />
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
            <Button
              stableWidth
              reserveLabels={[t("Saving and testing…"), t("Retry save and test")]}
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
              <Button
                stableWidth
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
        stacked={!checking && !(connected && !editing)}
        persistence={{
          mode: "explicit",
          state: operation === "save" ? "saving" : token ? "dirty" : "idle",
        }}
        info={t(
          "Connect your ADO organization with a personal access token (Boards + Repos read & write for comments). The token is stored locally and Disconnect deletes it.",
        )}
      >
        {checking ? (
          <InboxAccountChecking />
        ) : connected && !editing ? (
          <div className="inbox-account-fields" data-state="summary">
            <Text size="caption" tone="muted" className="max-w-56 break-all">
              {savedUrl}
            </Text>
            <Button
              stableWidth
              disabled={busy || checking}
              onClick={() => {
                setUrl(savedUrl);
                setEditing(true);
              }}
            >
              {t("Edit")}
            </Button>
            <InboxAccountActions
              onDisconnect={() => void onDisconnect()}
              loading={operation === "disconnect"}
              disabled={busy || checking}
            />
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
            <Button
              stableWidth
              reserveLabels={[t("Saving and testing…"), t("Retry save and test")]}
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
              <Button
                stableWidth
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
        stacked={!checking && !(connected && !editing)}
        persistence={{
          mode: "explicit",
          state: operation === "save" ? "saving" : token ? "dirty" : "idle",
        }}
        label={t("API key")}
        info={t(
          "Create a personal API key in Linear → Settings → Security & Access. Disconnect deletes it.",
        )}
      >
        {checking ? (
          <InboxAccountChecking />
        ) : connected && !editing ? (
          <div className="inbox-account-fields" data-state="summary">
            <Text size="caption" tone="secondary">
              {t("API key saved on this computer")}
            </Text>
            <Button stableWidth disabled={busy || checking} onClick={() => setEditing(true)}>
              {t("Edit")}
            </Button>
            <InboxAccountActions
              onDisconnect={() => void onDisconnect()}
              loading={operation === "disconnect"}
              disabled={busy || checking}
            />
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
            <Button
              stableWidth
              reserveLabels={[t("Saving and testing…"), t("Retry save and test")]}
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
              <Button
                stableWidth
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
                action={
                  <Button stableWidth onClick={teamScope.retry}>
                    {t("Retry")}
                  </Button>
                }
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
                <Button
                  stableWidth
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
