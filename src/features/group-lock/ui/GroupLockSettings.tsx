import { ScrollArea } from "../../../shared/ui/ScrollArea";
import { Text } from "../../../shared/ui/Text";
import { recoverRoomPrivacyProjection } from "../model/roomPrivacyProjection";
import { Button } from "../../../shared/ui/Button";
import { EmptyState } from "../../../shared/ui/EmptyState";
import { Alert } from "../../../shared/ui/Alert";
import { t, useLocale } from "../../../shared/i18n";
import { PRODUCT_IDENTITY } from "../../../shared/lib/productIdentity";
import { useRef, useState, type ReactNode } from "react";
import { Lock } from "../../../shared/ui/icons";
import "./GroupPrivacy.css";
import { Badge } from "../../../shared/ui/Badge";
import { useGroupLock } from "../hooks/useGroupLock";
import { AUTO_LOCK_MINUTES, autoLockLabel, parseAutoLockMinutes } from "../model/autoLock";
import {
  lockAllGroups,
  makeGroupLockable,
  removeGroupLock,
  removeLockPassword,
  setAutoLockMinutes,
  setRelockOnLaunch,
  setUnlockAll,
} from "../model/groupLock";
import { ForgotLockPasswordDialog } from "./ForgotLockPasswordDialog";
import { PasswordPromptDialog } from "./PasswordPromptDialog";
import { SetLockPasswordDialog } from "./SetLockPasswordDialog";
import { HiddenGroupsSettings } from "./HiddenGroupsSettings";
import { CollectionToolbar } from "../../settings/ui/SettingsCollection";

/** The Settings building blocks, passed in so this page matches the others. */
export type GroupLockControls = {
  Group: (props: {
    id?: string;
    title: ReactNode;
    description?: string;
    /** `false` moves a long description into an information popover beside the title. */
    descriptionVisible?: boolean;
    action?: ReactNode;
    scope?: ReactNode;
    /** Open by default; only a real editing or ownership unit (a danger zone) is boxed. */
    variant?: "open" | "box";
    children: ReactNode;
  }) => ReactNode;
  Row: (props: {
    id?: string;
    label: ReactNode;
    description?: string;
    /** Local save result shown with the row. */
    feedback?: ReactNode;
    children?: ReactNode;
  }) => ReactNode;
  Toggle: (props: {
    label: string;
    on: boolean;
    onChange: (on: boolean) => void;
    disabled?: boolean;
  }) => ReactNode;
  Select: (props: {
    label: string;
    value: string;
    options: { value: string; label: string }[];
    onChange: (value: string) => void;
  }) => ReactNode;
};

type Dialog =
  | { kind: "set"; thenLockable?: string }
  | { kind: "change" }
  | { kind: "remove" }
  | { kind: "forgot" }
  | { kind: "remove-lock"; id: string; name: string };

