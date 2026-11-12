use serde_json::{json, Value};

pub(super) fn search_filter(search: &str, exact: bool) -> Result<Value, String> {
    let search = search.trim();
    if search.len() > 200 || search.chars().any(char::is_control) {
        return Err("Invalid Linear search".into());
    }
    let mut alternatives = vec![json!({ "title": { "containsIgnoreCase": search } })];
    let (team, digits) = search
        .rsplit_once('-')
        .map(|(team, digits)| (Some(team), digits))
        .unwrap_or((None, search));
    if !digits.is_empty() && digits.chars().all(|c| c.is_ascii_digit()) {
        let mut start: u64 = digits.parse().map_err(|_| "Invalid Linear number")?;
        let mut width = 1_u64;
        if exact {
            alternatives.clear();
        }
        while start > 0 && start <= i32::MAX as u64 {
            let mut filter = json!({ "number": { "gte": start, "lte": (start + width - 1).min(i32::MAX as u64) } });
            if let Some(team) = team {
                filter["team"] = json!({ "key": { "eqIgnoreCase": team } });
            }
            alternatives.push(filter);
            if exact {
                break;
            }
            start *= 10;
            width *= 10;
        }
    }
    Ok(json!({ "or": alternatives }))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn searches_title_and_identifier_number_ranges() {
        let filter = search_filter("eng-9", false).unwrap();
        assert_eq!(filter["or"][1]["number"], json!({ "gte": 9, "lte": 9 }));
        assert_eq!(filter["or"][2]["number"], json!({ "gte": 90, "lte": 99 }));
        assert_eq!(filter["or"][1]["team"]["key"]["eqIgnoreCase"], "eng");
        assert_eq!(
            search_filter("9", true).unwrap()["or"]
                .as_array()
                .unwrap()
                .len(),
            1
        );
        assert!(search_filter("bad\nquery", false).is_err());
    }
}
