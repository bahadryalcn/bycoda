import type { ReactNode } from "react";
import { Text } from "../../../../shared/ui/Text";
import { Row } from "../../../../shared/ui/settings";

/** Provider setup instructions as one stacked settings row. */
export function SetupSteps({
  title,
  steps,
  children,
}: {
  title: string;
  steps: readonly ReactNode[];
  /** Extra content below the steps, such as a copy action. */
  children?: ReactNode;
}) {
  return (
    <Row stacked label={title}>
      <Text as="ol" className="integration-steps">
        {steps.map((step, index) => (
          <li key={index}>{step}</li>
        ))}
      </Text>
      {children}
    </Row>
  );
}
