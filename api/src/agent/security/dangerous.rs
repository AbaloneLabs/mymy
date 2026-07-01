//! Dangerous command detection.
//!
//! Phase 8 keeps the first policy conservative: catastrophic commands are
//! blocked outright and dangerous commands are refused until an interactive
//! approval queue is attached to the web UI. Harmless terminal commands can be
//! enabled without giving the model a path to irreversible operations.

use regex::Regex;
use std::sync::OnceLock;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Severity {
    Hardline,
    Dangerous,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DangerousMatch {
    pub pattern_key: String,
    pub description: String,
    pub severity: Severity,
}

struct Pattern {
    key: &'static str,
    description: &'static str,
    severity: Severity,
    regex: Regex,
}

const HARDLINE_PATTERNS: &[(&str, &str, &str)] = &[
    (
        "root_delete",
        r"\brm\s+(-[^\s]*\s+)*/(\s|$)",
        "recursive delete of root filesystem",
    ),
    (
        "system_dir_delete",
        r"\brm\s+(-[^\s]*\s+)*(/home|/root|/etc|/usr|/var|/bin|/boot)(\s|$)",
        "delete of system directory",
    ),
    ("format_filesystem", r"\bmkfs\b", "format filesystem"),
    (
        "raw_device_write",
        r"\bdd\b.*\bof=/dev/(sd|nvme|vd|xvd)",
        "write directly to a block device",
    ),
    (
        "fork_bomb",
        r":\(\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;\s*:",
        "fork bomb",
    ),
    (
        "kill_all",
        r"\bkill\s+(-[^\s]+\s+)*-1\b",
        "kill all processes",
    ),
    (
        "system_power",
        r"\b(shutdown|reboot|halt|poweroff)\b",
        "system shutdown or reboot",
    ),
];

const DANGEROUS_PATTERNS: &[(&str, &str, &str)] = &[
    ("recursive_delete", r"\brm\s+-[^\s]*r", "recursive delete"),
    (
        "delete_root_path",
        r"\brm\s+(-[^\s]*\s+)*/",
        "delete in root path",
    ),
    (
        "world_writable",
        r"\bchmod\s+.*777\b",
        "world-writable permissions",
    ),
    (
        "sql_drop",
        r"\bDROP\s+(TABLE|DATABASE)\b",
        "SQL DROP operation",
    ),
    ("sql_truncate", r"\bTRUNCATE\b", "SQL TRUNCATE operation"),
    (
        "service_lifecycle",
        r"\bsystemctl\s+(stop|restart|disable)\b",
        "system service lifecycle change",
    ),
    (
        "force_kill",
        r"\b(pkill|kill)\s+-9\b",
        "force kill processes",
    ),
    (
        "pipe_remote_shell",
        r"\b(curl|wget)\b.*\|\s*(ba)?sh",
        "pipe remote content to shell",
    ),
    ("xargs_rm", r"\bxargs\s+.*\brm\b", "xargs with rm"),
    ("find_delete", r"\bfind\b.*-delete\b", "find -delete"),
    ("find_exec_rm", r"\bfind\b.*-exec\s+rm\b", "find -exec rm"),
    (
        "docker_lifecycle",
        r"\bdocker\s+(compose\s+)?(restart|stop|kill|down)\b",
        "Docker lifecycle change",
    ),
    (
        "env_overwrite",
        r">\s*\.env\b|\btee\b.*\.env\b",
        "write to .env",
    ),
    (
        "ssh_write",
        r">\s*.*/\.ssh/|\btee\b.*\.ssh/",
        "write to SSH directory",
    ),
    (
        "env_read",
        r"\b(cat|less|more|head|tail|sed|awk|grep)\b.*(?:^|/)\.env(?:\.|\b)",
        "read from environment credential file",
    ),
    (
        "credential_read",
        r"\b(cat|less|more|head|tail|sed|awk|grep)\b.*(?:auth\.json|auth\.lock|google_oauth\.json|\.netrc|\.pgpass|\.npmrc|\.pypirc|\.git-credentials)",
        "read from credential file",
    ),
    (
        "ssh_read",
        r"\b(cat|less|more|head|tail|sed|awk|grep)\b.*(?:/\.ssh/|id_rsa|id_ed25519|authorized_keys)",
        "read from SSH credential path",
    ),
];

pub fn detect_dangerous_command(command: &str) -> Option<DangerousMatch> {
    if detects_delete_without_where(command) {
        return Some(DangerousMatch {
            pattern_key: "sql_delete_without_where".to_string(),
            description: "SQL DELETE without WHERE".to_string(),
            severity: Severity::Dangerous,
        });
    }

    for pattern in compiled_patterns() {
        if pattern.regex.is_match(command) {
            return Some(DangerousMatch {
                pattern_key: pattern.key.to_string(),
                description: pattern.description.to_string(),
                severity: pattern.severity,
            });
        }
    }
    None
}

fn detects_delete_without_where(command: &str) -> bool {
    command
        .lines()
        .map(str::to_ascii_lowercase)
        .any(|line| line.contains("delete from") && !line.contains(" where "))
}

fn compiled_patterns() -> &'static [Pattern] {
    static PATTERNS: OnceLock<Vec<Pattern>> = OnceLock::new();
    PATTERNS
        .get_or_init(|| {
            HARDLINE_PATTERNS
                .iter()
                .map(|(key, regex, description)| Pattern {
                    key,
                    description,
                    severity: Severity::Hardline,
                    regex: Regex::new(&format!("(?i){regex}")).expect("hardline regex compiles"),
                })
                .chain(
                    DANGEROUS_PATTERNS
                        .iter()
                        .map(|(key, regex, description)| Pattern {
                            key,
                            description,
                            severity: Severity::Dangerous,
                            regex: Regex::new(&format!("(?i){regex}"))
                                .expect("dangerous regex compiles"),
                        }),
                )
                .collect()
        })
        .as_slice()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detects_hardline_root_delete() {
        let matched = detect_dangerous_command("rm -rf /").unwrap();
        assert_eq!(matched.severity, Severity::Hardline);
        assert_eq!(matched.pattern_key, "root_delete");
    }

    #[test]
    fn detects_dangerous_recursive_delete() {
        let matched = detect_dangerous_command("rm -rf target/tmp").unwrap();
        assert_eq!(matched.severity, Severity::Dangerous);
    }

    #[test]
    fn safe_command_is_allowed() {
        assert!(detect_dangerous_command("printf hello").is_none());
    }
}
