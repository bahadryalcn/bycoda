import type { ComponentPropsWithRef } from "react";
import { Button } from "./Button";

type Props = Omit<ComponentPropsWithRef<"button">, "className"> & {
  danger?: boolean;
};

export function SecondaryButton({ danger = false, type = "button", children, ...props }: Props) {
  return (
    <Button {...props} type={type} variant={danger ? "danger" : "secondary"} className="shrink-0">
      {children}
    </Button>
  );
}
