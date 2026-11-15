//! Warnings and errors the UI reports, written to `bycoda.log` so a failure that leaves no
//! native trace survives the window. The UI redacts each line before it sends it.
use log::Level;
use serde::Deserialize;

const BATCH_LINES: usize = 50;
const LINE_CHARS: usize = 4000;

#[derive(Deserialize)]
pub(crate) struct UiLogLine {
    level: String,
    message: String,
}

/// At most `BATCH_LINES` lines of `LINE_CHARS` characters; an unknown level is a warning.
pub(super) fn bounded(lines: Vec<UiLogLine>) -> Vec<(Level, String)> {
    lines
        .into_iter()
        .take(BATCH_LINES)
        .filter(|line| !line.message.trim().is_empty())
        .map(|line| {
            let level = if line.level == "error" {
                Level::Error
            } else {
                Level::Warn
            };
            (level, line.message.chars().take(LINE_CHARS).collect())
        })
        .collect()
}

pub(super) fn write(lines: Vec<UiLogLine>) {
    for (level, message) in bounded(lines) {
        log::log!(target: "bycoda::ui", level, "{message}");
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_batch_is_bounded_and_keeps_only_warnings_and_errors() {
        let line = |level: &str, message: String| UiLogLine {
            level: level.into(),
            message,
        };
        let mut lines = vec![
            line("error", "broken".into()),
            line("debug", "x".repeat(LINE_CHARS + 10)),
            line("warn", "  ".into()),
        ];
        lines.extend((0..BATCH_LINES).map(|index| line("warn", format!("w{index}"))));
        let kept = bounded(lines);
        assert_eq!(kept.len(), BATCH_LINES - 1);
        assert_eq!(kept[0], (Level::Error, "broken".into()));
        assert_eq!(kept[1].0, Level::Warn);
        assert_eq!(kept[1].1.chars().count(), LINE_CHARS);
    }
}
