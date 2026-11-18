import { useRef, useState } from "react";
import { t } from "../../../shared/i18n";
import { Button } from "../../../shared/ui/Button";
import { DropdownMenu } from "../../../shared/ui/DropdownMenu";
import { SegmentedControl } from "../../../shared/ui/SegmentedControl";
import { CircleDot, GitPullRequest, ListBullet } from "../../../shared/ui/icons";

export type InboxListLayout = "compact" | "comfortable";

export function InboxGithubListControls({
  kind,
  layout,
  onKindChange,
  onLayoutChange,
  splitView,
  onSplitViewChange,
}: {
  kind: "issue" | "pr" | null;
  layout: InboxListLayout;
  onKindChange: (kind: "issue" | "pr") => void;
  onLayoutChange: (layout: InboxListLayout) => void;
  splitView: boolean;
  onSplitViewChange: (splitView: boolean) => void;
}) {
  const anchor = useRef<HTMLButtonElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <div className="flex shrink-0 items-center justify-between gap-2 px-2 py-1">
      {kind ? (
        <SegmentedControl
          className="min-w-0"
          size="sm"
          label={t("GitHub")}
          value={kind}
          options={[
            {
              value: "issue",
              label: t("Issues"),
              icon: <CircleDot className="icon-sm" />,
            },
            {
              value: "pr",
              label: t("Pull requests"),
              icon: <GitPullRequest className="icon-sm" />,
            },
          ]}
          onValueChange={(value) => {
            if (value !== kind) onKindChange(value === "pr" ? "pr" : "issue");
          }}
        />
      ) : null}
      <Button
        ref={anchor}
        className="ms-auto shrink-0"
        iconOnly
        label={t("List view")}
        variant="ghost"
        type="button"
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        onClick={() => setMenuOpen((open) => !open)}
      >
        <ListBullet className="icon-sm" />
      </Button>
      {menuOpen ? (
        <DropdownMenu
          anchor={anchor}
          returnFocusRef={anchor}
          label={t("List view")}
          onClose={() => setMenuOpen(false)}
          items={[
            {
              kind: "item",
              id: "compact",
              label: t("Compact"),
              checked: layout === "compact",
              selectionRole: "radio",
            },
            {
              kind: "item",
              id: "comfortable",
              label: t("Comfortable"),
              checked: layout === "comfortable",
              selectionRole: "radio",
            },
            {
              kind: "item",
              id: "split-view",
              label: t("Side by side"),
              checked: splitView,
              selectionRole: "checkbox",
              closeOnSelect: true,
            },
          ]}
          onPick={(value) => {
            if (value === "split-view") onSplitViewChange(!splitView);
            else onLayoutChange(value === "comfortable" ? "comfortable" : "compact");
            setMenuOpen(false);
          }}
        />
      ) : null}
    </div>
  );
}
