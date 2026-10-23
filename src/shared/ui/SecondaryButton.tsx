import { Button, type ButtonProps } from "./Button";

type SecondaryProps<P> = P extends unknown
  ? Omit<P, "variant" | "className"> & { danger?: boolean }
  : never;
export type SecondaryButtonProps = SecondaryProps<ButtonProps>;

/**
 * @deprecated Thin alias of `Button`. Use `<Button>` (variant="secondary" is the default;
 * `danger` becomes `tone="danger"`). The only extra output is `className="shrink-0"`.
 */
export function SecondaryButton({
  danger = false,
  type = "button",
  children,
  ...props
}: SecondaryButtonProps) {
  return (
    <Button {...props} type={type} variant={danger ? "danger" : "secondary"} className="shrink-0">
      {children}
    </Button>
  );
}
