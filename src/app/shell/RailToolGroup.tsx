import type { ReactNode } from "react";
import { Button } from "../../shared/ui/Button";
import { ButtonGroup, ButtonGroupSelection } from "../../shared/ui/ButtonGroup";
import { StatusDot } from "../../shared/ui/StatusDot";

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

/** Workspace tools as one joined row of icon buttons; each name lives in its tooltip. */
export function RailToolGroup({ label, tools }: { label: string; tools: readonly RailTool[] }) {
  return (
    <ButtonGroup aria-label={label} surface="navigation" selection="plate" className="w-full">
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
          className="relative min-w-0 flex-1"
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
          {tool.icon}
          {tool.dot ? (
            <StatusDot
              label={tool.dot}
              aria-hidden
              className="absolute [inset-inline-end:4px] [inset-block-start:4px]"
            />
          ) : null}
        </Button>
      ))}
    </ButtonGroup>
  );
}
