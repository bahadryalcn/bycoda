import { RadioGroup as ArcRadioGroup, type RadioGroupProps } from "./arc/radio-group/radio-group";
export type { RadioGroupProps, RadioOption } from "./arc/radio-group/radio-group";

/** Application entry point. Native radio semantics remain with the adapted source. */
export function RadioGroup(props: RadioGroupProps) {
  return <ArcRadioGroup {...props} />;
}
