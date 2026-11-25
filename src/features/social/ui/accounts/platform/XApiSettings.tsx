import { t } from "../../../../../shared/i18n";
import { Button } from "../../../../../shared/ui/Button";
import { InlineError } from "../../../../../shared/ui/InlineError";
import { Select } from "../../../../../shared/ui/Select";
import { Text } from "../../../../../shared/ui/Text";
import { openExternal } from "../../../../../platform/tauri/openExternal";
import type { SocialAccount } from "../../../model/social";
import type { SocialClient } from "../../../model/socialClient";
import { useAccountWrite } from "../useAccountWrite";
import "./x.css";

export function XApiSettings({
  account,
  client,
  disabled,
  onChanged,
}: {
  account: SocialAccount;
  client: SocialClient;
  disabled: boolean;
  onChanged(): void;
}) {
  const { error, details, is, write } = useAccountWrite(
    t("The connection could not be started. Try again."),
  );
  return (
    <div className="social-x-group">
      <Select
        label={t("X API billing")}
        value={account.xApiProduct ?? "off"}
        options={[
          { value: "off", label: t("Off") },
          { value: "pay-per-use", label: t("Pay per use") },
          { value: "enterprise", label: "Enterprise" },
        ]}
        disabled={disabled || is("product")}
        onValueChange={(product) =>
          void write("product", async () => {
            await client.request("x.api.setProduct", {
              accountId: account.id,
              product: product === "off" ? null : product,
            });
            onChanged();
          })
        }
      />
      <Text as="p" size="caption" tone="secondary">
        {t(
          "X charges per returned item and per write. A post costs $0.015, or $0.20 with a link. Enterprise uses your X agreement.",
        )}
      </Text>
      <Button
        variant="link"
        className="self-start"
        onClick={() =>
          void write("pricing", () =>
            openExternal("https://docs.x.com/x-api/getting-started/pricing"),
          )
        }
      >
        {t("X API pricing")}
      </Button>
      {error ? <InlineError details={details}>{error}</InlineError> : null}
    </div>
  );
}
