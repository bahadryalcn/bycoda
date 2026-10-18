import {
  ExpandingButtonGroup as ArcExpandingButtonGroup,
  type ExpandingButtonGroupProps,
} from "./arc/expanding-button-group/expanding-button-group";

export type {
  ExpandingButtonGroupProps,
  ExpandingButtonGroupItem,
  ExpandingButtonGroupTriggerProps,
} from "./arc/expanding-button-group/expanding-button-group";

/** A small set of familiar commands; callbacks retain their async result contracts. */
export function ExpandingButtonGroup(props: ExpandingButtonGroupProps) {
  return (
    <ArcExpandingButtonGroup
      {...props}
      className={["bycoda-arc", props.className].filter(Boolean).join(" ")}
    />
  );
}
