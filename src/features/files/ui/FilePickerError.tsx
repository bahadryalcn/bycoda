import { useT } from "../../../shared/i18n";
import { Disclosure } from "../../../shared/ui/Disclosure";
import { LiveText } from "../../../shared/ui/LiveText";
import { InlineError } from "../../../shared/ui/InlineError";

export function FilePickerError({ error }: { error: string }) {
  const t = useT();
  const detailed = error.length > 200 || /[\r\n]/.test(error);
  if (!detailed) {
    return <InlineError className="min-w-0 flex-1 break-words">{error}</InlineError>;
  }
  const summary = error.split(/[\r\n]/, 1)[0].slice(0, 120);
  return (
    <Disclosure
      size="sm"
      className="min-w-0 flex-1 break-words text-(--ui-tone-danger-fg)"
      summary={
        // Live region inside the summary (a block InlineError is not valid there); the test reads summary [role=alert].
        <span title={t("Error details")}>
          <LiveText mode="assertive" className="line-clamp-2" text={`${summary}…`} />
        </span>
      }
    >
      <p tabIndex={0} className="max-h-24 overflow-y-auto whitespace-pre-wrap">
        {error}
      </p>
    </Disclosure>
  );
}