/** Settings page for the group lock: the password, its options, and which groups use it. */
export function GroupLockSettings({
  controls: { Group, Row, Toggle, Select },
}: {
  controls: GroupLockControls;
}) {
  useLocale();
  const lock = useGroupLock();
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [groupQuery, setGroupQuery] = useState("");
  // Choices apply to this window at once; a save that did not reach storage stays visible with a retry.
  const [unsaved, setUnsaved] = useState<Record<string, () => void>>({});
  const [pendingWrites, setPendingWrites] = useState<Record<string, boolean>>({});
  const writesInFlight = useRef(new Set<string>());
  const commit = (id: string, write: () => boolean | Promise<boolean>) => {
    if (writesInFlight.current.has(id)) return;
    writesInFlight.current.add(id);
    setPendingWrites((current) => ({ ...current, [id]: true }));
    void Promise.resolve()
      .then(write)
      .catch(() => false)
      .then((saved) =>
        setUnsaved((current) => {
          const next = { ...current };
          if (saved) delete next[id];
          else next[id] = () => commit(id, write);
          return next;
        }),
      )
      .finally(() => {
        writesInFlight.current.delete(id);
        setPendingWrites((current) => ({ ...current, [id]: false }));
      })
      .catch((error: unknown) => console.error("Privacy settings feedback failed", error));
  };
  const unsavedNote = (id: string, applied = true) =>
    unsaved[id] ? (
      <div className="privacy-save-feedback">
        <Alert tone="danger">
          {applied
            ? t(
                "Applied in this window, but not saved. The next launch may use the previous choice.",
              )
            : t("Could not save this change. It was not applied.")}
        </Alert>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            void recoverRoomPrivacyProjection()
              .then(() => unsaved[id]?.())
              .catch(() => {});
          }}
        >
          {t("Retry")}
        </Button>
      </div>
    ) : undefined;
  const close = () => setDialog(null);
  const hasLockable =
    lock.groups.some((group) => group.lockable) || lock.savedHiddenGroupIds.size > 0;
  const listedGroups = lock.groups.filter((group) => !lock.savedHiddenGroupIds.has(group.id));
  // Three separate facts: how many groups are listed, how many ask for the password,
  // and how many are locked right now.
  const protectedCount = listedGroups.filter((group) => group.lockable).length;
  const lockedCount = listedGroups.filter((group) => lock.lock.lockedGroupIds.has(group.id)).length;
  const groupSearch = groupQuery.trim().toLocaleLowerCase();
  const visibleGroups = groupSearch
    ? listedGroups.filter((group) => group.name.toLocaleLowerCase().includes(groupSearch))
    : listedGroups;
  const searchable = listedGroups.length >= 6;
  const groupSummary = t("{p0} groups · {p1} protected · {p2} locked", {
    p0: listedGroups.length,
    p1: protectedCount,
    p2: lockedCount,
  });

  const toggleLockable = (id: string, name: string, on: boolean) => {
    if (!on) setDialog({ kind: "remove-lock", id, name });
    else if (!lock.hasPassword) setDialog({ kind: "set", thenLockable: id });
    else commit(`lockable:${id}`, () => makeGroupLockable(id));
  };

  return (
    <div className="group-privacy-controls">
      <Group id="group-lock-password" title={t("Lock password")}>
        {lock.hasPassword ? (
          <>
            <Row label={t("Password is set")}>
              <Button className="shrink-0" onClick={() => setDialog({ kind: "change" })}>
                {t("Change password…")}
              </Button>
            </Row>
            <Row
              label={t("Forgot the password?")}
              description={t("Reset protection. Your projects and hidden preferences stay saved.")}
            >
              <Button className="shrink-0" onClick={() => setDialog({ kind: "forgot" })}>
                {t("Forgot password…")}
              </Button>
            </Row>
            {/* The only destructive action of the group; it keeps its password confirmation. */}
            <Row
              label={t("Remove protection")}
              description={t("Removes the password and all group locks.")}
            >
              <Button
                variant="danger"
                className="shrink-0"
                onClick={() => setDialog({ kind: "remove" })}
              >
                {t("Remove password…")}
              </Button>
            </Row>
          </>
        ) : (
          <Row
            label={t("No password set")}
            description={t("Add a password to protect groups and hidden names.")}
          >
            <Button className="shrink-0" onClick={() => setDialog({ kind: "set" })}>
              {t("Set lock password…")}
            </Button>
          </Row>
        )}
      </Group>

      <Group id="group-lock-options" title={t("Automatic locking")}>
        <Row
          label={t("Lock on startup")}
          id="group-lock-startup"
          description={t("Relock protected groups when {p0} opens.", {
            p0: PRODUCT_IDENTITY.displayName,
          })}
          feedback={unsavedNote("relock")}
        >
          <Toggle
            label={t("Lock groups again when {p0} starts", {
              p0: PRODUCT_IDENTITY.displayName,
            })}
            on={lock.settings.relockOnLaunch}
            onChange={(on) => commit("relock", () => setRelockOnLaunch(on))}
          />
        </Row>
        <Row
          label={t("Lock when idle")}
          id="group-lock-idle"
          description={t("Lock after a period without mouse or keyboard activity.")}
          feedback={unsavedNote("idle")}
        >
          <Select
            label={t("Auto-lock after inactivity")}
            value={String(lock.settings.autoLockMinutes)}
            options={AUTO_LOCK_MINUTES.map((minutes) => ({
              value: String(minutes),
              label: autoLockLabel(minutes),
            }))}
            onChange={(value) =>
              commit("idle", () => setAutoLockMinutes(parseAutoLockMinutes(Number(value))))
            }
          />
        </Row>
        <Row
          label={t("Unlock groups together")}
          id="group-unlock-together"
          description={t("One password entry opens all locked groups.")}
          feedback={unsavedNote("together")}
        >
          <Toggle
            label={t("Unlocking one group unlocks all")}
            on={lock.settings.unlockAll}
            onChange={(on) => commit("together", () => setUnlockAll(on))}
          />
        </Row>
      </Group>

      <Group
        id="group-lock-groups"
        title={t("Group protection")}
        description={t("Choose which groups require your password.")}
        action={
          <Button
            className="shrink-0"
            disabled={!hasLockable}
            loading={Boolean(pendingWrites["lock-all"])}
            loadingLabel={t("Updating...")}
            startIcon={<Lock className="icon-sm" />}
            tooltip={
              hasLockable
                ? t("Also hides groups that are temporarily visible.")
                : t("Protect or hide a group first to use Lock all groups.")
            }
            onClick={() =>
              commit("lock-all", async () => {
                await lockAllGroups();
                return true;
              })
            }
          >
            {t("Lock all groups")}
          </Button>
        }
      >
        {unsaved["lock-all"] ? (
          <div className="privacy-save-feedback">
            <Alert tone="danger">
              {t("Groups remain concealed here. Protection could not be confirmed.")}
            </Alert>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                void recoverRoomPrivacyProjection()
                  .then(() =>
                    commit("lock-all", async () => {
                      await lockAllGroups();
                      return true;
                    }),
                  )
                  .catch(() => {});
              }}
            >
              {t("Retry")}
            </Button>
          </div>
        ) : null}
        {listedGroups.length === 0 ? (
          <EmptyState
            size="inline"
            className="settings-collection settings-collection-empty privacy-empty"
            descriptionText={{ size: "caption", tone: "secondary", leading: "normal" }}
            title={lock.groups.length === 0 ? t("No groups yet") : t("All groups are hidden")}
            description={
              lock.groups.length === 0
                ? t("Create a group in the project list to configure protection.")
                : t("Manage them in Hidden groups.")
            }
          />
        ) : (
          <div className="settings-collection privacy-group-collection">
            {searchable ? (
              <CollectionToolbar
                label={t("Search groups")}
                query={groupQuery}
                onQueryChange={setGroupQuery}
                count={
                  groupSearch
                    ? t("Showing {p0} of {p1} groups", {
                        p0: visibleGroups.length,
                        p1: listedGroups.length,
                      })
                    : groupSummary
                }
              />
            ) : (
              <Text
                as="p"
                size="caption"
                tone="secondary"
                leading="inherit"
                className="privacy-group-summary"
                role="status"
              >
                {groupSummary}
              </Text>
            )}
            <Text
              as="div"
              size="caption"
              tone="secondary"
              weight="medium"
              leading="inherit"
              className="privacy-group-columns"
              aria-hidden="true"
            >
              <span>{t("Group")}</span>
              <span>{t("Lock state")}</span>
              <span>{t("Requires password")}</span>
            </Text>
            <ScrollArea
              gutter="stable"
              className="settings-collection-list privacy-group-list"
              role="list"
            >
              {visibleGroups.length === 0 ? (
                <EmptyState
                  size="inline"
                  kind="filtered"
                  className="settings-collection-empty"
                  descriptionText={{ size: "caption", tone: "secondary", leading: "normal" }}
                  description={t("No groups found")}
                  resetLabel={t("Clear search")}
                  onReset={() => setGroupQuery("")}
                />
              ) : null}
              {visibleGroups.map((group) => {
                const locked = lock.lock.lockedGroupIds.has(group.id);
                return (
                  <div
                    key={group.id}
                    role="listitem"
                    className="settings-collection-row privacy-group-row"
                  >
                    <span className="privacy-group-name">
                      <Text
                        as="span"
                        size="secondary"
                        tone="primary"
                        weight="medium"
                        leading="inherit"
                        className="privacy-group-title"
                      >
                        {group.name}
                      </Text>
                    </span>
                    {/* Only real states: locked now, unlocked, or (a dash) not protected at all. */}
                    {locked ? (
                      <Badge className="privacy-group-state">{t("Locked")}</Badge>
                    ) : group.lockable ? (
                      <Text
                        size="caption"
                        tone="secondary"
                        leading="inherit"
                        className="privacy-group-state privacy-group-state-quiet"
                      >
                        {t("Unlocked")}
                      </Text>
                    ) : (
                      <Text
                        size="caption"
                        tone="secondary"
                        leading="inherit"
                        className="privacy-group-state privacy-group-state-quiet"
                      >
                        <span aria-hidden>—</span>
                        <span className="sr-only">{t("Not protected")}</span>
                      </Text>
                    )}
                    <span className="privacy-group-toggle">
                      <Toggle
                        label={t("{p0} is lockable", { p0: group.name })}
                        on={group.lockable === true}
                        onChange={(on) => toggleLockable(group.id, group.name, on)}
                      />
                    </span>
                    {unsavedNote(`lockable:${group.id}`, false)}
                  </div>
                );
              })}
            </ScrollArea>
          </div>
        )}
      </Group>
      <HiddenGroupsSettings controls={{ Group, Row }} />

      {dialog?.kind === "set" ? (
        <SetLockPasswordDialog
          mode="set"
          onClose={close}
          onDone={() => {
            if (dialog.thenLockable) {
              const id = dialog.thenLockable;
              commit(`lockable:${id}`, () => makeGroupLockable(id));
            }
          }}
        />
      ) : null}
      {dialog?.kind === "change" ? <SetLockPasswordDialog mode="change" onClose={close} /> : null}
      {dialog?.kind === "remove" ? (
        <PasswordPromptDialog
          title={t("Remove lock password")}
          description={t("Removes the password and every group lock.")}
          submitLabel={t("Remove password")}
          danger
          verify={removeLockPassword}
          onDone={close}
          onClose={close}
        />
      ) : null}
      {dialog?.kind === "forgot" ? <ForgotLockPasswordDialog onClose={close} /> : null}
      {dialog?.kind === "remove-lock" ? (
        <PasswordPromptDialog
          title={t("Remove lock from {p0}", { p0: dialog.name })}
          description={t("The group stays; it just stops asking for the password.")}
          submitLabel={t("Remove lock")}
          danger
          verify={(password) => removeGroupLock(dialog.id, password)}
          onDone={close}
          onClose={close}
        />
      ) : null}
    </div>
  );
}
