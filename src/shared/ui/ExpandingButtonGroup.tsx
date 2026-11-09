import {
  ExpandingButtonGroup as ArcExpandingButtonGroup,
  type ExpandingButtonGroupProps,
} from "./arc/expanding-button-group/expanding-button-group";

export type {
  ExpandingButtonGroupProps,
  ExpandingButtonGroupItem,
  ExpandingButtonGroupTriggerProps,
} from "./arc/expanding-button-group/expanding-button-group";

/**
 * Arc button strip that expands to reveal a small set of commands; async callbacks keep their result contracts.
 * @group actions
 * @use A compact rail or card action that expands on hover/focus to reveal a few related commands (item list, overflow).
 * @avoid Always-visible related actions: ButtonGroup. One default action plus variants: SplitButton. Many commands: DropdownMenu.
 * @arc expanding-button-group
 */
export function ExpandingButtonGroup(props: ExpandingButtonGroupProps) {
  return (
    <ArcExpandingButtonGroup
      {...props}
      className={["bycoda-arc", props.className].filter(Boolean).join(" ")}
    />
  );
}
