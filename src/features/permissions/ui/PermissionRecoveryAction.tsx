import { useState } from "react";
import { t } from "../../../shared/i18n";
import { Button } from "../../../shared/ui/Button";
import type { PermissionId } from "../../../platform/tauri/systemPermissions";
import { PermissionSetupSheet } from "./PermissionSetupSheet";

export function PermissionRecoveryAction({ id }: { id: PermissionId }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button onClick={() => setOpen(true)}>{t("Review access")}</Button>
      {open && <PermissionSetupSheet id={id} onClose={() => setOpen(false)} />}
    </>
  );
}
