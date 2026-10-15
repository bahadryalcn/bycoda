import { t, useLocale } from "../../../shared/i18n";
import { useEffect, useState } from "react";
import { SecondaryButton } from "../../../shared/ui/SecondaryButton";
import { EyeOff, Lock } from "../../../shared/ui/icons";
import { useGroupLock } from "../hooks/useGroupLock";
import {
  authorizeHiddenGroups,
  closeHiddenGroups,
  hideGroup,
  restoreHiddenGroup,
} from "../model/groupLock";
import type { GroupLockControls } from "./GroupLockSettings";
import { PasswordPromptDialog } from "./PasswordPromptDialog";

export function HiddenGroupsSettings({
  controls: { Group, Row },
}: {
  controls: Pick<GroupLockControls, "Group" | "Row">;
}) {
  useLocale();
  const privacy = useGroupLock();
  const [prompt, setPrompt] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => closeHiddenGroups, []);
  const authorized = !privacy.hasPassword || privacy.hiddenGroupsAuthorized;
  const groups = authorized
    ? privacy.groups.filter((group) => privacy.savedHiddenGroupIds.has(group.id))
    : [];
  const restore = (id: string, temporary: boolean) => {
    setError(
      restoreHiddenGroup(id, temporary) ? null : "Could not save visibility. Please try again.",
    );
  };
  return (
    <Group
      id="hidden-project-groups"
      title={
        <span className="privacy-heading">
          <EyeOff aria-hidden className="size-4" />
          {t("Hidden groups")}
        </span>
      }
      description={t("Keep personal projects out of view. Restore them here at any time.")}
    >
      {!authorized ? (
        <Row
          label={
            <span className="privacy-gate-label">
              <Lock aria-hidden className="size-4" />
              {t("Group names are concealed")}
            </span>
          }
          description={t("Enter your password to view and restore hidden groups.")}
        >
          <SecondaryButton onClick={() => setPrompt(true)}>
            {t("Manage hidden groups…")}
          </SecondaryButton>
        </Row>
      ) : groups.length === 0 ? (
        <Row
          label={t("No hidden groups")}
          description={t(
            "Right-click a project group and choose Hide group to hide it on this device.",
          )}
        />
      ) : (
        groups.map((group) => (
          <Row
            key={group.id}
            label={group.name}
            description={
              privacy.hiddenGroupIds.has(group.id)
                ? t("Hidden on this device")
                : t("Visible until restart or Lock all groups")
            }
          >
            <div className="flex flex-wrap items-center gap-2">
              {privacy.hiddenGroupIds.has(group.id) ? (
                <SecondaryButton onClick={() => restore(group.id, true)}>
                  {t("Show temporarily")}
                </SecondaryButton>
              ) : (
                <SecondaryButton
                  onClick={() =>
                    setError(
                      hideGroup(group.id) ? null : "Could not save visibility. Please try again.",
                    )
                  }
                >
                  {t("Hide again")}
                </SecondaryButton>
              )}
              <SecondaryButton onClick={() => restore(group.id, false)}>
                {t("Make visible")}
              </SecondaryButton>
            </div>
          </Row>
        ))
      )}
      {authorized && privacy.hasPassword ? (
        <div className="privacy-hidden-footer">
          <SecondaryButton onClick={closeHiddenGroups}>{t("Conceal group names")}</SecondaryButton>
        </div>
      ) : null}
      {authorized && groups.length > 0 ? (
        <p className="privacy-inline-note">
          {t("Temporary visibility ends on restart. Make visible restores the group permanently.")}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
      {prompt ? (
        <PasswordPromptDialog
          title={t("Manage hidden groups")}
          description={t("Enter your lock password to view hidden group names.")}
          submitLabel="Continue"
          verify={authorizeHiddenGroups}
          onDone={() => setPrompt(false)}
          onClose={() => setPrompt(false)}
        />
      ) : null}
    </Group>
  );
}
