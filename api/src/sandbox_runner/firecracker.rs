//! Firecracker host integration helpers.
//!
//! These functions cover the Firecracker-specific host plumbing that is shared
//! by one-shot commands and long-lived preview processes: rootfs copy, tap
//! device setup, API socket calls, and deterministic guest networking.

use std::net::Ipv4Addr;
use std::path::Path;

use tokio::process::Command;
use uuid::Uuid;

use super::error::RunnerError;
use super::host::run_host_command;

pub(crate) struct Network {
    pub(crate) tap_name: String,
    pub(crate) host_ip: Ipv4Addr,
    pub(crate) guest_ip: Ipv4Addr,
}

pub(crate) async fn copy_rootfs_image(
    source: &Path,
    destination: &Path,
) -> Result<(), RunnerError> {
    let status = Command::new("cp")
        .arg("--reflink=auto")
        .arg("--sparse=always")
        .arg(source)
        .arg(destination)
        .status()
        .await;
    if status.map(|status| status.success()).unwrap_or(false) {
        return Ok(());
    }
    tokio::fs::copy(source, destination)
        .await
        .map_err(|err| RunnerError::Execution(format!("firecracker rootfs copy failed: {err}")))?;
    Ok(())
}

pub(crate) async fn setup_tap(name: &str, host_ip: Ipv4Addr) -> Result<(), RunnerError> {
    let _ = Command::new("ip")
        .arg("link")
        .arg("del")
        .arg(name)
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status()
        .await;
    let mut create = Command::new("ip");
    create
        .arg("tuntap")
        .arg("add")
        .arg("dev")
        .arg(name)
        .arg("mode")
        .arg("tap");
    run_host_command(&mut create, "tap create").await?;

    let mut address = Command::new("ip");
    address
        .arg("addr")
        .arg("add")
        .arg(format!("{host_ip}/30"))
        .arg("dev")
        .arg(name);
    run_host_command(&mut address, "tap address").await?;

    let mut enable = Command::new("ip");
    enable.arg("link").arg("set").arg(name).arg("up");
    run_host_command(&mut enable, "tap enable").await
}

pub(crate) async fn api_put(
    socket_path: &Path,
    path: &str,
    body: serde_json::Value,
) -> Result<(), RunnerError> {
    let mut command = Command::new("curl");
    command
        .arg("--silent")
        .arg("--show-error")
        .arg("--fail")
        .arg("--unix-socket")
        .arg(socket_path)
        .arg("-X")
        .arg("PUT")
        .arg(format!("http://localhost{path}"))
        .arg("-H")
        .arg("Content-Type: application/json")
        .arg("-d")
        .arg(body.to_string());
    run_host_command(&mut command, &format!("firecracker API PUT {path}")).await
}

pub(crate) fn network(id: Uuid) -> Network {
    let bytes = id.as_bytes();
    let third = bytes[0].max(1);
    let base = (bytes[1] % 62) * 4 + 1;
    Network {
        tap_name: format!("tap{}", &id.simple().to_string()[..8]),
        host_ip: Ipv4Addr::new(172, 31, third, base),
        guest_ip: Ipv4Addr::new(172, 31, third, base + 1),
    }
}

pub(crate) fn guest_mac(id: Uuid) -> String {
    let bytes = id.as_bytes();
    format!(
        "AA:FC:{:02X}:{:02X}:{:02X}:{:02X}",
        bytes[0], bytes[1], bytes[2], bytes[3]
    )
}
