/** Lucide glyphs behind bycoda's existing action and accessibility contracts. */
import { forwardRef, useId } from "react";
import {
  AlertCircle as LucideAlertCircle,
  AppWindow as LucideAppWindow,
  Archive as LucideArchive,
  ArrowDown as LucideArrowDown,
  ArrowDownCircle as LucideArrowDownCircle,
  ArrowLeft as LucideArrowLeft,
  ArrowUp as LucideArrowUp,
  Quote as LucideBlockQuote,
  Bold as LucideBold,
  Bot as LucideBot,
  ListChecks as LucideCheckList,
  SquareCode as LucideCodeBlock,
  Heading as LucideHeading,
  Italic as LucideItalic,
  Link as LucideLink,
  ListOrdered as LucideListNumbered,
  Lightbulb as LucideAiIdea,
  CaseSensitive as LucideCaseSensitive,
  MessageSquareText as LucideChatting,
  Check as LucideCheck,
  CheckCheck as LucideCheckCheck,
  CheckCircle as LucideCheckCircle,
  ChevronDown as LucideChevronDown,
  ChevronLeft as LucideChevronLeft,
  ChevronRight as LucideChevronRight,
  CornerDownRight as LucideCornerDownRight,
  ChevronUp as LucideChevronUp,
  ChevronsUpDown as LucideChevronsUpDown,
  CircleAlert as LucideCircleAlert,
  CircleDashed as LucideCircleDashed,
  CircleDot as LucideCircleDot,
  CircleHelp as LucideCircleHelp,
  Info as LucideInfo,
  CircleX as LucideCircleX,
  CloudUpload as LucideCloudUpload,
  Clock as LucideClock,
  Copy as LucideCopy,
  MousePointer2 as LucideCursorMagicSelection,
  LayoutDashboard as LucideDashboardSquare,
  ExternalLink as LucideExternalLink,
  File as LucideFile,
  FileDiff as LucideFileDiff,
  FilePlus as LucideFilePlus,
  FilePlusCorner as LucideFilePlusCorner,
  FileCode as LucideFileScript,
  FoldVertical as LucideFoldVertical,
  Folder as LucideFolder,
  FolderOpen as LucideFolderOpen,
  Eye as LucideEye,
  EyeOff as LucideEyeOff,
  FolderPlus as LucideFolderPlus,
  FolderTree as LucideFolderTree,
  Gauge as LucideGauge,
  ChartNoAxesCombined as LucideChartBreakoutSquare,
  GitBranch as LucideGitBranch,
  GitCompare as LucideGitCompare,
  GitMerge as LucideGitMerge,
  GitPullRequest as LucideGitPullRequest,
  GitPullRequestClosed as LucideGitPullRequestClosed,
  GitPullRequestDraft as LucideGitPullRequestDraft,
  GripVertical as LucideGripVertical,
  Globe as LucideGlobe,
  Globe as LucideInternet,
  ImagePlus as LucideImagePlus,
  Inbox as LucideInbox,
  BellOff as LucideBellOff,
  Keyboard as LucideKeyboard,
  List as LucideListBullet,
  ListEnd as LucideListEnd,
  ListFilter as LucideListFilter,
  Loader as LucideLoader,
  LoaderCircle as LucideLoaderCircle,
  Lock as LucideLock,
  LockOpen as LucideLockOpen,
  Maximize2 as LucideMaximize2,
  Minimize2 as LucideMinimize2,
  MessagesSquare as LucideMessageMultiple,
  MessageSquare as LucideMessageSquare,
  MessageSquarePlus as LucideMessageSquarePlus,
  Minus as LucideMinus,
  Strikethrough as LucideStrikethrough,
  Table as LucideTable,
  MoreHorizontal as LucideMoreHorizontal,
  Palette as LucidePalette,
  Pause as LucidePause,
  PanelBottom as LucidePanelBottom,
  PanelLeft as LucidePanelLeft,
  PanelRight as LucidePanelRight,
  PanelTop as LucidePanelTop,
  PenLine as LucidePenLine,
  Pencil as LucidePencil,
  Pin as LucidePin,
  PinOff as LucidePinOff,
  Play as LucidePlay,
  Pipette as LucidePipette,
  Plus as LucidePlus,
  RefreshCw as LucideRefreshCw,
  Regex as LucideRegex,
  Replace as LucideReplace,
  RotateCcw as LucideRotateCcw,
  Save as LucideSave,
  Search as LucideSearch,
  Settings as LucideSettings,
  Share as LucideShare,
  Shield as LucideShield,
  SlidersHorizontal as LucideSlidersHorizontal,
  Sparkles as LucideSparkles,
  Square as LucideSquare,
  Columns2 as LucideSplitSquare,
  SquarePlus as LucideSquarePlus,
  Star as LucideStar,
  StickyNote as LucideStickyNote,
  Terminal as LucideTerminal,
  Server as LucideServer,
  Trash2 as LucideTrash2,
  Undo2 as LucideUndo2,
  UnfoldVertical as LucideUnfoldVertical,
  Ungroup as LucideUngroup,
  WandSparkles as LucideWandSparkles,
  WholeWord as LucideWholeWord,
  Wrench as LucideWrench,
  X as LucideX,
  Zap as LucideZap,
  type LucideIcon,
  type LucideProps,
} from "lucide-react";

