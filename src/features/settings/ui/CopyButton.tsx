import { useRef, useState } from "react";
import { t } from "../../../shared/i18n";
import { Button } from "../../../shared/ui/Button";
import { copyText } from "../../../platform/tauri/clipboard";

export function CopyButton({ value, label }: { value: string; label: string }) {
  const [state, setState] = useState<"idle" | "copying" | "copied" | "error">("idle");
  const pending = useRef(false);
  return (
    <>
      <Button
        loading={state === "copying"}
        onClick={async () => {
          if (pending.current) return;
          pending.current = true;
          setState("copying");
          try {
            await copyText(value);
            setState("copied");
          } catch {
            setState("error");
          } finally {
            pending.current = false;
          }
        }}
      >
        {label}
      </Button>
      <span role="status">
        {state === "copied" ? t("Copied") : state === "error" ? t("Copy failed. Try again.") : ""}
      </span>
    </>
  );
}
