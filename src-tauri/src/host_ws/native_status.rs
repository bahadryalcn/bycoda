pub(super) fn is_status(method: &str) -> bool {
    matches!(method, "native.services.desktop.status" | "native.services.desktop.status.wait")
}
