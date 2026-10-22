import { TextField, type TextFieldProps } from "./TextField";

export type NumberFieldProps = Omit<TextFieldProps, "type">;

/** Native numeric editing, validity and step behavior with the shared field owner.
 * Deliberately does not coerce drafts, clamp on change or format token/percent values.
 */
export function NumberField(props: NumberFieldProps) {
  return <TextField {...props} type="number" />;
}
