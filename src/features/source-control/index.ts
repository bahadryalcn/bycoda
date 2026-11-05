/** Public types and optional surface loaders. Runtime contracts are declared below. */
export type { GitStatusMap } from "./hooks/useGitFileStatuses";
export type { ConflictBlock, ConflictSide } from "./model/conflictMarkers";
export type { UnifiedBlock, UnifiedLine } from "./model/unifiedDiff";
export type { RemoveWorktree, Worktree } from "./model/worktrees";
export type { DiffCommentComposerTarget } from "./ui/DiffCommentComposer";
export {
  loadCommitDiff,
  loadSessionChangesDiff,
  loadWorkingTreeDiff,
} from "./model/publicSurfaces";
export type * as hooksUseGitFileStatusesApi from "./public/useGitFileStatuses";
export type * as hooksUseProjectBranchesApi from "./public/useProjectBranches";
export type * as hooksUseProjectDiffStatsApi from "./public/useProjectDiffStats";
export type * as modelBlameMappingApi from "./public/blameMapping";
export type * as modelConflictMarkersApi from "./public/conflictMarkers";
export type * as modelConflictSectionApi from "./public/conflictSection";
export type * as modelDiffHighlightSourceApi from "./public/diffHighlightSource";
export type * as modelDiffWorkerApi from "./public/diffWorker";
export type * as modelGitGenerationPreferencesApi from "./public/gitGenerationPreferences";
export type * as modelGitGraphDisplayApi from "./public/gitGraphDisplay";
export type * as modelMergeResolutionApi from "./public/mergeResolution";
export type * as modelSelectiveStageApi from "./public/selectiveStage";
export type * as modelWorktreeFocusApi from "./public/worktreeFocus";
export type * as modelWorktreesApi from "./public/worktrees";
export type * as uiBranchPickerApi from "./public/BranchPicker";
export type * as uiConflictLayoutApi from "./public/ConflictLayout";
export type * as uiDiffCommentComposerApi from "./public/DiffCommentComposer";
export type * as uiDiffLayoutToggleApi from "./public/DiffLayoutToggle";
export type * as uiGitFileInspectorApi from "./public/GitFileInspector";
export type * as uiGitGenerationSettingsApi from "./public/GitGenerationSettings";
export type * as uiMergeConflictEditorApi from "./public/MergeConflictEditor";
export type * as uiWorktreePickerApi from "./public/WorktreePicker";
export type * as uiWorktreesPageApi from "./public/WorktreesPage";
