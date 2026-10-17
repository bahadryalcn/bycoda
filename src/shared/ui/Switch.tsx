import { Switch as ArcSwitch, type SwitchProps as ArcSwitchProps } from "./arc/switch/switch";
import type { Ref } from "react";

export type SwitchProps = ArcSwitchProps & { ref?: Ref<HTMLButtonElement> };

/** Immediate boolean choice. Domain callbacks and sound belong to consumers. */
export function Switch({ className, compact = true, type = "button", ...props }: SwitchProps) {
  return (
    <ArcSwitch
      {...props}
      type={type}
      compact={compact}
      className={["bycoda-arc bycoda-arc-switch", className].filter(Boolean).join(" ")}
    />
  );
}
