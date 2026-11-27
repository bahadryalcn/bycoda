import { t } from "../../../../shared/i18n";
import { Text } from "../../../../shared/ui/Text";
import { Button } from "../../../../shared/ui/Button";
import { Surface } from "../../../../shared/ui/Surface";
import { OverflowTooltip } from "../../../../shared/ui/Tooltip";
import type { SocialAccount } from "../../model/social";
import { PlatformMark } from "../common/PlatformIcon";
import { AccountStatusMark } from "./AccountStatusMark";
import type { AccountHealth } from "./accountsModel";
import "./accounts.css";

export type AccountRowProps = {
  account: SocialAccount;
  health: AccountHealth;
  selected?: boolean;
  onOpen: () => void;
};

/**
 * One account as a card: platform mark and name, plus its connection status only when it needs
 * attention. The whole card opens the account.
 */
export function AccountRow({ account, health, selected = false, onOpen }: AccountRowProps) {
  return (
    <Surface
      as="li"
      variant="canvas"
      frame="pane"
      padding="md"
      className="social-account-item"
      data-selected={selected || undefined}
    >
      <Button
        variant="item"
        className="social-account-row"
        aria-current={selected || undefined}
        selected={selected}
        onClick={onOpen}
      >
        <span className="social-account-row-head">
          <PlatformMark platform={account.platform} size="lg" />
          <span className="social-account-row-text">
            <OverflowTooltip label={account.name}>
              <Text
                size="body"
                tone="inherit"
                leading="inherit"
                weight="medium"
                truncate
                className="social-account-row-name"
              >
                {account.name}
              </Text>
            </OverflowTooltip>
            {health.status !== "ok" || account.paused ? (
              <span className="social-account-row-status">
                {health.status !== "ok" ? (
                  <AccountStatusMark status={health.status} label={health.text} />
                ) : null}
                {account.paused ? <AccountStatusMark status="paused" label={t("Paused")} /> : null}
              </span>
            ) : null}
          </span>
        </span>
      </Button>
    </Surface>
  );
}
