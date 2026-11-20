const home = "C:/Users/alice";
export const homeDir = async () => home;
export const statFiles = async () =>
  ["C:/", "D:/", "E:/", "F:/", "G:/", "H:/"].map((path) => ({ path, isDir: true }));
export const listDir = async (path: string) =>
  [
    ".agent-desktop",
    ".agent-device",
    ".agents",
    ...Array.from({ length: 36 }, (_, i) => `folder-${i + 1}`),
    "long-folder-name-".repeat(18),
  ].map((name) => ({ name, path: `${path}/${name}`, isDir: true }));
export const createPath = async (path: string, name: string) => `${path}/${name}`;
export const openPathWithDefaultApp = async () => {};
export const pickNativeFolders = async () => [];
export const pickFiles = async () => null;
export const listWindowsDrives = async () => ["C:/", "D:/", "E:/", "F:/", "G:/", "H:/"];
export const basename = (path: string) => {
  const trimmed = path.replaceAll("\\", "/").replace(/\/+$/, "") || "/";
  if (/^[A-Za-z]:$/.test(trimmed)) return trimmed;
  return trimmed.split("/").filter(Boolean).pop() ?? trimmed;
};
