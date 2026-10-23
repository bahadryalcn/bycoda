import { Button } from "../../../shared/ui/Button";
import { t, useLocale } from "../../../shared/i18n";
import { useEffect, useState } from "react";
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
      restoreHiddenGroup(id, temporary) ? null : t("Could not save visibility. Please try again."),
    );
  };
  return (
    <Group
      id="hidden-project-groups"
      title={
        <span className="privacy-heading">
          <EyeOff aria-hidden className="icon-md" />
          {t("Hidden groups")}
        </span>
      }
    >
      {!authorized ? (
        <Row
          label={
            <span className="privacy-gate-label">
              <Lock aria-hidden className="icon-md" />
              {t("Group names are concealed")}
            </span>
          }
        >
          <Button className="shrink-0" onClick={() => setPrompt(true)}>
            {t("Manage hidden groups…")}
          </Button>
        </Row>
      ) : groups.length === 0 ? (
        <Row label={t("No hidden groups")} />
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
          </Row>
        ))
      )}
      {authorized && privacy.hasPassword ? (
        <div className="privacy-hidden-footer">
          <Button className="shrink-0" onClick={closeHiddenGroups}>
            {t("Conceal group names")}
          </Button>
        </div>
      ) : null}
      {authorized && groups.length > 0 ? (
        <p className="privacy-inline-note">
          {t("Temporary visibility ends on restart. Make visible restores the group permanently.")}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="text-ui-body text-danger">
          {error}
        </p>
      ) : null}
      <section className="privacy-recovery">
        <h3>{t("How to hide a group")}</h3>
        <p className="privacy-inline-note">
          {t("Right-click a project group and choose Hide group to hide it on this device.")}
        </p>
      </section>
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
