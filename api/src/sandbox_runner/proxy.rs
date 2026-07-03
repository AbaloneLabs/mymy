//! Preview port proxy for Firecracker guests.
//!
//! The browser can only reach the runner container/host, not the guest's private
//! tap-network address. The proxy keeps the public preview URL stable while
//! forwarding raw TCP traffic to the per-process microVM.

use std::net::Ipv4Addr;

use tokio::io::{copy_bidirectional, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::watch;
use uuid::Uuid;

use super::error::RunnerError;

pub(crate) async fn start_port_proxy(
    id: Uuid,
    port: u16,
    guest_ip: Ipv4Addr,
) -> Result<watch::Sender<bool>, RunnerError> {
    let listener = TcpListener::bind(("0.0.0.0", port))
        .await
        .map_err(|err| RunnerError::Execution(format!("preview port {port} bind failed: {err}")))?;
    let (shutdown, mut shutdown_rx) = watch::channel(false);
    tokio::spawn(async move {
        loop {
            tokio::select! {
                changed = shutdown_rx.changed() => {
                    if changed.is_err() || *shutdown_rx.borrow() {
                        break;
                    }
                }
                accepted = listener.accept() => {
                    let Ok((mut inbound, _)) = accepted else {
                        continue;
                    };
                    tokio::spawn(async move {
                        match TcpStream::connect((guest_ip, port)).await {
                            Ok(mut outbound) => {
                                let _ = copy_bidirectional(&mut inbound, &mut outbound).await;
                            }
                            Err(err) => {
                                let _ = inbound
                                    .write_all(format!("proxy connection failed: {err}\n").as_bytes())
                                    .await;
                            }
                        }
                    });
                }
            }
        }
        tracing::debug!(process_id = %id, port, "firecracker preview proxy stopped");
    });
    Ok(shutdown)
}
