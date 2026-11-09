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
 * Arc floating toolbar of contextual commands; placement, selection and async lifecycle stay with the caller.
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
