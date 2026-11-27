import { WorkingIndicator, type WorkingIndicatorSize } from "../../../shared/ui/WorkingIndicator";

/**
 * Compatibility adapter for existing conversation and navigation consumers. It keeps the
 * shared working signal (the animated bars owned by WorkingIndicator, which is a "the
 * agent is working" status rather than a plain pending glyph) and forwards `size`.
 */
export function TerminalSpinner({
  className,
  size,
}: {
  className?: string;
  size?: WorkingIndicatorSize;
}) {
  return <WorkingIndicator className={className} size={size} />;
}
