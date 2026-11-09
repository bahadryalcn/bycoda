import { t } from "../../../../shared/i18n";
import { TabStrip } from "../../../../shared/ui/Tabs";
import { Inbox, Link, MessageMultiple, Share, Zap } from "../../../../shared/ui/icons";
import { SOCIAL_SCREEN_IDS, type SocialScreenId } from "./screens";

const SCREEN_ICONS: Record<SocialScreenId, typeof Zap> = {
  command: Zap,
  content: Share,
  audience: MessageMultiple,
  inbox: Inbox,
  accounts: Link,
};

function screenLabel(screen: SocialScreenId): string {
  switch (screen) {
    case "command":
      return t("Command");
    case "content":
      return t("Content");
    case "audience":
      return t("Audience");
    case "inbox":
      return t("Inbox");
    case "accounts":
      return t("Accounts & Settings");
  }
}

/**
 * The five-section switcher: one horizontal strip of icon and short label. A hairline under the strip
 * marks it as navigation; it scrolls sideways instead of spreading the tabs across the width.
 */
export function SocialNav({
  active,
  onSelect,
}: {
  active: SocialScreenId;
  onSelect: (screen: SocialScreenId) => void;
}) {
  return (
    <nav className="social-shell-nav">
      <TabStrip
        label={t("Social sections")}
        value={active}
        onValueChange={onSelect}
        items={SOCIAL_SCREEN_IDS.map((screen) => {
          const Icon = SCREEN_ICONS[screen];
          return {
            value: screen,
            label: screenLabel(screen),
            icon: <Icon className="icon-sm" aria-hidden />,
          };
        })}
      />
    </nav>
  );
}
