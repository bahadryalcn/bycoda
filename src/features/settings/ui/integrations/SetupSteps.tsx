import type { ReactNode } from "react";
import { Text } from "../../../../shared/ui/Text";
import { AdvancedSettings, Row } from "../settingsControls";

/** Provider setup instructions behind a closed disclosure, so the form stays compact. */
export function SetupSteps({
  title,
  label,
  steps,
  children,
}: {
  title: string;
  label: string;
  steps: readonly ReactNode[];
  /** Extra content below the steps, such as a copy action. */
  children?: ReactNode;
}) {
  return (
    <AdvancedSettings title={title} defaultOpen={false}>
      <Row stacked label={label}>
        <Text as="ol" className="integration-steps">
          {steps.map((step, index) => (
            <li key={index}>{step}</li>
          ))}
        </Text>
        {children}
      </Row>
    </AdvancedSettings>
  );
}
