import { Children, cloneElement, isValidElement, useId, type ReactNode } from "react";
import { SearchableSelect } from "../../../shared/ui/SearchableSelect";
import { TextField } from "../../../shared/ui/TextField";
import { NativeSelect } from "../../../shared/ui/Select";
import { NativeSearchableSelect } from "../../../shared/ui/NativeSearchableSelect";
import { TextareaField } from "../../../shared/ui/TextareaField";
import { Checkbox } from "../../../shared/ui/Checkbox";
import { t } from "../../../shared/i18n";

/** Display labels of a target's generation/publication state. */
export const programStates: Record<string, string> = {
  pending: "Pending",
  generating: "Generating",
  review: "Review required",
  ready: "Ready",
  queued: "Queued",
  succeeded: "Published",
  failed: "Failed",
  cancelled: "Cancelled",
};
/** Connect domain field labels to native inputs and shared adapters alike. */
export function ProgramLabel({ text, children }: { text: string; children: ReactNode }) {
  const generatedId = useId();
  const firstControl = Children.toArray(children).find(
    (child) =>
      isValidElement<Record<string, unknown>>(child) &&
      [
        TextField,
        TextareaField,
        NativeSelect,
        NativeSearchableSelect,
        Checkbox,
        SearchableSelect,
      ].includes(child.type as typeof TextField),
  );
  const id =
    isValidElement<Record<string, unknown>>(firstControl) &&
    typeof firstControl.props.id === "string"
      ? firstControl.props.id
      : generatedId;
  return (
    <div className="social-program-field">
      <label id={`${id}-label`} htmlFor={id}>
        {t(text)}
      </label>
      {Children.map(children, (child) => {
        if (!isValidElement<Record<string, unknown>>(child)) return child;
        if (child.type === SearchableSelect) {
          const triggerProps = (child.props.triggerProps ?? {}) as Record<string, unknown>;
          return cloneElement(child, {
            triggerProps: {
              ...triggerProps,
              id,
              "aria-labelledby": [triggerProps["aria-labelledby"], `${id}-label`]
                .filter(Boolean)
                .join(" "),
            },
          });
        }
        if (
          ![
            TextField,
            TextareaField,
            NativeSelect,
            NativeSearchableSelect,
            Checkbox,
            "input",
            "select",
            "textarea",
          ].includes(child.type as typeof TextField)
        )
          return child;
        const controlId = child.props.id ?? id;
        return cloneElement(child, {
          id: controlId,
          "aria-labelledby": [child.props["aria-labelledby"], `${id}-label`]
            .filter(Boolean)
            .join(" "),
        });
      })}
    </div>
  );
}
