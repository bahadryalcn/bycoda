import { useState } from "react";
import { openExternal } from "../../../../platform/tauri/openExternal";
import { t } from "../../../../shared/i18n";
import { Button } from "../../../../shared/ui/Button";
import { useConfirm } from "../../../../shared/ui/ConfirmDialog";
import { Disclosure } from "../../../../shared/ui/Disclosure";
import { FieldGroup } from "../../../../shared/ui/FieldGroup";
import { InlineError } from "../../../../shared/ui/InlineError";
import { Select } from "../../../../shared/ui/Select";
import { TextareaField } from "../../../../shared/ui/TextareaField";
import type { SocialAccount } from "../../model/social";
import type { SocialClient } from "../../model/socialClient";
import { useAccountWrite } from "../accounts/useAccountWrite";

type Section = "headline" | "about";
type ProfileValue = { section: Section; value: string };

export function LinkedInBrowserProfile({
  account,
  client,
  disabled,
}: {
  account: SocialAccount;
  client: SocialClient;
  disabled: boolean;
}) {
  const [section, setSection] = useState<Section>("headline");
  const [before, setBefore] = useState<ProfileValue>();
  const [value, setValue] = useState("");
  const [blocked, setBlocked] = useState(false);
  const { error, is, write } = useAccountWrite(t("Could not save changes."));
  const confirm = useConfirm();
  const member = account.accountType === "member" && account.connection === "browser";
  const page = account.accountType === "organization";
  if (!member && !page) return null;
  const busy = is("read") || is("save") || is("open");
  const sections = [
    { value: "headline", label: t("Headline") },
    { value: "about", label: t("About") },
  ];
  const read = () =>
    write("read", async () => {
      const result = await client.linkedInBrowserManage<ProfileValue>(account.id, {
        operation: "member.read",
        section,
      });
      setBefore(result);
      setValue(result.value);
      setBlocked(false);
    });
  const save = async () => {
    if (!before || before.section !== section || blocked) return;
    await confirm.confirm({
      title: sections.find((item) => item.value === section)?.label ?? t("Profile"),
      message: [account.name, value].join("\n"),
      confirmLabel: t("Save"),
      onConfirm: async () => {
        setBlocked(true);
        await write("save", async () => {
          const result = await client.linkedInBrowserManage<ProfileValue>(account.id, {
            operation: "member.update",
            patch: { section, expectedValue: before.value, value },
            confirm: "CONFIRM_LINKEDIN_BROWSER_WRITE",
            requestId: crypto.randomUUID(),
          });
          setBefore(result);
          setValue(result.value);
          setBlocked(false);
        });
      },
    });
  };
  const open = (section: string) =>
    write("open", async () => {
      const result = await client.linkedInBrowserManage<{ url: string }>(account.id, {
        operation: "profile.destination",
        section,
      });
      await openExternal(result.url);
    });
  return (
    <Disclosure summary={t("Profile")} variant="row">
      <FieldGroup variant="bare" disabled={disabled || busy}>
        {member ? (
          <>
            <Select
              label={t("Profile")}
              value={section}
              options={sections}
              onValueChange={(next) => {
                setSection(next === "about" ? "about" : "headline");
                setBefore(undefined);
              }}
            />
            <Button
              variant="secondary"
              size="sm"
              loading={is("read")}
              onClick={() => void read().catch(() => undefined)}
            >
              {t("Read")}
            </Button>
            {before?.section === section ? (
              <>
                <TextareaField
                  label={sections.find((item) => item.value === section)?.label ?? t("Profile")}
                  value={value}
                  onChange={(event) => setValue(event.target.value)}
                />
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={blocked || before.value === value}
                  loading={is("save")}
                  onClick={() => void save().catch(() => undefined)}
                >
                  {t("Save")}
                </Button>
              </>
            ) : null}
          </>
        ) : null}
        <FieldGroup legend={t("Open on LinkedIn")} layout="row">
          {[
            { section: "photo", label: t("Photo") },
            { section: "banner", label: t("Banner") },
            ...(member
              ? [
                  { section: "experience", label: t("Experience") },
                  { section: "links", label: t("Links") },
                ]
              : [{ section: "details", label: t("Page details") }]),
            { section: "services", label: t("Services") },
          ].map((item) => (
            <Button
              key={item.section}
              variant="secondary"
              size="sm"
              onClick={() => void open(item.section).catch(() => undefined)}
            >
              {item.label}
            </Button>
          ))}
        </FieldGroup>
      </FieldGroup>
      {error ? <InlineError>{error}</InlineError> : null}
      {confirm.dialog}
    </Disclosure>
  );
}
