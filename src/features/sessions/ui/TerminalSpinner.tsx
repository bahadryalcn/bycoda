import { WorkingIndicator } from "../../../shared/ui/WorkingIndicator";

/** Compatibility adapter for existing conversation and navigation consumers. */
export function TerminalSpinner({
  className = "inline-block w-3.5 select-none text-center text-ui-micro leading-none",
}: {
  className?: string;
}) {
  return <WorkingIndicator className={className} />;
}
