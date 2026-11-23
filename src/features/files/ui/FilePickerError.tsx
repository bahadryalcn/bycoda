import { InlineError } from "../../../shared/ui/InlineError";

export function FilePickerError({ error }: { error: string }) {
  return <InlineError details={error} />;
}
