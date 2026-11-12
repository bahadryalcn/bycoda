import {
  FloatingButtonGroup as ArcFloatingButtonGroup,
  type FloatingButtonGroupProps,
} from "./arc/floating-button-group/floating-button-group";

export type {
  FloatingButtonGroupAction,
  FloatingButtonGroupItem,
  FloatingButtonGroupProps,
  FloatingButtonGroupTriggerProps,
} from "./arc/floating-button-group/floating-button-group";

/**
 * Contextual command toolbar with roving focus, a measured hover highlight and stable-width
 * pending/confirmation labels. The caller owns placement and selection; unlike ButtonGroup,
 * this composite manages keyboard traversal and transient command feedback.
 * @group actions
 * @use A floating toolbar anchored over content for the current selection or hovered item (transcript selection, message actions).
 * @avoid Actions in a fixed toolbar or footer: ButtonGroup. A menu of commands: DropdownMenu or ContextMenu.
 * @arc floating-button-group
 */
export function FloatingButtonGroup({ className, ...props }: FloatingButtonGroupProps) {
  return (
    <ArcFloatingButtonGroup
      {...props}
      className={["bycoda-arc bycoda-arc-floating", className].filter(Boolean).join(" ")}
    />
  );
}