export type IconProps = LucideProps & { title?: string };
export type IconComponent = ReturnType<typeof wrap>;

function wrap(Icon: LucideIcon, name: string) {
  const Component = forwardRef<SVGSVGElement, IconProps>(function BycodaIcon(
    { size = 24, strokeWidth = 2, title, children, ...props },
    ref,
  ) {
    const id = useId();
    const labeled = Boolean(title || props["aria-label"] || props["aria-labelledby"]);
    return (
      <Icon
        ref={ref}
        size={size}
        strokeWidth={strokeWidth}
        role={labeled ? "img" : undefined}
        aria-hidden={labeled ? undefined : true}
        aria-labelledby={title && !props["aria-label"] ? id : undefined}
        {...props}
      >
        {title ? <title id={id}>{title}</title> : null}
        {children}
      </Icon>
    );
  });
  Component.displayName = name;
  return Component;
}

export const AlertCircle = wrap(LucideAlertCircle, "AlertCircle");
export const AppWindow = wrap(LucideAppWindow, "AppWindow");
export const Archive = wrap(LucideArchive, "Archive");
export const ArrowDownCircle = wrap(LucideArrowDownCircle, "ArrowDownCircle");
export const ArrowDown = wrap(LucideArrowDown, "ArrowDown");
export const ArrowLeft = wrap(LucideArrowLeft, "ArrowLeft");
export const ArrowUp = wrap(LucideArrowUp, "ArrowUp");
export const BlockQuote = wrap(LucideBlockQuote, "BlockQuote");
export const Bold = wrap(LucideBold, "Bold");
export const Bot = wrap(LucideBot, "Bot");
export const CheckList = wrap(LucideCheckList, "CheckList");
export const CodeBlock = wrap(LucideCodeBlock, "CodeBlock");
export const Heading = wrap(LucideHeading, "Heading");
export const Italic = wrap(LucideItalic, "Italic");
export const Link = wrap(LucideLink, "Link");
export const ListNumbered = wrap(LucideListNumbered, "ListNumbered");
export const AiIdea = wrap(LucideAiIdea, "AiIdea");
export const CaseSensitive = wrap(LucideCaseSensitive, "CaseSensitive");
export const Chatting = wrap(LucideChatting, "Chatting");
export const Check = wrap(LucideCheck, "Check");
export const CheckCheck = wrap(LucideCheckCheck, "CheckCheck");
export const CheckCircle = wrap(LucideCheckCircle, "CheckCircle");
export const ChevronDown = wrap(LucideChevronDown, "ChevronDown");
export const ChevronLeft = wrap(LucideChevronLeft, "ChevronLeft");
export const ChevronRight = wrap(LucideChevronRight, "ChevronRight");
export const CornerDownRight = wrap(LucideCornerDownRight, "CornerDownRight");
export const ChevronUp = wrap(LucideChevronUp, "ChevronUp");
export const ChevronsUpDown = wrap(LucideChevronsUpDown, "ChevronsUpDown");
export const CircleAlert = wrap(LucideCircleAlert, "CircleAlert");
export const CircleDashed = wrap(LucideCircleDashed, "CircleDashed");
export const CircleDot = wrap(LucideCircleDot, "CircleDot");
export const CircleHelp = wrap(LucideCircleHelp, "CircleHelp");
export const Info = wrap(LucideInfo, "Info");
export const CircleX = wrap(LucideCircleX, "CircleX");
export const CloudUpload = wrap(LucideCloudUpload, "CloudUpload");
export const Clock = wrap(LucideClock, "Clock");
export const Copy = wrap(LucideCopy, "Copy");
export const CursorMagicSelection = wrap(LucideCursorMagicSelection, "CursorMagicSelection");
export const DashboardSquare = wrap(LucideDashboardSquare, "DashboardSquare");
export const ExternalLink = wrap(LucideExternalLink, "ExternalLink");
export const File = wrap(LucideFile, "File");
export const FileDiff = wrap(LucideFileDiff, "FileDiff");
export const FilePlus = wrap(LucideFilePlus, "FilePlus");
export const FilePlusCorner = wrap(LucideFilePlusCorner, "FilePlusCorner");
export const FileScript = wrap(LucideFileScript, "FileScript");
export const FoldVertical = wrap(LucideFoldVertical, "FoldVertical");
export const Folder = wrap(LucideFolder, "Folder");
export const FolderOpen = wrap(LucideFolderOpen, "FolderOpen");
export const Eye = wrap(LucideEye, "Eye");
export const EyeOff = wrap(LucideEyeOff, "EyeOff");
export const FolderPlus = wrap(LucideFolderPlus, "FolderPlus");
export const FolderTree = wrap(LucideFolderTree, "FolderTree");
export const Gauge = wrap(LucideGauge, "Gauge");
export const ChartBreakoutSquare = wrap(LucideChartBreakoutSquare, "ChartBreakoutSquare");
export const GitBranch = wrap(LucideGitBranch, "GitBranch");
export const GitCompare = wrap(LucideGitCompare, "GitCompare");
export const GitMerge = wrap(LucideGitMerge, "GitMerge");
export const GitPullRequest = wrap(LucideGitPullRequest, "GitPullRequest");
export const GitPullRequestClosed = wrap(LucideGitPullRequestClosed, "GitPullRequestClosed");
export const GitPullRequestDraft = wrap(LucideGitPullRequestDraft, "GitPullRequestDraft");
export const GripVertical = wrap(LucideGripVertical, "GripVertical");
export const Globe = wrap(LucideGlobe, "Globe");
export const Internet = wrap(LucideInternet, "Internet");
export const ImagePlus = wrap(LucideImagePlus, "ImagePlus");
export const Inbox = wrap(LucideInbox, "Inbox");
export const BellOff = wrap(LucideBellOff, "BellOff");
export const Keyboard = wrap(LucideKeyboard, "Keyboard");
export const ListBullet = wrap(LucideListBullet, "ListBullet");
export const ListEnd = wrap(LucideListEnd, "ListEnd");
export const ListFilter = wrap(LucideListFilter, "ListFilter");
export const Loader = wrap(LucideLoader, "Loader");
export const LoaderCircle = wrap(LucideLoaderCircle, "LoaderCircle");
export const Lock = wrap(LucideLock, "Lock");
export const LockOpen = wrap(LucideLockOpen, "LockOpen");
export const Maximize2 = wrap(LucideMaximize2, "Maximize2");
export const Minimize2 = wrap(LucideMinimize2, "Minimize2");
export const MessageMultiple = wrap(LucideMessageMultiple, "MessageMultiple");
export const MessageSquare = wrap(LucideMessageSquare, "MessageSquare");
export const MessageSquarePlus = wrap(LucideMessageSquarePlus, "MessageSquarePlus");
export const Minus = wrap(LucideMinus, "Minus");
export const Strikethrough = wrap(LucideStrikethrough, "Strikethrough");
export const Table = wrap(LucideTable, "Table");
export const MoreHorizontal = wrap(LucideMoreHorizontal, "MoreHorizontal");
export const Palette = wrap(LucidePalette, "Palette");
export const Pause = wrap(LucidePause, "Pause");
export const PanelBottom = wrap(LucidePanelBottom, "PanelBottom");
export const PanelLeft = wrap(LucidePanelLeft, "PanelLeft");
export const PanelRight = wrap(LucidePanelRight, "PanelRight");
export const PanelTop = wrap(LucidePanelTop, "PanelTop");
export const PenLine = wrap(LucidePenLine, "PenLine");
export const Pencil = wrap(LucidePencil, "Pencil");
export const Pin = wrap(LucidePin, "Pin");
export const PinOff = wrap(LucidePinOff, "PinOff");
export const Play = wrap(LucidePlay, "Play");
export const Pipette = wrap(LucidePipette, "Pipette");
export const Plus = wrap(LucidePlus, "Plus");
export const RefreshCw = wrap(LucideRefreshCw, "RefreshCw");
export const Regex = wrap(LucideRegex, "Regex");
export const Replace = wrap(LucideReplace, "Replace");
export const RotateCcw = wrap(LucideRotateCcw, "RotateCcw");
export const Save = wrap(LucideSave, "Save");
export const Search = wrap(LucideSearch, "Search");
export const Settings = wrap(LucideSettings, "Settings");
export const Share = wrap(LucideShare, "Share");
export const Shield = wrap(LucideShield, "Shield");
export const SlidersHorizontal = wrap(LucideSlidersHorizontal, "SlidersHorizontal");
export const Sparkles = wrap(LucideSparkles, "Sparkles");
export const Square = wrap(LucideSquare, "Square");
export const SplitSquare = wrap(LucideSplitSquare, "SplitSquare");
export const SquarePlus = wrap(LucideSquarePlus, "SquarePlus");
export const Star = wrap(LucideStar, "Star");
export const StickyNote = wrap(LucideStickyNote, "StickyNote");
export const Terminal = wrap(LucideTerminal, "Terminal");
export const Server = wrap(LucideServer, "Server");
export const Trash2 = wrap(LucideTrash2, "Trash2");
export const Undo2 = wrap(LucideUndo2, "Undo2");
export const UnfoldVertical = wrap(LucideUnfoldVertical, "UnfoldVertical");
export const Ungroup = wrap(LucideUngroup, "Ungroup");
export const WandSparkles = wrap(LucideWandSparkles, "WandSparkles");
export const WholeWord = wrap(LucideWholeWord, "WholeWord");
export const Wrench = wrap(LucideWrench, "Wrench");
export const X = wrap(LucideX, "X");
export const Zap = wrap(LucideZap, "Zap");
