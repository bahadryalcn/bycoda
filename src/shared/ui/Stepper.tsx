import { Stepper as ArcStepper, type StepperProps } from "./arc/stepper/stepper";

export type {
  StepperProps,
  StepperStep,
  StepperStatus,
  StepperOrientation,
} from "./arc/stepper/stepper";

/**
 * Ordered step indicator for a multi-step flow. Renders the steps and their status; the consumer owns step
 * content, validation and completion state.
 * @group navigation
 * @use A real ordered onboarding or configuration wizard with validation and recovery.
 * @avoid Switching between views: Tabs. A single running task's progress: Progress.
 * @arc stepper
 */
export function Stepper(props: StepperProps) {
  return <ArcStepper {...props} />;
}

export default Stepper;
