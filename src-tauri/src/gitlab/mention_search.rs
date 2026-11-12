use super::*;

fn query_suffix(search: &str) -> Result<String, String> {
    if search.len() > 200 || search.chars().any(char::is_control) {
        return Err("Invalid GitLab search".into());
    }
    if search.chars().all(|c| c.is_ascii_digit()) && !search.is_empty() {
        let number: u64 = search.parse().map_err(|_| "Invalid GitLab number")?;
        if number == 0 || number > i32::MAX as u64 {
            return Err("Invalid GitLab number".into());
        }
        // Bound the batch to the best 100 numeric prefix candidates, without 100 HTTP reads.
        let mut ids = vec![number];
        let mut width = 10_u64;
        while ids.len() < 100 && number * width <= i32::MAX as u64 {
            for id in number * width..(number * width + width).min(i32::MAX as u64 + 1) {
                ids.push(id);
                if ids.len() == 100 {
                    break;
                }
            }
            width *= 10;
        }
        return Ok(ids.iter().map(|id| format!("&iids[]={id}")).collect());
    }
    Ok(format!("&search={}", encode_path_component(search)))
}

pub(super) fn search_items(
    config: &GitlabConfig,
    repo: &str,
    kind: &str,
    search: &str,
    limit: u32,
) -> Result<Vec<GitlabWorkItem>, String> {
    validate_kind(kind)?;
    let path = format!(
        "/projects/{}/{}?scope=all&state=opened&per_page={}&order_by=updated_at&sort=desc{}",
        encode_path_component(repo),
        resource_for_kind(kind),
        limit.clamp(1, 100),
        query_suffix(search)?
    );
    parse_work_items(&gitlab_get(config, &path)?.value, kind, repo)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn encodes_text_and_batches_numeric_prefixes() {
        assert_eq!(
            query_suffix("login & bug").unwrap(),
            "&search=login%20%26%20bug"
        );
        let suffix = query_suffix("14").unwrap();
        assert!(suffix.starts_with("&iids[]=14&iids[]=140&iids[]=141"));
        assert_eq!(suffix.matches("&iids[]=").count(), 100);
        assert!(query_suffix("0").is_err());
        assert!(query_suffix("x\n").is_err());
    }
}
