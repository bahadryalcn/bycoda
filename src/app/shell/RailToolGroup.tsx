import type { ReactNode } from "react";
import { Button } from "../../shared/ui/Button";
import { ButtonGroup, ButtonGroupSelection } from "../../shared/ui/ButtonGroup";
import { StatusDot } from "../../shared/ui/StatusDot";
import "./toolNavigation.css";

export type RailTool = {
  id: string;
  label: string;
  icon: ReactNode;
  active: boolean;
  onSelect?: () => void;
  shortcut?: string | null;
  /** Unseen items: a dot on the icon and an extra tooltip line. */
  dot?: string;
  /** Guide spotlight target name (`data-usage-guide`). */
  guide?: string;
  onOpenContextMenu?: (x: number, y: number) => void;
};

/** Workspace tools as one joined group of icon buttons that wraps into rows on a narrow rail (bycoda.css); each name lives in its tooltip. */
export function RailToolGroup({ label, tools }: { label: string; tools: readonly RailTool[] }) {
  return (
    <ButtonGroup
      aria-label={label}
      surface="navigation"
      selection="plate"
      className="w-full"
      data-rail-tool-group=""
    >
      {tools.map((tool) => (
        <Button
          key={tool.id}
          iconOnly
          label={tool.dot ? `${tool.label}, ${tool.dot}` : tool.label}
          tooltip={tool.label}
          tooltipDetails={tool.dot ? [tool.dot] : undefined}
          shortcut={tool.shortcut}
          variant="ghost"
          size="sm"
          motion="none"
          type="button"
          selected={tool.active}
          aria-current={tool.active ? "page" : undefined}
          disabled={!tool.onSelect}
          onClick={tool.onSelect}
          data-usage-guide={tool.guide}
          className="min-w-0 flex-1"
          onContextMenu={
            tool.onOpenContextMenu
              ? (event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  tool.onOpenContextMenu?.(event.clientX, event.clientY);
                }
              : undefined
          }
          onKeyDown={
            tool.onOpenContextMenu
              ? (event) => {
                  if (event.key !== "ContextMenu" && !(event.shiftKey && event.key === "F10"))
                    return;
                  event.preventDefault();
                  event.stopPropagation();
                  const rect = event.currentTarget.getBoundingClientRect();
                  tool.onOpenContextMenu?.(rect.left, rect.bottom);
                }
              : undefined
          }
        >
          {tool.active ? <ButtonGroupSelection /> : null}
          {/* The dot is anchored to the icon, selected or not. */}
          <span className="relative inline-flex">
            {tool.icon}
            {tool.dot ? (
              <StatusDot label={tool.dot} aria-hidden className="absolute end-1 top-1" />
            ) : null}
          </span>
        </Button>
      ))}
    </ButtonGroup>
  );
}
