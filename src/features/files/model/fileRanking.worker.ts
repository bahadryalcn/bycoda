import type { ProjectFile } from "../../../platform/tauri/fs";
import { rankProjectFiles } from "./rankProjectFiles";

export type FileRankingMessage = { files?: ProjectFile[]; query: string; recents: string[] };

let files: ProjectFile[] = [];
self.onmessage = ({ data }: MessageEvent<FileRankingMessage>) => {
  if (data.files) files = data.files;
  self.postMessage(rankProjectFiles(files, data.query, data.recents));
};
