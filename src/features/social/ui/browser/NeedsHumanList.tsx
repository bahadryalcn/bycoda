import { Text } from "../../../../shared/ui/Text";
import { useCallback, useEffect, useState } from "react";
import { t } from "../../../../shared/i18n";
import { Button } from "../../../../shared/ui/Button";
import { InlineError } from "../../../../shared/ui/InlineError";
import { SOCIAL_PLATFORM_NAMES } from "../../model/social";
import type { NeedsHumanItem } from "../../model/socialActions";
import { EmptyHint } from "../common/EmptyHint";
import { PlatformMark } from "../common/PlatformIcon";
import type { SocialScreenProps } from "../shell/screens";
import { LiveBrowserPanel } from "./LiveBrowserPanel";
import "./needs-human.css";

/** Waiting items are refreshed on this interval while the screen is active. */
const POLL_MS = 15_000;

export type NeedsHumanListProps = Pick<SocialScreenProps, "client" | "machineId"> & {
  /** False while the screen is retained but hidden: polling pauses. */
  active?: boolean;
  /** Reports how many items wait, so the host screen can show a count in its header. */
  onCountChange?: (count: number) => void;
};

function reasonLabel(reason: NeedsHumanItem["reason"]): string {
  switch (reason) {
    case "challenge":
      return t("Security check");
    case "verification":
      return t("Verification code");
    case "login":
      return t("Sign-in needed");
    case "unexpected_screen":
      return t("Unexpected page");
  }
}

/** Accounts waiting for the owner. The owner opens the live view, completes the step, then says "I'm done". */
export function NeedsHumanList({ client, active = true, onCountChange }: NeedsHumanListProps) {
  const [items, setItems] = useState<NeedsHumanItem[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [openAccount, setOpenAccount] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [doneFailed, setDoneFailed] = useState(false);

  const count = items?.length;
  useEffect(() => {
    if (count !== undefined) onCountChange?.(count);
  }, [count, onCountChange]);

  const refresh = useCallback(async () => {
    try {
      const result = await client.browser.needsHuman.list();
      setItems(result.items);
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, [client]);

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      await refresh();
      if (!cancelled) timer = setTimeout(tick, POLL_MS);
    };
    void tick().catch(() => setFailed(true));
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [active, refresh]);

  const done = async (id: string) => {
    setBusyId(id);
    setDoneFailed(false);
    try {
      await client.browser.needsHuman.resolve(id);
      await refresh();
    } catch {
      setDoneFailed(true);
    } finally {
      setBusyId(null);
    }
  };

  if (items === null)
    return failed ? (
      <EmptyHint message={t("Waiting items could not be loaded.")} />
    ) : (
      <p>{t("Loading…")}</p>
    );

  if (items.length === 0) return <EmptyHint message={t("Nothing is waiting for you.")} />;

  return (
    <div className="needs-human">
      {failed ? (
        <Text as="p" size="caption" tone="muted" leading="inherit" className="needs-human-note">
          {t("Waiting items could not be refreshed.")}
        </Text>
      ) : null}
      {doneFailed ? <InlineError>{t("Could not mark this as done.")}</InlineError> : null}
      <ul className="needs-human-list">
        {items.map((item) => (
          <li key={item.id} className="needs-human-row">
            <PlatformMark platform={item.platform} size="md" />
            <div className="needs-human-text">
              <Text
                size="body"
                tone="primary"
                leading="inherit"
                weight="medium"
                className="needs-human-reason"
              >
                {reasonLabel(item.reason)}
              </Text>
              <Text size="caption" tone="muted" leading="inherit" className="needs-human-platform">
                {SOCIAL_PLATFORM_NAMES[item.platform]}
              </Text>
            </div>
            <div className="needs-human-actions">
              <Button size="sm" variant="secondary" onClick={() => setOpenAccount(item.accountId)}>
                {t("Open live view")}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={busyId === item.id}
                onClick={() => void done(item.id).catch(() => setDoneFailed(true))}
              >
                {t("I'm done")}
              </Button>
            </div>
          </li>
        ))}
      </ul>
      {openAccount ? (
        <LiveBrowserPanel
          client={client}
          accountId={openAccount}
          onClose={() => setOpenAccount(null)}
        />
      ) : null}
    </div>
  );
}
