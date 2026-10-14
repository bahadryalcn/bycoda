import {
  useCallback,
  useRef,
  useState,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react";
import type { InstalledUpdate } from "../../model/updateNotice";

export interface UpdateNoticesDeps {
  installedUpdate: InstalledUpdate | null;
}

export interface UpdateNotices {
  updateNotice: InstalledUpdate | null;
  onDismissUpdate: () => void;
  whatsNewVersion: string | null;
  setWhatsNewVersion: Dispatch<SetStateAction<string | null>>;
  whatsNewVersionRef: MutableRefObject<string | null>;
  onOpenWhatsNew: (version: string) => void;
}

// Installed-update banner and the what's-new dialog version. Called where the
// update-notice state used to be declared.
export function useUpdateNotices({ installedUpdate }: UpdateNoticesDeps): UpdateNotices {
  const [updateNotice, setUpdateNotice] = useState(installedUpdate);
  const [whatsNewVersion, setWhatsNewVersion] = useState<string | null>(null);
  const whatsNewVersionRef = useRef(whatsNewVersion);
  whatsNewVersionRef.current = whatsNewVersion;

  const onDismissUpdate = useCallback(() => setUpdateNotice(null), []);
  const onOpenWhatsNew = useCallback((version: string) => {
    setWhatsNewVersion(version.trim());
  }, []);

  return {
    updateNotice,
    onDismissUpdate,
    whatsNewVersion,
    setWhatsNewVersion,
    whatsNewVersionRef,
    onOpenWhatsNew,
  };
}
