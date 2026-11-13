import { surfaceAttributes } from "../../../../shared/ui/Surface";
import { useLayoutEffect, useRef } from "react";
import { observeResize } from "../../../../shared/lib/observeResize";
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
  const nav = useRef<HTMLElement>(null);
  // oxlint-disable-next-line bycoda/effect-names-its-sync -- Sync nav scroll with selected tab and DOM resizing without moving page scroll.
  useLayoutEffect(() => {
    const node = nav.current;
    if (!node) return;
    const reveal = () => {
      const tab = node.querySelector<HTMLElement>('[aria-selected="true"]');
      if (!tab) return;
      const bounds = node.getBoundingClientRect();
      const selected = tab.getBoundingClientRect();
      if (selected.left < bounds.left) node.scrollLeft += selected.left - bounds.left;
      else if (selected.right > bounds.right) node.scrollLeft += selected.right - bounds.right;
    };
    reveal();
    const cleanups = [observeResize(node, reveal)];
    const list = node.querySelector<HTMLElement>('[role="tablist"]');
    if (list) {
      cleanups.push(observeResize(list, reveal));
      for (const tab of list.querySelectorAll<HTMLElement>('[role="tab"]')) {
        cleanups.push(observeResize(tab, reveal));
      }
    }
    return () => cleanups.forEach((cleanup) => cleanup());
  }, [active]);
  return (
    <nav ref={nav} {...surfaceAttributes({ frame: "pane", edge: "bottom" }, "social-shell-nav")}>
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
