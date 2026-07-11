//! Crash-safe replacement for files mutated by API and native-agent surfaces.
//!
//! A writer must never truncate the destination in place because preview,
//! editor, and agent readers run independently and could observe a partially
//! serialized document. Callers remain responsible for acquiring the shared
//! `AppState` namespace and path locks before performing their optimistic
//! concurrency checks and invoking this helper.

use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};

use uuid::Uuid;

/// Replace `path` with complete bytes using a same-directory temporary file.
///
/// The blocking filesystem work runs outside Tokio's executor. Preserving the
/// previous mode avoids unexpectedly widening or narrowing access when an
/// existing workspace file is replaced.
pub async fn atomic_replace_file(path: &Path, bytes: &[u8]) -> std::io::Result<()> {
    let path = path.to_path_buf();
    let bytes = bytes.to_vec();
    tokio::task::spawn_blocking(move || atomic_replace_file_blocking(&path, &bytes))
        .await
        .map_err(|error| std::io::Error::other(format!("file write worker failed: {error}")))?
}

fn atomic_replace_file_blocking(path: &Path, bytes: &[u8]) -> std::io::Result<()> {
    let parent = path.parent().ok_or_else(|| {
        std::io::Error::new(
            std::io::ErrorKind::InvalidInput,
            "file has no parent directory",
        )
    })?;
    fs::create_dir_all(parent)?;
    let file_name = path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("workspace-file");
    let temporary_path = temporary_path(parent, file_name);
    let result = (|| {
        let mut temporary = OpenOptions::new()
            .create_new(true)
            .write(true)
            .open(&temporary_path)?;
        if let Ok(metadata) = fs::metadata(path) {
            temporary.set_permissions(metadata.permissions())?;
        }
        temporary.write_all(bytes)?;
        temporary.sync_all()?;
        fs::rename(&temporary_path, path)?;
        if let Err(error) = sync_parent_directory(parent) {
            // The rename already committed complete bytes. Reporting failure
            // would encourage a retry against a revision that actually saved,
            // so retain the committed result and expose weaker crash durability
            // through diagnostics instead.
            tracing::warn!(path = %path.display(), error = %error, "parent directory sync failed after atomic rename");
        }
        Ok(())
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temporary_path);
    }
    result
}

fn temporary_path(parent: &Path, file_name: &str) -> PathBuf {
    parent.join(format!(".{file_name}.mymy-{}.tmp", Uuid::new_v4()))
}

#[cfg(unix)]
fn sync_parent_directory(path: &Path) -> std::io::Result<()> {
    fs::File::open(path)?.sync_all()
}

#[cfg(not(unix))]
fn sync_parent_directory(_path: &Path) -> std::io::Result<()> {
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn replacement_commits_complete_bytes_and_removes_temporary_state() {
        let directory =
            std::env::temp_dir().join(format!("mymy-atomic-file-replace-{}", Uuid::new_v4()));
        fs::create_dir_all(&directory).unwrap();
        let path = directory.join("document.txt");
        fs::write(&path, b"before").unwrap();

        atomic_replace_file(&path, b"after-complete").await.unwrap();

        assert_eq!(fs::read(&path).unwrap(), b"after-complete");
        let temporary_files = fs::read_dir(&directory)
            .unwrap()
            .filter_map(Result::ok)
            .filter(|entry| entry.file_name().to_string_lossy().contains(".mymy-"))
            .count();
        assert_eq!(temporary_files, 0);
        fs::remove_dir_all(directory).unwrap();
    }
}
