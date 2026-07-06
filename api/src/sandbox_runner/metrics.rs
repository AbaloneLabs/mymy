use std::path::{Path, PathBuf};

use tokio::process::Command;

use super::host::command_exists;

pub(crate) async fn process_usage(pid: u32) -> (Option<f64>, Option<i64>) {
    let output = Command::new("ps")
        .arg("-p")
        .arg(pid.to_string())
        .arg("-o")
        .arg("%cpu=,rss=")
        .output()
        .await;
    let Ok(output) = output else {
        return (None, None);
    };
    if !output.status.success() {
        return (None, None);
    }
    let text = String::from_utf8_lossy(&output.stdout);
    let mut parts = text.split_whitespace();
    let cpu = parts.next().and_then(|value| value.parse::<f64>().ok());
    let memory_bytes = parts
        .next()
        .and_then(|value| value.parse::<i64>().ok())
        .map(|rss_kib| rss_kib.saturating_mul(1024));
    (cpu, memory_bytes)
}

pub(crate) async fn storage_usage(roots: &[PathBuf]) -> Option<i64> {
    let roots = roots.to_vec();
    tokio::task::spawn_blocking(move || {
        let total = roots
            .iter()
            .map(|root| directory_size(root))
            .fold(0_u64, u64::saturating_add);
        i64::try_from(total).ok()
    })
    .await
    .ok()
    .flatten()
}

fn directory_size(path: &Path) -> u64 {
    let Ok(metadata) = std::fs::symlink_metadata(path) else {
        return 0;
    };
    if metadata.is_file() {
        return metadata.len();
    }
    if !metadata.is_dir() {
        return 0;
    }
    let Ok(entries) = std::fs::read_dir(path) else {
        return 0;
    };
    entries
        .filter_map(Result::ok)
        .map(|entry| directory_size(&entry.path()))
        .fold(0_u64, u64::saturating_add)
}

pub(crate) async fn process_ports(pid: u32) -> Vec<u16> {
    if !command_exists("ss") {
        return Vec::new();
    }
    let output = Command::new("ss").arg("-ltnp").output().await;
    let Ok(output) = output else {
        return Vec::new();
    };
    if !output.status.success() {
        return Vec::new();
    }
    let pid_marker = format!("pid={pid},");
    String::from_utf8_lossy(&output.stdout)
        .lines()
        .filter(|line| line.contains(&pid_marker))
        .filter_map(|line| {
            let local = line.split_whitespace().nth(3)?;
            local.rsplit(':').next()?.parse::<u16>().ok()
        })
        .collect()
}
