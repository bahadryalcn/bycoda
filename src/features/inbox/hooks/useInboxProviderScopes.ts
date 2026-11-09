import { useEffect, useMemo, useState } from "react";
import { useStableCallback } from "../../../shared/hooks/useStableCallback";
import { AZUREDEVOPS_CHANGE_EVENT } from "../model/azureDevOps";
import { GITLAB_CHANGE_EVENT } from "../model/gitlab";
import {
  jiraBackgroundSyncEnabled,
  listJiraProjects,
  readHiddenJiraProjectIds,
  subscribeJiraScope,
  type JiraProject,
} from "../model/jira";
import {
  listLinearTeams,
  readHiddenLinearTeamIds,
  subscribeLinearScope,
  type LinearTeam,
} from "../model/linear";
import type { InboxSource } from "../model/inboxFilters";

/**
 * Provider-owned Inbox scope: hidden Linear teams and Jira projects, the Jira
 * background-sync opt-in and the rosters the filter menu offers. Scope or account
 * changes (including GitLab and Azure DevOps) call `onScopeChange` so the owner
 * can re-read the list. Rosters come from the provider, not from fetched items:
 * hiding a team or project drops its items, so a derived list could never offer
 * it back. A saved scope that cannot be read is `null` (fetches then fail closed).
 */
export function useInboxProviderScopes({
  source,
  onScopeChange,
}: {
  source: InboxSource;
  onScopeChange: () => void;
}) {
  const scopeChanged = useStableCallback(onScopeChange);
  const [linearScope, setLinearScope] = useState(readHiddenLinearTeamIds);
  const linearHiddenTeamIds = useMemo(() => linearScope ?? [], [linearScope]);
  const [linearTeams, setLinearTeams] = useState<LinearTeam[]>([]);
  const [jiraScope, setJiraScope] = useState(readHiddenJiraProjectIds);
  const jiraHiddenProjectIds = useMemo(() => jiraScope ?? [], [jiraScope]);
  const [jiraProjects, setJiraProjects] = useState<JiraProject[]>([]);
  const [jiraAutomaticSync, setJiraAutomaticSync] = useState(jiraBackgroundSyncEnabled);

  useEffect(() => {
    return subscribeLinearScope(() => {
      setLinearScope(readHiddenLinearTeamIds());
      scopeChanged();
    });
  }, [scopeChanged]);

  useEffect(() => {
    return subscribeJiraScope(() => {
      setJiraScope(readHiddenJiraProjectIds());
      setJiraAutomaticSync(jiraBackgroundSyncEnabled());
      scopeChanged();
    });
  }, [scopeChanged]);

  useEffect(() => {
    window.addEventListener(GITLAB_CHANGE_EVENT, scopeChanged);
    window.addEventListener(AZUREDEVOPS_CHANGE_EVENT, scopeChanged);
    return () => {
      window.removeEventListener(GITLAB_CHANGE_EVENT, scopeChanged);
      window.removeEventListener(AZUREDEVOPS_CHANGE_EVENT, scopeChanged);
    };
  }, [scopeChanged]);

  useEffect(() => {
    if (source !== "linear") return;
    let cancelled = false;
    void listLinearTeams()
      .then((teams) => {
        if (!cancelled) setLinearTeams(teams);
      })
      .catch(() => {
        if (!cancelled) setLinearTeams([]);
      });
    return () => {
      cancelled = true;
    };
  }, [source, linearHiddenTeamIds]);

  useEffect(() => {
    if (source !== "jira") return;
    let cancelled = false;
    void listJiraProjects()
      .then((next) => {
        if (!cancelled) setJiraProjects(next);
      })
      .catch(() => {
        if (!cancelled) setJiraProjects([]);
      });
    return () => {
      cancelled = true;
    };
  }, [source, jiraHiddenProjectIds]);

  return {
    linearScope,
    linearHiddenTeamIds,
    linearTeams,
    jiraScope,
    jiraHiddenProjectIds,
    jiraProjects,
    jiraAutomaticSync,
  };
}
