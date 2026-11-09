import type { BrowserElementTarget } from "../../shared/lib/browserAnnotation";
import { t, useLocale } from "../../shared/i18n/technical";
import { Button } from "../../shared/ui/Button";
import { SearchableSelect } from "../../shared/ui/SearchableSelect";
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight } from "../../shared/ui/icons";
import "./browser-annotation.css";

export type BrowserTraversalDirection =
  | "parent"
  | "child"
  | "previousSibling"
  | "nextSibling"
  | "ancestor";

/** Selection navigation only. The owning panel validates the exact node and capture. */
export function BrowserInspectorNavigation({
  element,
  disabled,
  onTraverse,
}: {
  element: BrowserElementTarget;
  disabled: boolean;
  onTraverse: (direction: BrowserTraversalDirection, ancestorIndex?: number) => void;
}) {
  useLocale();
  if (!element.nodeId) return null;
  const ancestors = element.ancestry.slice(-64);
  const actions = [
    { direction: "parent", label: "Select parent", Icon: ArrowUp },
    { direction: "child", label: "Select first child", Icon: ArrowDown },
    { direction: "previousSibling", label: "Select previous sibling", Icon: ChevronLeft },
    { direction: "nextSibling", label: "Select next sibling", Icon: ChevronRight },
  ] as const;
  return (
    <div className="browser-inspector-navigation">
      <div className="browser-inspector-relatives">
        {actions.map(({ direction, label, Icon }) => (
          <Button
            key={direction}
            variant="ghost"
            size="sm"
            iconOnly
            label={t(label)}
            disabled={disabled || (direction === "parent" && !element.parentNodeId)}
            onClick={() => onTraverse(direction)}
          >
            <Icon className="icon-sm" aria-hidden />
          </Button>
        ))}
        {ancestors.length > 4 ? (
          <SearchableSelect
            hideLabel
            label={t("Select ancestor")}
            variant="row"
            disabled={disabled}
            value="current"
            options={[
              { value: "current", label: element.tag, disabled: true },
              ...ancestors.map((ancestor, index) => ({
                value: String(ancestors.length - index - 1),
                label: ancestor.selectorPart,
                description: ancestors
                  .slice(0, index)
                  .map((item) => item.tag)
                  .join(" / "),
              })),
            ]}
            onChange={(value) => {
              if (value !== "current") onTraverse("ancestor", Number(value));
            }}
          />
        ) : null}
      </div>
      <div className="browser-inspector-breadcrumbs">
        {ancestors.slice(-4).map((ancestor, index, visible) => (
          <Button
            key={`${index}:${ancestor.selectorPart}`}
            variant="ghost"
            size="sm"
            tooltip={ancestor.selectorPart}
            disabled={disabled}
            onClick={() => onTraverse("ancestor", visible.length - index - 1)}
          >
            {ancestor.tag}
          </Button>
        ))}
        <code>{element.tag}</code>
      </div>
    </div>
  );
}
