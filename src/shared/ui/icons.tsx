/** bycoda's original chrome family; exported names preserve existing action contracts. */
import { forwardRef, useId, type SVGProps } from "react";
import { BYCODA_ICON_PATHS, type BycodaIconName } from "./bycodaIconCatalog";

export type IconProps = SVGProps<SVGSVGElement> & {
  size?: number | string;
  title?: string;
  absoluteStrokeWidth?: boolean;
};
export type IconComponent = ReturnType<typeof wrap>;
function wrap(name: BycodaIconName) {
  const Component = forwardRef<SVGSVGElement, IconProps>(function BycodaIcon(
    { size = 24, strokeWidth = 1.65, title, absoluteStrokeWidth, children, ...props },
    ref,
  ) {
    const id = useId();
    const labeled = Boolean(title || props["aria-label"] || props["aria-labelledby"]);
    return (
      <svg
        ref={ref}
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
        role={labeled ? "img" : undefined}
        aria-hidden={labeled ? undefined : true}
        aria-labelledby={title && !props["aria-label"] ? id : undefined}
        {...props}
      >
        {title ? <title id={id}>{title}</title> : null}
        {BYCODA_ICON_PATHS[name].map((d, index) => (
          <path
            key={index}
            d={d}
            vectorEffect={absoluteStrokeWidth ? "non-scaling-stroke" : undefined}
          />
        ))}
        {children}
      </svg>
    );
  });
  Component.displayName = name;
  return Component;
}
export const AlertCircle = wrap("AlertCircle");
export const AppWindow = wrap("AppWindow");
export const Archive = wrap("Archive");
export const ArrowDownCircle = wrap("ArrowDownCircle");
export const ArrowLeft = wrap("ArrowLeft");
export const ArrowUp = wrap("ArrowUp");
export const BlockQuote = wrap("BlockQuote");
export const Bold = wrap("Bold");
export const Bot = wrap("Bot");
export const CheckList = wrap("CheckList");
export const CodeBlock = wrap("CodeBlock");
export const Heading = wrap("Heading");
export const Italic = wrap("Italic");
export const Link = wrap("Link");
export const ListNumbered = wrap("ListNumbered");
export const AiIdea = wrap("AiIdea");
export const CaseSensitive = wrap("CaseSensitive");
export const Chatting = wrap("Chatting");
export const Check = wrap("Check");
export const CheckCheck = wrap("CheckCheck");
export const CheckCircle = wrap("CheckCircle");
export const ChevronDown = wrap("ChevronDown");
export const ChevronLeft = wrap("ChevronLeft");
export const ChevronRight = wrap("ChevronRight");
export const CornerDownRight = wrap("CornerDownRight");
export const ChevronUp = wrap("ChevronUp");
export const ChevronsUpDown = wrap("ChevronsUpDown");
export const CircleAlert = wrap("CircleAlert");
export const CircleDashed = wrap("CircleDashed");
export const CircleDot = wrap("CircleDot");
export const CircleHelp = wrap("CircleHelp");
export const CircleX = wrap("CircleX");
export const CloudUpload = wrap("CloudUpload");
export const Clock = wrap("Clock");
export const Copy = wrap("Copy");
export const CursorMagicSelection = wrap("CursorMagicSelection");
export const DashboardSquare = wrap("DashboardSquare");
export const ExternalLink = wrap("ExternalLink");
export const File = wrap("File");
export const FileDiff = wrap("FileDiff");
export const FilePlus = wrap("FilePlus");
export const FilePlusCorner = wrap("FilePlusCorner");
export const FileScript = wrap("FileScript");
export const FoldVertical = wrap("FoldVertical");
export const Folder = wrap("Folder");
export const FolderOpen = wrap("FolderOpen");
export const Eye = wrap("Eye");
export const EyeOff = wrap("EyeOff");
export const FolderPlus = wrap("FolderPlus");
export const FolderTree = wrap("FolderTree");
export const Gauge = wrap("Gauge");
export const ChartBreakoutSquare = wrap("ChartBreakoutSquare");
export const GitBranch = wrap("GitBranch");
export const GitCompare = wrap("GitCompare");
export const GitMerge = wrap("GitMerge");
export const GitPullRequest = wrap("GitPullRequest");
export const GitPullRequestClosed = wrap("GitPullRequestClosed");
export const GitPullRequestDraft = wrap("GitPullRequestDraft");
export const GripVertical = wrap("GripVertical");
export const Globe = wrap("Globe");
export const Internet = wrap("Internet");
export const ImagePlus = wrap("ImagePlus");
export const Inbox = wrap("Inbox");
export const BellOff = wrap("BellOff");
export const Keyboard = wrap("Keyboard");
export const ListBullet = wrap("ListBullet");
export const ListEnd = wrap("ListEnd");
export const ListFilter = wrap("ListFilter");
export const Loader = wrap("Loader");
export const LoaderCircle = wrap("LoaderCircle");
export const Lock = wrap("Lock");
export const LockOpen = wrap("LockOpen");
export const Maximize2 = wrap("Maximize2");
export const Minimize2 = wrap("Minimize2");
export const MessageMultiple = wrap("MessageMultiple");
export const MessageSquare = wrap("MessageSquare");
export const MessageSquarePlus = wrap("MessageSquarePlus");
export const Minus = wrap("Minus");
export const Strikethrough = wrap("Strikethrough");
export const Table = wrap("Table");
export const MoreHorizontal = wrap("MoreHorizontal");
export const Palette = wrap("Palette");
export const Pause = wrap("Pause");
export const PanelBottom = wrap("PanelBottom");
export const PanelLeft = wrap("PanelLeft");
export const PanelRight = wrap("PanelRight");
export const PanelTop = wrap("PanelTop");
export const PenLine = wrap("PenLine");
export const Pencil = wrap("Pencil");
export const Pin = wrap("Pin");
export const PinOff = wrap("PinOff");
export const Play = wrap("Play");
export const Pipette = wrap("Pipette");
export const Plus = wrap("Plus");
export const RefreshCw = wrap("RefreshCw");
export const Regex = wrap("Regex");
export const Replace = wrap("Replace");
export const RotateCcw = wrap("RotateCcw");
export const Search = wrap("Search");
export const Settings = wrap("Settings");
export const Share = wrap("Share");
export const Shield = wrap("Shield");
export const SlidersHorizontal = wrap("SlidersHorizontal");
export const Sparkles = wrap("Sparkles");
export const Square = wrap("Square");
export const SplitSquare = wrap("SplitSquare");
export const SquarePlus = wrap("SquarePlus");
export const Star = wrap("Star");
export const StickyNote = wrap("StickyNote");
export const Terminal = wrap("Terminal");
export const Trash2 = wrap("Trash2");
export const Undo2 = wrap("Undo2");
export const UnfoldVertical = wrap("UnfoldVertical");
export const Ungroup = wrap("Ungroup");
export const WandSparkles = wrap("WandSparkles");
export const WholeWord = wrap("WholeWord");
export const Wrench = wrap("Wrench");
export const X = wrap("X");
export const Zap = wrap("Zap");
