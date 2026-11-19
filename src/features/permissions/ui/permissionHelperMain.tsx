import { createRoot } from "react-dom/client";
import { PermissionHelper } from "./PermissionHelper";
import { languageReady } from "../../../shared/i18n";
import { installNativeContextMenuGuard } from "../../../shared/lib/nativeContextMenu";
import { bootSecondaryWindowAppearance } from "../../settings/model/secondaryWindowAppearance";
import "../../../styles/index.css";

installNativeContextMenuGuard();

// Theme and control geometry only, as in the other secondary windows.
bootSecondaryWindowAppearance();

// Render after the locale resolves; a failed locale load still shows the helper.
void languageReady
  .catch(() => undefined)
  .then(() => createRoot(document.getElementById("root")!).render(<PermissionHelper />));
