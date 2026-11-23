import type { ReactNode } from "react";
import { terminalText } from "../../../shared/lib/terminalText";
import { prettyCwd, projectKey } from "../../../shared/lib/paths";
import { useLocale } from "../../../shared/i18n";
import { Folder, MessageSquare } from "../../../shared/ui/icons";
import { MatchText, matchPositions } from "../../../shared/ui/MatchText";
import { projectDisplayNameFrom } from "../../projects/model/projectNames";
import { useTabGroupLogos } from "../../projects/public/useTabGroupLogos";
import { ProjectLogoIcon } from "../../projects/ui/ProjectLogoIcon";
import { FileTypeIcon } from "../../files/ui/FileTypeIcon";
import { HarnessIcon } from "../../sessions/ui/HarnessIcon";
import { useResolvedTabGroupLogo } from "../../workspace/public/tabGroups";
import type { AppSearchHit } from "../model/appSearch";

export function rowCopy(
  hit: AppSearchHit,
  query: string,
  labels: Record<string, string>,
): { icon: ReactNode; title: ReactNode; meta: string; preview?: ReactNode } {
  if (hit.kind === "conversation") {
    return {
      icon: <HarnessIcon harness={hit.harness} className="icon-sm" />,
      title: <MatchText {...terminalText(hit.title, hit.positions)} active />,
      meta: projectDisplayNameFrom(hit.cwd, labels),
    };
  }
  if (hit.kind === "message") {
    return {
      icon: <MessageSquare className="icon-sm" tone="secondary" strokeWidth={1.75} />,
      title: terminalText(hit.title).text,
      preview: <Highlight text={hit.preview || hit.title} query={query} />,
      meta: projectDisplayNameFrom(hit.cwd, labels),
    };
  }
  if (hit.kind === "file") {
    return {
      icon: <FileTypeIcon name={hit.name} isDir={false} size="md" />,
      title: <MatchText text={hit.name} positions={namePositions(hit)} active />,
      meta: hit.path,
    };
  }
  if (hit.kind === "content") {
    return {
      icon: <FileTypeIcon name={hit.name} isDir={false} size="md" />,
      title: hit.name,
      preview: <Highlight text={hit.preview} query={query} />,
      meta: `${hit.path}:${hit.line}:${hit.column}`,
    };
  }
  return {
    icon: <SearchProjectIcon path={hit.path} />,
    title: <MatchText text={hit.name} positions={hit.positions} active />,
    meta: prettyCwd(hit.path),
  };
}

function SearchProjectIcon({ path }: { path: string }) {
  const logos = useTabGroupLogos();
  const logo = useResolvedTabGroupLogo(projectKey(path), logos);
  return <ProjectLogoIcon path={logo} className="icon-sm" fallback={Folder} />;
}

function Highlight({ text, query }: { text: string; query: string }) {
  useLocale();
  const clean = terminalText(text).text;
  const positions = matchPositions(clean, terminalText(query).text);
  return <MatchText text={clean} positions={positions} active={positions.length > 0} />;
}

function namePositions(hit: { name: string; relative: string; positions: number[] }) {
  const offset = Math.max(0, hit.relative.length - hit.name.length);
  return hit.positions
    .map((index) => index - offset)
    .filter((index) => index >= 0 && index < hit.name.length);
}
