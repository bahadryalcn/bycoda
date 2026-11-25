import type { ProjectFile } from "../../../platform/tauri/fs";
import { rankMentionCandidates, rankProjectFiles } from "./rankProjectFiles";

export type FileRankingMessage = {
  files?: ProjectFile[];
  query: string;
  recents: string[];
  limit?: number;
  mentions?: boolean;
};

let files: ProjectFile[] = [];
self.onmessage = ({ data }: MessageEvent<FileRankingMessage>) => {
  if (data.files) files = data.files;
  const rank = data.mentions ? rankMentionCandidates : rankProjectFiles;
  self.postMessage(rank(files, data.query, data.recents, data.limit));
};
