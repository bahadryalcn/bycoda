import { Text } from "../../../shared/ui/Text";
import { useRef, useState, type ReactNode } from "react";
import { t, useLocale } from "../../../shared/i18n";
import { Button, type ButtonSize } from "../../../shared/ui/Button";
import { DropdownMenu, type DropdownMenuItem } from "../../../shared/ui/DropdownMenu";
import { openExternal } from "../../../platform/tauri/openExternal";
import type { AccountState } from "../model/accountState";
import { openFeedbackDialog } from "../model/feedbackDialog";
import { accountWebUrl } from "../model/accountPortal";
import { AccountAvatar, type AccountAvatarUser } from "./AccountAvatar";

/** The availability section the host surface contributes (shared assistant presence state). */
export type AccountMenuPresence = {
  /** Nothing to show: the assistant is unsupported or not set up. */
  hidden: boolean;
  items: DropdownMenuItem[];
  /** Called when the menu opens, so the choices run against a fresh host token. */
  begin: () => void;
  end: () => void;
  /** Returns true when the id was an availability row. */
  pick: (id: string) => boolean;
  /** Status mark drawn on the avatar. */
  badge?: ReactNode;
  /** Names the current availability for the button's accessible name. */
  summary?: string;
};

type Props = {
  size?: ButtonSize;
  state: AccountState;
  presence?: AccountMenuPresence;
  onSignIn: () => void;
  onSignOut: () => void;
  onOpenAccountSettings: () => void;
};

function userOf(state: AccountState): AccountAvatarUser | null {
  return state.phase === "signed-in" ? state.context.user : null;
}

/** Sidebar account button and its menu: identity, availability, account pages, sign in/out. */
export function AccountMenu({
  size,
  state,
  presence,
  onSignIn,
  onSignOut,
  onOpenAccountSettings,
}: Props) {
  useLocale();
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const user = userOf(state);
  const showPresence = Boolean(presence && !presence.hidden);
  const accountAvailable = state.phase !== "unavailable";
  if (!accountAvailable && !showPresence) return null;

  const close = () => {
    setOpen(false);
    presence?.end();
  };
  const items: DropdownMenuItem[] = [
    {
      kind: "content",
      id: "identity",
      node: (
        <div className="flex min-w-0 flex-col px-2 py-1.5" data-account-identity>
          <Text size="body" tone="primary" weight="medium" truncate>
            {user ? user.displayName || user.email : t("Guest")}
          </Text>
          <Text size="caption" tone="muted" truncate>
            {user ? user.email : t("Not signed in")}
          </Text>
        </div>
      ),
    },
  ];
  if (showPresence) items.push({ kind: "sep" }, ...presence!.items);
  if (accountAvailable) {
    items.push(
      { kind: "sep" },
      {
        kind: "item",
        id: "settings",
        label: t("Account settings"),
      },
      { kind: "item" as const, id: "feedback", label: t("Send feedback") },
      ...(accountWebUrl()
        ? [{ kind: "item" as const, id: "web", label: t("Manage account on the web") }]
        : []),
      { kind: "sep" },
      user
        ? {
            kind: "item",
            id: "sign-out",
            label: t("Sign out"),
          }
        : {
            kind: "item",
            id: "sign-in",
            label: t("Sign in"),
            disabled: state.phase === "signing-in" || state.phase === "starting",
          },
    );
  }
  const name = user ? user.displayName || user.email || t("Account") : t("Guest");
  return (
    <>
      <Button
        size={size}
        ref={trigger}
        iconOnly
        variant="ghost"
        motion="none"
        label={
          presence?.summary
            ? `${t("Account")}: ${name}. ${presence.summary}`
            : `${t("Account")}: ${name}`
        }
        tooltip={name}
        tooltipSide="top"
        aria-haspopup="menu"
        aria-expanded={open}
        data-account-menu-trigger
        onClick={() => {
          if (open) return close();
          setOpen(true);
          if (showPresence) presence!.begin();
        }}
      >
        <AccountAvatar user={user} badge={showPresence ? presence!.badge : undefined} />
      </Button>
      {open ? (
        <DropdownMenu
          anchor={trigger}
          returnFocusRef={trigger}
          label={t("Account")}
          items={items}
          side="top"
          align="start"
          width={248}
          onClose={close}
          onPick={(id) => {
            if (presence?.pick(id)) return;
            if (id === "settings") onOpenAccountSettings();
            else if (id === "feedback") openFeedbackDialog();
            else if (id === "web") {
              const url = accountWebUrl();
              if (url) void openExternal(url).catch(() => undefined);
            } else if (id === "sign-in") onSignIn();
            else if (id === "sign-out") onSignOut();
          }}
        />
      ) : null}
    </>
  );
}
