import { useState } from "react";
import { t } from "../../../shared/i18n";
import { Button } from "../../../shared/ui/Button";
import type { PermissionId } from "../../../platform/tauri/systemPermissions";
import { PermissionSetupDialog } from "./PermissionSetupDialog";

export function PermissionRecoveryAction({ id }: { id: PermissionId }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button onClick={() => setOpen(true)}>{t("Review access")}</Button>
      {open && <PermissionSetupDialog id={id} onClose={() => setOpen(false)} />}
    </>
  );
}
