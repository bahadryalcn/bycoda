import { t, useLocale } from "../../../shared/i18n";
import { PRODUCT_IDENTITY } from "../../../shared/lib/productIdentity";
import { useState, type ReactNode } from "react";
import { Folder, Lock, LockOpen, Shield } from "../../../shared/ui/icons";
import "./GroupPrivacy.css";
import { SecondaryButton } from "../../../shared/ui/SecondaryButton";
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
import { AdvancedSettings } from "../../settings/ui/settingsControls";

/** The Settings building blocks, passed in so this page matches the others. */
export type GroupLockControls = {
  Group: (props: {
    id?: string;
    title: ReactNode;
    description?: string;
    action?: ReactNode;
    children: ReactNode;
  }) => ReactNode;
  Row: (props: {
    id?: string;
    label: ReactNode;
    description?: string;
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
  const close = () => setDialog(null);
  const hasLockable =
    lock.groups.some((group) => group.lockable) || lock.savedHiddenGroupIds.size > 0;
  const listedGroups = lock.groups.filter((group) => !lock.savedHiddenGroupIds.has(group.id));

  const toggleLockable = (id: string, name: string, on: boolean) => {
    if (!on) setDialog({ kind: "remove-lock", id, name });
    else if (!lock.hasPassword) setDialog({ kind: "set", thenLockable: id });
    else makeGroupLockable(id);
  };

  return (
    <div className="group-privacy-controls">
      <Group
        id="group-lock-password"
        title={
          <span className="privacy-heading">
            <Shield aria-hidden className="size-4" />
            {t("Lock password")}
          </span>
        }
      >
        {lock.hasPassword ? (
          <>
            <Row label={<span className="privacy-status">{t("Password is set")}</span>}>
              <SecondaryButton onClick={() => setDialog({ kind: "change" })}>
                {t("Change password…")}
              </SecondaryButton>
            </Row>
            <section className="privacy-recovery">
              <h3>{t("Password recovery & removal")}</h3>
              <Row
                label={t("Remove protection")}
                description={t("Removes the password and all group locks.")}
              >
                <SecondaryButton danger onClick={() => setDialog({ kind: "remove" })}>
                  {t("Remove password…")}
                </SecondaryButton>
              </Row>
              <Row
                label={t("Forgot the password?")}
                description={t(
                  "Reset protection. Your projects and hidden preferences stay saved.",
                )}
              >
                <SecondaryButton danger onClick={() => setDialog({ kind: "forgot" })}>
                  {t("Forgot password…")}
                </SecondaryButton>
              </Row>
            </section>
          </>
        ) : (
          <Row
            label={t("No password set")}
            description={t("Add a password to protect groups and hidden names.")}
          >
            <SecondaryButton onClick={() => setDialog({ kind: "set" })}>
              {t("Set lock password…")}
            </SecondaryButton>
          </Row>
        )}
        <AdvancedSettings
          title={t("Automatic locking")}
          settingIds={[
            "group-lock-options",
            "group-lock-startup",
            "group-lock-idle",
            "group-unlock-together",
          ]}
        >
          <div id="setting-group-lock-options" data-setting-id="group-lock-options" tabIndex={-1}>
            <Row
              label={t("Lock on startup")}
              id="group-lock-startup"
              description={t("Relock protected groups when {p0} opens.", {
                p0: PRODUCT_IDENTITY.displayName,
              })}
            >
              <Toggle
                label={t("Lock groups again when {p0} starts", {
                  p0: PRODUCT_IDENTITY.displayName,
                })}
                on={lock.settings.relockOnLaunch}
                onChange={setRelockOnLaunch}
              />
            </Row>
            <Row
              label={t("Lock when idle")}
              id="group-lock-idle"
              description={t("Lock after a period without mouse or keyboard activity.")}
            >
              <Select
                label={t("Auto-lock after inactivity")}
                value={String(lock.settings.autoLockMinutes)}
                options={AUTO_LOCK_MINUTES.map((minutes) => ({
                  value: String(minutes),
                  label: autoLockLabel(minutes),
                }))}
                onChange={(value) => setAutoLockMinutes(parseAutoLockMinutes(Number(value)))}
              />
            </Row>
            <Row
              label={t("Unlock groups together")}
              id="group-unlock-together"
              description={t("One password entry opens all locked groups.")}
            >
              <Toggle
                label={t("Unlocking one group unlocks all")}
                on={lock.settings.unlockAll}
                onChange={setUnlockAll}
              />
            </Row>
          </div>
        </AdvancedSettings>
      </Group>

      <Group
        id="group-lock-groups"
        title={
          <span className="privacy-heading">
            {t("Group protection")}
            <Badge>{listedGroups.length}</Badge>
          </span>
        }
        description={t("Choose which groups require your password.")}
        action={
          <SecondaryButton
            disabled={!hasLockable}
            tooltip={
              hasLockable
                ? t("Also hides groups that are temporarily visible.")
                : t("Protect or hide a group first to use Lock all groups.")
            }
            onClick={lockAllGroups}
          >
            <Lock aria-hidden className="size-3.5" />
            {t("Lock all groups")}
          </SecondaryButton>
        }
      >
        <div className="privacy-group-list">
          {listedGroups.length === 0 ? (
            <Row
              label={lock.groups.length === 0 ? t("No groups yet") : t("All groups are hidden")}
              description={
                lock.groups.length === 0
                  ? t("Create a group in the project list to configure protection.")
                  : t("Manage them in Hidden groups.")
              }
            />
          ) : (
            listedGroups.map((group) => {
              const locked = lock.lock.lockedGroupIds.has(group.id);
              return (
                <Row
                  key={group.id}
                  label={
                    <span className="privacy-group-name">
                      <span className="privacy-group-icon" aria-hidden>
                        {locked ? (
                          <Lock className="size-3.5" strokeWidth={1.75} />
                        ) : group.lockable ? (
                          <LockOpen className="size-3.5" strokeWidth={1.75} />
                        ) : (
                          <Folder className="size-3.5" />
                        )}
                      </span>
                      <span className="privacy-group-title">{group.name}</span>
                      <Badge className="privacy-group-state">
                        {locked ? t("Locked") : group.lockable ? t("Unlocked") : t("Not protected")}
                      </Badge>
                    </span>
                  }
                >
                  <Toggle
                    label={t("{p0} is lockable", { p0: group.name })}
                    on={group.lockable === true}
                    onChange={(on) => toggleLockable(group.id, group.name, on)}
                  />
                </Row>
              );
            })
          )}
        </div>
      </Group>
      <HiddenGroupsSettings controls={{ Group, Row }} />
      <p className="privacy-footnote">
        {t("Privacy controls affect what appears in ")}
        {PRODUCT_IDENTITY.displayName}
        {t(". Project files and transcripts on disk are not encrypted.")}
      </p>

      {dialog?.kind === "set" ? (
        <SetLockPasswordDialog
          mode="set"
          onClose={close}
          onDone={() => {
            if (dialog.thenLockable) makeGroupLockable(dialog.thenLockable);
          }}
        />
      ) : null}
      {dialog?.kind === "change" ? <SetLockPasswordDialog mode="change" onClose={close} /> : null}
      {dialog?.kind === "remove" ? (
        <PasswordPromptDialog
          title={t("Remove lock password")}
          description={t("Removes the password and every group lock.")}
          submitLabel="Remove password"
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
          submitLabel="Remove lock"
          danger
          verify={(password) => removeGroupLock(dialog.id, password)}
          onDone={close}
          onClose={close}
        />
      ) : null}
    </div>
  );
}
