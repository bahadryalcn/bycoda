import { Text } from "../../../../shared/ui/Text";
import { Button } from "../../../../shared/ui/Button";
import { Surface } from "../../../../shared/ui/Surface";
import { OverflowTooltip } from "../../../../shared/ui/Tooltip";
import { Badge, type BadgeTone } from "../../../../shared/ui/Badge";
import type { SocialAccount } from "../../model/social";
import { PlatformMark } from "../common/PlatformIcon";
import type { AccountHealth } from "./accountsModel";
import "./accounts.css";

export type AccountRowProps = {
  account: SocialAccount;
  health: AccountHealth;
  selected?: boolean;
  onOpen: () => void;
};

const HEALTH_TONE: Record<AccountHealth["status"], BadgeTone> = {
  ok: "success",
  warn: "warning",
  error: "danger",
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
            {health.status !== "ok" ? (
              <span className="social-account-row-status">
                <Badge tone={HEALTH_TONE[health.status]} size="sm">
                  {health.text}
                </Badge>
              </span>
            ) : null}
          </span>
        </span>
      </Button>
    </Surface>
  );
}
