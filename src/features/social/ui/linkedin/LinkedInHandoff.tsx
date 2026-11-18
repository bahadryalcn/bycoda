import { Button } from "../../../../shared/ui/Button";
import { Surface } from "../../../../shared/ui/Surface";
import { Text } from "../../../../shared/ui/Text";
import "./linkedin.css";

/**
 * A step LinkedIn only allows in the browser: what happens there in one line and one button that
 * opens the exact page. Render rows inside `ul.social-li-list`.
 */
export function LinkedInHandoff({
  title,
  description,
  action,
  ariaLabel,
  loading,
  disabled,
  onOpen,
}: {
  title?: string;
  description: string;
  /** Button label. */
  action: string;
  ariaLabel?: string;
  loading?: boolean;
  disabled?: boolean;
  onOpen(): void;
}) {
  return (
    <Surface as="li" variant="card" padding="sm" className="social-li-handoff">
      <div className="social-li-handoff-text">
        {title ? (
          <Text as="span" weight="medium">
            {title}
          </Text>
        ) : null}
        <Text as="span" size="secondary" tone={title ? "muted" : "primary"}>
          {description}
        </Text>
      </div>
      <Button
        size="sm"
        variant="secondary"
        aria-label={ariaLabel}
        loading={loading}
        disabled={disabled}
        onClick={onOpen}
      >
        {action}
      </Button>
    </Surface>
  );
}
