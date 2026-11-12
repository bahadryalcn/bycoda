import { InlineError } from "../../../../../shared/ui/InlineError";
import { surfaceAttributes } from "../../../../../shared/ui/Surface";
import { useState } from "react";
import { t } from "../../../../../shared/i18n";
import { Button } from "../../../../../shared/ui/Button";
import { Heading } from "../../../../../shared/ui/Heading";

import { TextareaField } from "../../../../../shared/ui/TextareaField";
import { Text } from "../../../../../shared/ui/Text";
import { TextField } from "../../../../../shared/ui/TextField";
import { DisabledReason, gateProps, type ActionGate } from "../../common/DisabledReason";
import type { XProfilePatch, XProfileState } from "../../../model/socialBrowser";
import type { SocialClient } from "../../../model/socialClient";
import { useAccountWrite } from "../useAccountWrite";
import "../accounts.css";

export type XProfileEditorProps = {
  client: SocialClient;
  accountId: string;
  accountName: string;
};

type TextFieldName = "name" | "bio" | "location" | "website";

const HANDLE = /^[A-Za-z0-9_]{1,15}$/;

/** The public X profile fields and the follow action. Reads happen on request, never on open. */
export function XProfileEditor({ client, accountId, accountName }: XProfileEditorProps) {
  const [saved, setSaved] = useState<XProfileState>();
  const [values, setValues] = useState<XProfileState>();
  const [handle, setHandle] = useState("");
  const [followed, setFollowed] = useState<{ handle: string; following: boolean }>();
  const { error, is, write } = useAccountWrite(
    t("The profile could not be verified. Read the profile again before saving."),
  );

  const patch: XProfilePatch = {};
  if (saved && values)
    for (const field of ["name", "bio", "location", "website"] as TextFieldName[])
      if (saved[field] !== values[field]) patch[field] = values[field];
  const changed = Object.keys(patch).length > 0;
  const saveGate: ActionGate = !values
    ? { disabled: true, disabledReason: t("Read the profile first.") }
    : !values.name.trim()
      ? { disabled: true, disabledReason: t("Enter a profile name.") }
      : !changed
        ? { disabled: true, disabledReason: t("No changes to save.") }
        : { disabled: false };
  const followGate: ActionGate = HANDLE.test(handle)
    ? { disabled: false }
    : {
        disabled: true,
        disabledReason: t("Enter an X username of 1 to 15 letters, digits or underscores."),
      };

  const read = () =>
    void write("read", async () => {
      const profile = await client.xProfileRead(accountId);
      setSaved(profile);
      setValues(profile);
    }).catch(() => undefined);
  const save = () =>
    void write("save", () => client.xProfileUpdate(accountId, patch))
      .then((profile) => {
        if (!profile) return;
        setSaved(profile);
        setValues(profile);
      })
      .catch(() => undefined);
  const follow = () =>
    void write("follow", () => client.xProfileFollow(accountId, handle))
      .then((result) => {
        if (result) setFollowed({ handle: result.handle, following: result.following });
      })
      .catch(() => undefined);

  const field = (name: TextFieldName, label: string, max: number) => (
    <TextField
      key={name}
      label={label}
      maxLength={max}
      value={values?.[name] ?? ""}
      disabled={!values || is("save")}
      onChange={(event) => {
        const next = event.currentTarget.value;
        setValues((current) => current && { ...current, [name]: next });
      }}
    />
  );

  return (
    <section
      {...surfaceAttributes({ frame: "settings", edge: "block-start" }, "social-card")}
      aria-label={t("X profile")}
    >
      <Heading size="item">{t("X profile and following")}</Heading>
      <Text as="p" tone="muted" leading="snug" className="social-muted">
        {t("Public profile fields of {p1}.", { p1: accountName })}
      </Text>
      <Button
        variant="secondary"
        size="sm"
        loading={is("read")}
        disabled={is("read")}
        onClick={read}
      >
        {t("Read profile")}
      </Button>
      {values ? (
        <form
          {...surfaceAttributes({ frame: "settings", edge: "block-start" }, "social-card")}
          onSubmit={(event) => {
            event.preventDefault();
            if (!saveGate.disabled) save();
          }}
        >
          {field("name", t("Profile name"), 50)}
          <TextareaField
            label={t("About")}
            maxLength={160}
            value={values.bio}
            disabled={is("save")}
            onChange={(event) => {
              const next = event.currentTarget.value;
              setValues((current) => current && { ...current, bio: next });
            }}
          />
          {field("location", t("Location"), 30)}
          {field("website", t("Website"), 100)}
          <DisabledReason
            type="submit"
            variant="primary"
            size="sm"
            loading={is("save")}
            {...gateProps(saveGate)}
          >
            {t("Save profile")}
          </DisabledReason>
        </form>
      ) : null}
      <div className="social-field-row">
        <TextField
          label={t("X username to follow")}
          value={handle}
          maxLength={16}
          placeholder="@username"
          disabled={is("follow")}
          onChange={(event) => setHandle(event.currentTarget.value.replace(/^@/, ""))}
        />
        <DisabledReason
          variant="secondary"
          size="sm"
          loading={is("follow")}
          onClick={follow}
          {...gateProps(followGate)}
        >
          {t("Follow")}
        </DisabledReason>
      </div>
      {followed ? (
        <Text as="p" tone="muted" leading="snug" className="social-muted">
          {followed.following
            ? t("Following @{p1}", { p1: followed.handle })
            : t("Not following @{p1}", { p1: followed.handle })}
        </Text>
      ) : null}
      {error ? (
        <InlineError retry={{ onRetry: read, label: t("Read profile") }}>{error}</InlineError>
      ) : null}
    </section>
  );
}
