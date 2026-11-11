import { DetailedInlineError } from "../../../shared/ui/ErrorDetails";

export function FilePickerError({ error }: { error: string }) {
  return <DetailedInlineError className="min-w-0 flex-1 break-words" error={error} />;
}
