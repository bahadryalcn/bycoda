import { basename } from "node:path";
import type { Catalog, CatalogLocalFile, CatalogModel, CatalogProvider } from "./catalog";

export type CatalogFileMatch = {
  provider: CatalogProvider;
  model: CatalogModel;
  file: CatalogLocalFile;
};

/** A file the Host may download: catalog-verified, from an https URL, with a SHA256. */
export type InstallFile = {
  fileName: string;
  url: string;
  sha256: string;
  sizeBytes?: number;
};

/** Catalog file entries whose name (and size, when both sides know it) match a local file. */
export function catalogFileMatches(
  catalog: Catalog,
  fileName: string,
  sizeBytes?: number,
): CatalogFileMatch[] {
  return catalog.providers.flatMap((provider) =>
    provider.models.flatMap((model) =>
      (model.localFiles ?? [])
        .filter(
          (file) =>
            file.fileName === fileName &&
            (file.sizeBytes === undefined ||
              sizeBytes === undefined ||
              file.sizeBytes === sizeBytes),
        )
        .map((file) => ({ provider, model, file })),
    ),
  );
}

/**
 * Every local file of a model, or undefined when any one of them is not verified. A model with an
 * unverified file, no URL or no SHA256 is never downloaded ("unverified model").
 */
export function verifiedInstallFiles(model: CatalogModel): InstallFile[] | undefined {
  const files = model.localFiles ?? [];
  if (!files.length) return undefined;
  const result: InstallFile[] = [];
  for (const file of files) {
    if (!file.verified || !file.url || !file.sha256 || !isSafeFileName(file.fileName))
      return undefined;
    if (!file.url.startsWith("https://")) return undefined;
    result.push({
      fileName: file.fileName,
      url: file.url,
      sha256: file.sha256,
      ...(file.sizeBytes !== undefined ? { sizeBytes: file.sizeBytes } : {}),
    });
  }
  return result;
}

export function isSafeFileName(name: string): boolean {
  return (
    name.length > 0 &&
    name.length <= 260 &&
    name !== "." &&
    name !== ".." &&
    basename(name) === name &&
    ![...name].some((char) => char.charCodeAt(0) < 32 || '<>:"|?*\\/'.includes(char))
  );
}

/** Ports of catalog endpoints that point at this computer, e.g. the Clef proxy on 8767. */
export function localhostPortsFromCatalog(catalog: Catalog): number[] {
  const ports: number[] = [];
  for (const provider of catalog.providers) {
    if (!provider.defaultEndpoint) continue;
    let url: URL;
    try {
      url = new URL(provider.defaultEndpoint);
    } catch {
      continue;
    }
    if (!["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)) continue;
    const port = Number(url.port);
    if (Number.isInteger(port) && port > 0) ports.push(port);
  }
  return [...new Set(ports)];
}
