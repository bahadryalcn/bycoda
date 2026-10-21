import { convertFileSrc } from "@tauri-apps/api/core";
import type { DesktopProjectDirectory } from "../../connections/model/protocol";
import {
  MAX_DIRECTORY_LOGO_LENGTH,
  MAX_PROJECT_LOGO_LENGTH,
} from "../../connections/model/projectAppearance";
import { projectKey } from "../../../shared/lib/paths";
import {
  loadTabGroupLogos,
  resolveTabGroupLogo,
  tabGroupLogoDisplayRevision,
} from "../../workspace/model/tabGroups";

type Preview = { value?: string; pending: boolean; retryAt: number };
const previews = new Map<string, Preview>();
let pending = 0;

/** Rasterizes local logos (including SVG) without exposing filesystem URLs to phones. */
export function renderMobileProjectLogo(path: string): Promise<string | undefined> {
  return new Promise((resolve) => {
    const image = new Image();
    image.crossOrigin = "anonymous";
    const finish = (value?: string) => {
      clearTimeout(timeout);
      image.onload = null;
      image.onerror = null;
      resolve(value);
    };
    const timeout = setTimeout(() => finish(), 3000);
    image.onload = () => {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = canvas.height = 64;
        const context = canvas.getContext("2d");
        if (!context || !image.naturalWidth || !image.naturalHeight) return finish();
        // Desktop logos use object-cover in a square identity slot.
        const size = Math.min(image.naturalWidth, image.naturalHeight);
        context.drawImage(
          image,
          (image.naturalWidth - size) / 2,
          (image.naturalHeight - size) / 2,
          size,
          size,
          0,
          0,
          64,
          64,
        );
        const value = canvas.toDataURL("image/png");
        finish(value.length <= MAX_PROJECT_LOGO_LENGTH ? value : undefined);
      } catch {
        finish(); // Unreadable logos retain the configured color/symbol fallback.
      }
    };
    image.onerror = () => finish();
    image.src = `${convertFileSrc(path)}?v=${tabGroupLogoDisplayRevision()}`;
  });
}

/** Thumbnail work never delays session heartbeats. Ready previews go out on the next tick. */
export function withMobileProjectLogos(
  directory: DesktopProjectDirectory,
  render = renderMobileProjectLogo,
): DesktopProjectDirectory {
  const logos = loadTabGroupLogos();
  const revision = tabGroupLogoDisplayRevision();
  const visibleKeys = new Set<string>();
  let budget = MAX_DIRECTORY_LOGO_LENGTH;
  const projects = directory.projects.map((project) => {
    const path = resolveTabGroupLogo(projectKey(project.cwd), logos);
    if (!path) return project;
    const key = `${revision}:${path}`;
    visibleKeys.add(key);
    let preview = previews.get(key);
    if (
      (!preview || (!preview.pending && !preview.value && preview.retryAt <= Date.now())) &&
      pending < 4
    ) {
      preview = { pending: true, retryAt: 0 };
      previews.set(key, preview);
      const entry = preview;
      pending += 1;
      void Promise.resolve()
        .then(() => render(path))
        .then(
          (value) => {
            entry.value = value;
          },
          () => {},
        )
        .finally(() => {
          entry.pending = false;
          entry.retryAt = Date.now() + 30_000;
          pending -= 1;
        });
    }
    if (!preview?.value || preview.value.length > budget) return project;
    budget -= preview.value.length;
    return { ...project, appearance: { ...project.appearance, logo: preview.value } };
  });
  for (const key of previews.keys()) if (!visibleKeys.has(key)) previews.delete(key);
  return { ...directory, projects };
}
