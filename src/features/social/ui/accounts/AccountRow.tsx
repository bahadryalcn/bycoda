import { Text } from "../../../../shared/ui/Text";
import { Button } from "../../../../shared/ui/Button";
import { surfaceAttributes, Surface } from "../../../../shared/ui/Surface";
import { OverflowTooltip } from "../../../../shared/ui/Tooltip";
import { Badge, type BadgeTone } from "../../../../shared/ui/Badge";
import type { Capability, SocialAccount } from "../../model/social";
import { PlatformMark } from "../common/PlatformIcon";
import type { AccountHealth } from "./accountsModel";
import { accountModeText, capabilitySummary } from "./accountsModel";
import "./accounts.css";

export type AccountRowProps = {
  account: SocialAccount;
  health: AccountHealth;
  capabilities?: readonly Pick<Capability, "operation" | "status">[];
  selected?: boolean;
  onOpen: () => void;
};

const HEALTH_TONE: Record<AccountHealth["status"], BadgeTone> = {
  ok: "success",
  warn: "warning",
  error: "danger",
};

/**
 * One account as a card: platform mark, name, "Browser" or "API" (the Host reports no handle), its connection status
 * and what it can do. The whole card opens the account.
 */
export function AccountRow({
  account,
  health,
  capabilities = [],
  selected = false,
  onOpen,
}: AccountRowProps) {
  const summary = capabilitySummary(capabilities);
  return (
    <Surface
      as="li"
      variant="card"
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
            <Text size="caption" tone="muted" leading="inherit" className="social-account-row-mode">
              {accountModeText(account)}
            </Text>
            <span className="social-account-row-status">
              <Badge tone={HEALTH_TONE[health.status]} size="sm">
                {health.text}
              </Badge>
            </span>
          </span>
        </span>
        {summary ? (
          <Text
            size="caption"
            tone="muted"
            leading="inherit"
            truncate
            {...surfaceAttributes(
              { frame: "settings", edge: "block-start" },
              "social-account-row-caps",
            )}
          >
            {summary}
          </Text>
        ) : null}
      </Button>
    </Surface>
  );
}
