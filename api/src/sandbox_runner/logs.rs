//! Process log capture helpers.
//!
//! Runner-started long-lived processes expose logs through the API after the
//! process has started, so stdout/stderr streams are appended to a durable file
//! instead of being held in memory.

use std::path::PathBuf;

use tokio::io::{AsyncRead, AsyncReadExt, AsyncWriteExt};

pub(crate) async fn append_stream<R>(path: PathBuf, mut reader: R, label: &'static str)
where
    R: AsyncRead + Unpin,
{
    let mut buffer = vec![0_u8; 8192];
    loop {
        let read = match reader.read(&mut buffer).await {
            Ok(0) => break,
            Ok(read) => read,
            Err(_) => break,
        };
        if let Ok(mut file) = tokio::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(&path)
            .await
        {
            let _ = file.write_all(format!("[{label}] ").as_bytes()).await;
            let _ = file.write_all(&buffer[..read]).await;
        }
    }
}
