import {
  FloatingButtonGroup as ArcFloatingButtonGroup,
  type FloatingButtonGroupProps,
} from "./arc/floating-button-group/floating-button-group";

export type {
  FloatingButtonGroupAction,
  FloatingButtonGroupItem,
  FloatingButtonGroupProps,
} from "./arc/floating-button-group/floating-button-group";

/** Contextual commands only. Placement, selection and async lifecycle stay with the caller. */
export function FloatingButtonGroup({ className, ...props }: FloatingButtonGroupProps) {
  return (
    <ArcFloatingButtonGroup
      {...props}
      className={["bycoda-arc bycoda-arc-floating", className].filter(Boolean).join(" ")}
    />
  );
}
