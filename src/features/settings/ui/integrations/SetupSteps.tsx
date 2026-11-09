import type { ReactNode } from "react";
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
        <ol className="integration-steps text-ui-caption text-(--ui-text-secondary)">
          {steps.map((step, index) => (
            <li key={index}>{step}</li>
          ))}
        </ol>
        {children}
      </Row>
    </AdvancedSettings>
  );
}
