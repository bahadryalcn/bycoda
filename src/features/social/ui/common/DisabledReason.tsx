import { useId } from "react";
import { Button, type ButtonProps } from "../../../../shared/ui/Button";
import { Text } from "../../../../shared/ui/Text";
import "./common.css";

/** A disabled control must say why: `reason` is required whenever `disabled` is true. */
export type DisabledReasonProps = ButtonProps &
  ({ disabled?: false; reason?: string } | { disabled: true; reason: string });

/**
 * An enabled-or-blocked decision that carries its reason. Pass it through `gateProps` and spread
 * the result into a DisabledReason; a plain boolean cannot type-check, by design.
 */
export type ActionGate = { disabled?: false } | { disabled: true; disabledReason: string };

/** Converts an ActionGate into the DisabledReason props. */
export function gateProps(
  gate: ActionGate,
): { disabled: false } | { disabled: true; reason: string } {
  return gate.disabled === true
    ? { disabled: true, reason: gate.disabledReason }
    : { disabled: false };
}

/**
 * The blocked reason of a gate, or undefined while it is open. For a footer that shows the reason
 * at its start edge (`ModalActions reason`) and passes the same text as the Button's `disabledReason`.
 */
export function gateReason(gate: ActionGate): string | undefined {
  return gate.disabled ? gate.disabledReason : undefined;
}

/**
 * Shared Button plus the reason as visible text. The reason is linked with aria-describedby,
 * so it is read with the control and never shown only on hover.
 */
export function DisabledReason({ disabled, reason, children, ...button }: DisabledReasonProps) {
  const reasonId = useId();
  const describedBy = [button["aria-describedby"], disabled && reason ? reasonId : undefined]
    .filter(Boolean)
    .join(" ");
  return (
    <span className="social-disabled-reason">
      <Button {...button} disabled={disabled} aria-describedby={describedBy || undefined}>
        {children}
      </Button>
      {disabled && reason ? (
        <Text
          as="span"
          tone="secondary"
          leading="snug"
          id={reasonId}
          className="social-disabled-reason-text"
        >
          {reason}
        </Text>
      ) : null}
    </span>
  );
}
