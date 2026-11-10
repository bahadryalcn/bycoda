import { useRef, useState } from "react";
import { t, useLocale } from "../../../shared/i18n";
import { TextField } from "../../../shared/ui/TextField";
import { CREW_HANDLE_PATTERN } from "../model/crewIdentity";

/**
 * The member's `@handle`. Typing is kept locally so a half-typed value never reaches the
 * draft: only a valid handle (or none) is passed on, after lowercasing and trimming.
 */
export function MemberHandleField({
  value,
  onChange,
  hostError,
}: {
  value: string | undefined;
  onChange: (handle: string | undefined) => void;
  /** A refusal from the Host, such as a handle already taken. */
  hostError?: string;
}) {
  useLocale();
  const [text, setText] = useState(value ?? "");
  const emitted = useRef(value);
  if (value !== emitted.current) {
    // The draft changed from outside (for example an update from the library).
    emitted.current = value;
    setText(value ?? "");
  }
  const normalized = text.trim().toLowerCase();
  const invalid = normalized !== "" && !CREW_HANDLE_PATTERN.test(normalized);
  return (
    <TextField
      label={t("Handle")}
      description={t("Optional. Lowercase letters, digits and hyphens, up to 24 characters.")}
      placeholder={t("e.g. ada")}
      value={text}
      maxLength={40}
      autoCapitalize="none"
      autoCorrect="off"
      spellCheck={false}
      error={
        invalid
          ? t(
              "Use 1 to 24 lowercase letters, digits or hyphens, not starting or ending with a hyphen.",
            )
          : hostError
      }
      onChange={(event) => {
        const next = event.target.value;
        setText(next);
        const handle = next.trim().toLowerCase();
        if (handle && !CREW_HANDLE_PATTERN.test(handle)) return;
        emitted.current = handle || undefined;
        onChange(handle || undefined);
      }}
    />
  );
}
