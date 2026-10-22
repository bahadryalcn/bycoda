import { Stepper as ArcStepper, type StepperProps } from "./arc/stepper/stepper";

export type {
  StepperProps,
  StepperStep,
  StepperStatus,
  StepperOrientation,
} from "./arc/stepper/stepper";

/** Public workflow adapter; content and completion state stay with the consumer. */
export function Stepper(props: StepperProps) {
  return <ArcStepper {...props} />;
}

export default Stepper;
