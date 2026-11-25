import { useState } from "react";
import { openExternal } from "../../../../platform/tauri/openExternal";
import { t } from "../../../../shared/i18n";
import { Button } from "../../../../shared/ui/Button";
import { useConfirm } from "../../../../shared/ui/ConfirmDialog";
import { Disclosure } from "../../../../shared/ui/Disclosure";
import { FieldGroup } from "../../../../shared/ui/FieldGroup";
import { InlineError } from "../../../../shared/ui/InlineError";
import { SectionLabel } from "../../../../shared/ui/SectionLabel";
import { Select } from "../../../../shared/ui/Select";
import { Text } from "../../../../shared/ui/Text";
import { TextareaField } from "../../../../shared/ui/TextareaField";
import type { SocialAccount } from "../../model/social";
import type { SocialClient } from "../../model/socialClient";
import { useAccountWrite } from "../accounts/useAccountWrite";
import { LinkedInHandoff } from "./LinkedInHandoff";
import "./linkedin.css";
import { linkedInBusyReason } from "./linkedinReasons";

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
  const { failureTitle, details, is, write } = useAccountWrite(t("Could not save changes."));
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
      <div className="social-li-stack">
        {member ? (
          <FieldGroup variant="bare" disabled={disabled || busy}>
            <div className="social-li-toolbar">
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
                variant={before?.section === section ? "secondary" : "primary"}
                size="sm"
                loading={is("read")}
                onClick={() => void read().catch(() => undefined)}
              >
                {t("Read")}
              </Button>
            </div>
            {before?.section === section ? (
              <>
                <TextareaField
                  label={sections.find((item) => item.value === section)?.label ?? t("Profile")}
                  value={value}
                  onChange={(event) => setValue(event.target.value)}
                />
                <Button
                  variant="primary"
                  size="sm"
                  className="self-start"
                  disabled={blocked || before.value === value}
                  disabledReason={
                    blocked
                      ? t("Read the profile again before saving.")
                      : t("Change the text first.")
                  }
                  loading={is("save")}
                  onClick={() => void save().catch(() => undefined)}
                >
                  {t("Save")}
                </Button>
              </>
            ) : (
              <Text as="p" size="secondary" tone="muted">
                {t("Read your headline or About text to edit it here.")}
              </Text>
            )}
          </FieldGroup>
        ) : null}
        <div className="social-li-group">
          <SectionLabel variant="inline" size="secondary" as="h4">
            {t("Open on LinkedIn")}
          </SectionLabel>
          <Text as="p" size="secondary" tone="muted">
            {t(
              "LinkedIn only lets you change these in the browser. MonoCode opens the exact page.",
            )}
          </Text>
          <ul className="social-li-list">
            {[
              { section: "photo", label: t("Photo"), hint: t("Change your profile photo.") },
              { section: "banner", label: t("Banner"), hint: t("Change the banner image.") },
              ...(member
                ? [
                    {
                      section: "experience",
                      label: t("Experience"),
                      hint: t("Add or edit your jobs and education."),
                    },
                    {
                      section: "links",
                      label: t("Links"),
                      hint: t("Edit the links on your profile."),
                    },
                  ]
                : [
                    {
                      section: "details",
                      label: t("Page details"),
                      hint: t("Edit your Page's name, website and description."),
                    },
                  ]),
              {
                section: "services",
                label: t("Services"),
                hint: t("Edit the services you offer."),
              },
            ].map((item) => (
              <LinkedInHandoff
                key={item.section}
                title={item.label}
                description={item.hint}
                action={t("Open")}
                ariaLabel={t("Open {p0} on LinkedIn", { p0: item.label })}
                disabled={disabled || busy}
                disabledReason={linkedInBusyReason(disabled)}
                onOpen={() => void open(item.section).catch(() => undefined)}
              />
            ))}
          </ul>
        </div>
        {failureTitle ? <InlineError details={details}>{failureTitle}</InlineError> : null}
      </div>
      {confirm.dialog}
    </Disclosure>
  );
}
