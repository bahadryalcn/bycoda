import { Button } from "../../../shared/ui/Button";
import { EmptyState } from "../../../shared/ui/EmptyState";
import { Alert } from "../../../shared/ui/Alert";
import { t, useLocale } from "../../../shared/i18n";
import { useEffect, useState } from "react";
import { useGroupLock } from "../hooks/useGroupLock";
import {
  authorizeHiddenGroups,
  closeHiddenGroups,
  hideGroup,
  restoreHiddenGroup,
} from "../model/groupLock";
import type { GroupLockControls } from "./GroupLockSettings";
import { PasswordPromptDialog } from "./PasswordPromptDialog";
import { CollectionToolbar } from "../../settings/ui/SettingsCollection";

export function HiddenGroupsSettings({
  controls: { Group, Row },
}: {
  controls: Pick<GroupLockControls, "Group" | "Row">;
}) {
  useLocale();
  const privacy = useGroupLock();
  const [prompt, setPrompt] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  useEffect(() => closeHiddenGroups, []);
  const authorized = !privacy.hasPassword || privacy.hiddenGroupsAuthorized;
  const groups = authorized
    ? privacy.groups.filter((group) => privacy.savedHiddenGroupIds.has(group.id))
    : [];
  const search = query.trim().toLocaleLowerCase();
  const visibleGroups = search
    ? groups.filter((group) => group.name.toLocaleLowerCase().includes(search))
    : groups;
  const searchable = groups.length >= 6;
  const restore = (id: string, temporary: boolean) => {
    setError(
      restoreHiddenGroup(id, temporary) ? null : t("Could not save visibility. Please try again."),
    );
  };
  return (
    <Group
      id="hidden-project-groups"
      title={t("Hidden groups")}
      descriptionVisible={false}
      description={t(
        "Right-click a project group and choose Hide group to hide it on this device. Temporary visibility ends on restart. Make visible restores the group permanently.",
      )}
    >
      {!authorized ? (
        <Row label={t("Group names are concealed")}>
          <Button className="shrink-0" onClick={() => setPrompt(true)}>
            {t("Manage hidden groups…")}
          </Button>
        </Row>
      ) : groups.length === 0 ? (
        <EmptyState
          size="inline"
          className="settings-collection settings-collection-empty privacy-empty"
          description={t("No hidden groups")}
        />
      ) : (
        <div className="settings-collection privacy-hidden-collection">
          {searchable ? (
            <CollectionToolbar
              label={t("Search hidden groups")}
              query={query}
              onQueryChange={setQuery}
              count={t("Showing {p0} of {p1} groups", {
                p0: visibleGroups.length,
                p1: groups.length,
              })}
            />
          ) : null}
          <div className="settings-collection-list privacy-hidden-list" role="list">
            {visibleGroups.length === 0 ? (
              <EmptyState
                size="inline"
                kind="filtered"
                className="settings-collection-empty"
                description={t("No groups found")}
                resetLabel={t("Clear search")}
                onReset={() => setQuery("")}
              />
            ) : null}
            {visibleGroups.map((group) => (
              <div key={group.id} role="listitem" className="settings-collection-row">
                <div className="settings-collection-main">
                  <p className="settings-collection-title">{group.name}</p>
                  <p className="settings-collection-meta">
                    {privacy.hiddenGroupIds.has(group.id)
                      ? t("Hidden on this device")
                      : t("Visible until restart or Lock all groups")}
                  </p>
                </div>
                <div className="settings-collection-actions">
                  {privacy.hiddenGroupIds.has(group.id) ? (
                    <Button className="shrink-0" onClick={() => restore(group.id, true)}>
                      {t("Show temporarily")}
                    </Button>
                  ) : (
                    <Button
                      className="shrink-0"
                      onClick={() =>
                        setError(
                          hideGroup(group.id)
                            ? null
                            : t("Could not save visibility. Please try again."),
                        )
                      }
                    >
                      {t("Hide again")}
                    </Button>
                  )}
                  <Button className="shrink-0" onClick={() => restore(group.id, false)}>
                    {t("Make visible")}
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
      {error ? (
        <Alert tone="danger" role="alert">
          {error}
        </Alert>
      ) : null}
      {authorized && privacy.hasPassword ? (
        <div className="privacy-hidden-footer">
          <Button className="shrink-0" onClick={closeHiddenGroups}>
            {t("Conceal group names")}
          </Button>
        </div>
      ) : null}
      {prompt ? (
        <PasswordPromptDialog
          title={t("Manage hidden groups")}
          description={t("Enter your lock password to view hidden group names.")}
          submitLabel={t("Continue")}
          verify={authorizeHiddenGroups}
          onDone={() => setPrompt(false)}
          onClose={() => setPrompt(false)}
        />
      ) : null}
    </Group>
  );
}
