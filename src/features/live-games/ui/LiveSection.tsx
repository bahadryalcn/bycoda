import { useId, type ReactNode } from "react";
import { Heading } from "../../../shared/ui/Heading";
import { Surface } from "../../../shared/ui/Surface";
import { Text } from "../../../shared/ui/Text";

/** One titled card of the Live games page; `step` numbers the setup order. */
export function LiveSection({
  step,
  title,
  status,
  children,
}: {
  step?: number;
  title: string;
  /** Quiet state shown at the end of the title row. */
  status?: ReactNode;
  children: ReactNode;
}) {
  const titleId = useId();
  return (
    <Surface
      as="section"
      variant="card"
      padding="md"
      aria-labelledby={titleId}
      className="flex min-w-0 flex-col gap-3"
    >
      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
        {step ? (
          <Text size="caption" tone="secondary" className="tabular-nums" aria-hidden="true">
            {step}
          </Text>
        ) : null}
        <Heading id={titleId} size="section">
          {title}
        </Heading>
        {status ? <div className="ml-auto min-w-0">{status}</div> : null}
      </div>
      {children}
    </Surface>
  );
}
