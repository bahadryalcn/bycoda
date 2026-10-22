import { useEffect, useRef, useState } from "react";
import { browseDirectory, revealPath } from "../../../platform/tauri/fs";
import { localExplorerPath } from "../../../shared/lib/remoteExplorerPaths";
import { REMOTE_PATH_PREFIX } from "../../../shared/lib/remotePaths";
import type { OpenFileFn } from "../../search/model/search";
import { ChatFolderBrowser } from "./ChatFolderBrowser";

/** Every remote reveal entry point can configure its local share in place. */
export function useRemoteFolderBrowser(onOpenFile?: OpenFileFn) {
  const [folder, setFolder] = useState<string>();
  const request = useRef(0);
  useEffect(
    () => () => {
      request.current++;
    },
    [],
  );
  const revealInFileManager = async (path: string) => {
    const current = ++request.current;
    if (path.startsWith(REMOTE_PATH_PREFIX) && !localExplorerPath(path)) {
      const listing = await browseDirectory(path, true);
      if (request.current === current) setFolder(listing.path);
      return;
    }
    await revealPath(path);
  };
  return {
    revealInFileManager,
    folderBrowser: folder ? (
      <ChatFolderBrowser
        key={folder}
        path={folder}
        onOpenFile={onOpenFile}
        onClose={() => setFolder(undefined)}
        revealOnOpen
      />
    ) : null,
  };
}
