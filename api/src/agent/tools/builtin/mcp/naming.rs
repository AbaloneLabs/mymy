pub(super) fn prefixed_tool_name(server_name: &str, tool_name: &str) -> String {
    let server = identifier_part(server_name);
    let tool = identifier_part(tool_name);
    let name = format!("{server}_{tool}");
    if name
        .chars()
        .next()
        .is_some_and(|ch| ch.is_ascii_alphabetic() || ch == '_')
    {
        name
    } else {
        format!("mcp_{name}")
    }
}

fn identifier_part(value: &str) -> String {
    let mut out = String::new();
    let mut previous_underscore = false;
    for ch in value.chars() {
        if ch.is_ascii_alphanumeric() {
            out.push(ch.to_ascii_lowercase());
            previous_underscore = false;
        } else if !previous_underscore && !out.is_empty() {
            out.push('_');
            previous_underscore = true;
        }
    }
    let out = out.trim_matches('_').to_string();
    if out.is_empty() {
        "mcp".to_string()
    } else {
        out
    }
}
