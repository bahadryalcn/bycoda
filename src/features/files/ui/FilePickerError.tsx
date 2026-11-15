import { InlineError } from "../../../shared/ui/InlineError";

export function FilePickerError({ error }: { error: string }) {
  return <InlineError className="min-w-0 flex-1 break-words" details={error} />;
}
