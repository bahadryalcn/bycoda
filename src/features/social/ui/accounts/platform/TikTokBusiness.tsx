import { useState } from "react";
import { useT } from "../../../../../shared/i18n";
import { Button } from "../../../../../shared/ui/Button";
import { useConfirm } from "../../../../../shared/ui/ConfirmDialog";
import { InlineError, InlineMessage } from "../../../../../shared/ui/InlineError";
import { SectionLabel } from "../../../../../shared/ui/SectionLabel";
import { Text } from "../../../../../shared/ui/Text";
import { TextField } from "../../../../../shared/ui/TextField";
import { useAccountWrite } from "../useAccountWrite";
import type { TikTokPanelProps } from "./TikTokAccountTools";
import "./tiktok.css";

export type TikTokBusinessStatus = { approved: boolean; connected: boolean };

export function TikTokBusiness({
  client,
  accountId,
  disabled,
  status,
  onChanged,
}: TikTokPanelProps & {
  status?: TikTokBusinessStatus;
  onChanged(status: TikTokBusinessStatus): void;
}) {
  const t = useT();
  const { write, is, error, details } = useAccountWrite(
    t("Could not connect TikTok for Business."),
  );
  const confirmation = useConfirm();
  const [businessId, setBusinessId] = useState("");
  const busy = is("check") || is("connect");
  const check = async () => {
    const next = await write("check", () =>
      client.request<TikTokBusinessStatus>("tiktok.business.status", {
        accountId,
      }),
    );
    if (next) onChanged(next);
  };
  return (
    <div className="tiktok-panel">
      <div className="tiktok-head">
        <SectionLabel as="h3">{t("TikTok for Business")}</SectionLabel>
        <Button
          size="sm"
          variant="secondary"
          disabled={disabled || busy}
          loading={is("check")}
          onClick={() => check().catch(() => undefined)}
        >
          {t("Check Business API access")}
        </Button>
      </div>
      {!status && !busy && !error && (
        <Text size="caption" tone="secondary">
          {t("Check access to see whether this Host can connect TikTok for Business.")}
        </Text>
      )}
      {status && !status.approved && (
        <InlineMessage tone="info">
          {t("TikTok Business API access unavailable on this Host.")}
        </InlineMessage>
      )}
      {status?.connected && (
        <InlineMessage tone="success">{t("TikTok Business API connected.")}</InlineMessage>
      )}
      {status?.approved && (
        <form
          className="tiktok-panel"
          onSubmit={(event) => {
            event.preventDefault();
            if (disabled || busy) return;
            const form = event.currentTarget;
            const token = new FormData(form).get("tiktokAccessToken");
            if (typeof token !== "string" || !token) return;
            form.reset();
            confirmation
              .confirm({
                title: t("Connect TikTok for Business"),
                message: t("Connect these credentials to the selected TikTok account?"),
                context: businessId,
                confirmLabel: t("Connect"),
                danger: false,
                onConfirm: async () => {
                  const result = await write("connect", () =>
                    client.request<{ connected: boolean }>("tiktok.business.connect", {
                      accountId,
                      businessId,
                      accessToken: token,
                      confirm: true,
                    }),
                  );
                  if (result?.connected) {
                    onChanged({ approved: true, connected: true });
                    setBusinessId("");
                  }
                },
              })
              .catch(() => undefined);
          }}
        >
          <div className="tiktok-grid">
            <TextField
              label={t("TikTok Business ID")}
              value={businessId}
              disabled={disabled || busy}
              required
              maxLength={300}
              onChange={(event) => setBusinessId(event.currentTarget.value)}
            />
            <TextField
              label={t("Access token")}
              type="password"
              name="tiktokAccessToken"
              required
              maxLength={4096}
              autoComplete="off"
              disabled={disabled || busy}
            />
          </div>
          <div className="tiktok-actions">
            <Button
              size="sm"
              type="submit"
              variant="primary"
              disabled={disabled || busy || !businessId}
              loading={is("connect")}
            >
              {t("Connect TikTok for Business")}
            </Button>
          </div>
        </form>
      )}
      {error && <InlineError details={details}>{error}</InlineError>}
      {confirmation.dialog}
    </div>
  );
}
