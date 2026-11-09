/** Public sessions contract; exports stay explicit to preserve load isolation. */
export { useAutoSettleSetting } from "../hooks/useSessionLifecycle";
export { AUTO_ARCHIVE_DAY_OPTIONS, AUTO_SETTLE_DAY_OPTIONS } from "../model/sessionLifecycle";
