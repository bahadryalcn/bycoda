import { InlineError } from "../../../../shared/ui/InlineError";
import { surfaceAttributes } from "../../../../shared/ui/Surface";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { getLocale, t } from "../../../../shared/i18n";
import { Button } from "../../../../shared/ui/Button";
import { Checkbox } from "../../../../shared/ui/Checkbox";
import { EmptyState } from "../../../../shared/ui/EmptyState";
import { FieldGroup } from "../../../../shared/ui/FieldGroup";

import { SearchableSelect } from "../../../../shared/ui/SearchableSelect";
import type { HostProject } from "../../../connections/public/protocol";
import type { SocialAccount, SocialPermission } from "../../model/social";
import type { SocialClient } from "../../model/socialClient";
import { socialContentSnapshotKey } from "../../model/socialQuery";
import { accountBlockedReason } from "./blockedReason";
import { useAccountWrite } from "./useAccountWrite";
import "./accounts.css";

export type AccountPermissionsProps = {
  client: SocialClient;
  account: SocialAccount;
  projects: HostProject[];
  disabled: boolean;
  onChanged(): void;
};

type AssistantPermission = "read" | "draft";

function projectPermissions(): { id: SocialPermission; label: string }[] {
  return [
    { id: "read", label: t("Can read") },
    { id: "draft", label: t("Prepare drafts") },
    { id: "publish", label: t("Publish") },
    { id: "reply", label: t("Can reply") },
    { id: "message", label: t("New message") },
    { id: "comment", label: t("Post a comment") },
  ];
}

/**
 * Who may use this account: the Assistant's access and the access of each project. Neither one
 * connects the account or approves a send; sending follows the autonomy levels below.
 */
export function AccountPermissions({
  client,
  account,
  projects,
  disabled,
  onChanged,
}: AccountPermissionsProps) {
  const cache = useQueryClient();
  const [assistant, setAssistant] = useState<AssistantPermission[]>(
    () => account.assistantGrantPending?.permissions ?? account.assistantGrant?.permissions ?? [],
  );
  // The project picked by the owner (undefined: the first project) and the edits made to it.
  const [picked, setPicked] = useState<string>();
  const [edit, setEdit] = useState<{
    projectId: string;
    permissions: SocialPermission[];
  }>();
  const projectId =
    picked && projects.some((project) => project.id === picked) ? picked : (projects[0]?.id ?? "");
  const grants =
    edit?.projectId === projectId ? edit.permissions : (account.grants[projectId] ?? []);
  const setGrants = (permissions: SocialPermission[]) => setEdit({ projectId, permissions });
  const assistantWrite = useAccountWrite(t("Assistant access could not be saved. Try again."));
  const projectWrite = useAccountWrite(t("Project access could not be saved. Try again."));
  const locked = disabled || assistantWrite.is("assistant") || projectWrite.is("project");

  const saveAssistant = () =>
    void assistantWrite
      .write("assistant", () =>
        client.request<SocialAccount>("accounts.assistantGrant", {
          accountId: account.id,
          permissions: assistant,
          // The Host refuses the save when the grant changed since this version was read.
          expectedVersion: account.assistantGrant?.version ?? null,
        }),
      )
      .then((result) => result !== undefined && onChanged())
      .catch(() => undefined);

  const saveProject = () =>
    void projectWrite
      .write("project", () =>
        client.request("accounts.grants", {
          accountId: account.id,
          projectId,
          permissions: grants,
        }),
      )
      .then((result) => {
        if (result === undefined) return;
        void cache
          .invalidateQueries({
            queryKey: socialContentSnapshotKey(client, projectId),
            exact: true,
          })
          .catch(() => undefined);
        onChanged();
      })
      .catch(() => undefined);

  return (
    <section
      {...surfaceAttributes({ frame: "pane", edge: "block-start" }, "social-card")}
      aria-label={t("Who can use this account")}
    >
      {account.assistantGrantPending ? (
        <InlineError>
          {t(
            "Assistant access is paused while voice retirement is pending. Reconnect the original device and save again to retry.",
          )}
        </InlineError>
      ) : null}
      <form
        className="social-field-row"
        onSubmit={(event) => {
          event.preventDefault();
          saveAssistant();
        }}
      >
        <FieldGroup legend={t("Assistant permissions")} layout="row">
          <Checkbox
            disabled={locked}
            disabledReason={accountBlockedReason(disabled)}
            checked={assistant.includes("read")}
            onChange={(event) => setAssistant(event.target.checked ? ["read"] : [])}
            label={t("Can read")}
            size="secondary"
            leading="inherit"
            className="social-check"
          />
          <Checkbox
            disabled={locked || !assistant.includes("read")}
            disabledReason={locked ? accountBlockedReason(disabled) : t("Allow reading first.")}
            checked={assistant.includes("draft")}
            onChange={(event) => setAssistant(event.target.checked ? ["read", "draft"] : ["read"])}
            label={t("Prepare drafts")}
            size="secondary"
            leading="inherit"
            className="social-check"
          />
        </FieldGroup>
        <Button
          type="submit"
          variant="secondary"
          size="sm"
          loading={assistantWrite.is("assistant")}
          disabled={locked}
          disabledReason={accountBlockedReason(disabled)}
        >
          {t("Save permissions")}
        </Button>
      </form>
      {assistantWrite.failureTitle ? (
        <InlineError details={assistantWrite.details}>{assistantWrite.failureTitle}</InlineError>
      ) : null}

      <div className="social-field-row">
        <SearchableSelect
          disabled={locked || !projects.length}
          label={t("Project")}
          value={projectId}
          options={projects.map((project) => ({
            value: project.id,
            label: project.name,
          }))}
          onChange={(next) => {
            setPicked(next);
            setEdit(undefined);
          }}
          searchLocale={getLocale()}
        />
      </div>
      {projects.length ? (
        <form
          className="social-field-row"
          onSubmit={(event) => {
            event.preventDefault();
            saveProject();
          }}
        >
          <FieldGroup legend={t("Reading and sending are separate permissions")} layout="row">
            {projectPermissions().map((permission) => (
              <Checkbox
                disabled={locked}
                disabledReason={accountBlockedReason(disabled)}
                checked={grants.includes(permission.id)}
                onChange={(event) =>
                  setGrants(
                    event.target.checked
                      ? [...grants, permission.id]
                      : grants.filter((item) => item !== permission.id),
                  )
                }
                label={permission.label}
                key={permission.id}
                size="secondary"
                leading="inherit"
                className="social-check"
              />
            ))}
          </FieldGroup>
          <Button
            type="submit"
            variant="secondary"
            size="sm"
            loading={projectWrite.is("project")}
            disabled={locked || !projectId}
            disabledReason={locked ? accountBlockedReason(disabled) : t("Choose a project first.")}
          >
            {t("Save project access")}
          </Button>
        </form>
      ) : (
        <EmptyState
          size="inline"
          description={t("Create a project first to give this account project access.")}
        />
      )}
      {projectWrite.failureTitle ? (
        <InlineError details={projectWrite.details}>{projectWrite.failureTitle}</InlineError>
      ) : null}
    </section>
  );
}
