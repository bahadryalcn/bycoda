import { peekDir } from "../model/fileTree";
import { parentPath } from "../../../shared/lib/paths";

export type Creating = { id: number; parent: string; isDir: boolean };
export type Clip = {
  mode: "copy" | "cut";
  entries: { path: string; isDir: boolean }[];
  systemFiles: Promise<string[] | null>;
};
export type MenuTarget = { path: string; isDir: boolean; isRoot: boolean };
export type MenuState = { x: number; y: number; target: MenuTarget };
export type RefreshFailure = {
  cwd: string;
  touched: string[];
  forget: string[];
  message: string;
};

export function isDirAt(cwd: string, path: string): boolean {
  if (path === cwd) return true;
  return (
    peekDir(parentPath(path))?.find((entry) => entry.path === path)?.isDir ?? peekDir(path) != null
  );
}
