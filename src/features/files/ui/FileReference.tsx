import { Children, useEffect, useState, type ReactNode } from "react";
import { chatPathInfo } from "../model/chatPathChecks";
import { FileTypeIcon } from "./FileTypeIcon";
import { fileReferenceKind, splitFileLocation } from "../../../shared/lib/fileReferenceKind";

/** Class and kind attribute that give a link or inline code the file reference chip (file-references.css). */
export function fileReferenceChip(name: string, isDir: boolean) {
  return { className: "file-ref", "data-file-kind": fileReferenceKind(name, isDir) } as const;
}

/**
 * The inside of a file reference chip: the file-type icon (a folder icon for a directory), the
 * label, and a trailing line location (`:711`, `#L13`) shown quieter as " · L711". Both the link
 * and the inline code form render it, so a reference looks the same either way.
 */
export function FileReferenceBody({
  name,
  isDir,
  children,
}: {
  /** File or folder name the icon is chosen by. */
  name: string;
  isDir: boolean;
  children: ReactNode;
}) {
  const parts = Children.toArray(children);
  const text = parts.every((part) => typeof part === "string") ? parts.join("") : undefined;
  const split = text === undefined ? undefined : splitFileLocation(text);
  return (
    <>
      <span aria-hidden="true" className="file-ref-icon">
        <FileTypeIcon name={name} isDir={isDir} size="sm" />
      </span>
      {split?.location ? (
        <>
          <span className="file-ref-label">{split.name}</span>
          <span className="file-ref-location">
            <span aria-hidden="true">{"· "}</span>
            {split.location}
          </span>
        </>
      ) : (
        <span className="file-ref-label">{children}</span>
      )}
    </>
  );
}

/**
 * Whether a path is a folder, learned from the file system when the text alone cannot say
 * (a trailing slash says it). Unverified paths read as files.
 */
export function useChatPathIsDirectory(path: string | undefined, enabled: boolean): boolean {
  const [dir, setDir] = useState<{ path: string; isDir: boolean }>();
  // oxlint-disable-next-line bycoda/effect-names-its-sync -- keeps one batched, cached file system stat in step with the mounted path; unmount drops the answer
  useEffect(() => {
    if (!path || !enabled) return;
    let cancelled = false;
    void chatPathInfo(path)
      .then((info) => {
        if (!cancelled) setDir({ path, isDir: info.isDir });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [path, enabled]);
  return enabled && !!dir && dir.path === path && dir.isDir;
}
