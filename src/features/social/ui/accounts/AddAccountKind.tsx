import { t } from "../../../../shared/i18n";
import { SegmentedControl } from "../../../../shared/ui/SegmentedControl";

export type AddAccountKindProps = {
  kind: "account" | "email";
  /** Only the other kind triggers it; the dialog swaps its content, the Modal frame stays the same. */
  onChange(kind: "account" | "email"): void;
  disabled?: boolean;
};

/** The first choice of every add-account dialog: a social account or a sending email account. */
export function AddAccountKind({ kind, onChange, disabled }: AddAccountKindProps) {
  return (
    <SegmentedControl
      label={t("Account kind")}
      value={kind}
      options={[
        { value: "account", label: t("Social account"), disabled },
        { value: "email", label: t("Email account"), disabled },
      ]}
      onValueChange={(value) => {
        const next = value === "email" ? "email" : "account";
        if (next !== kind) onChange(next);
      }}
    />
  );
}
