//! Shared helpers: error mapping, mtime, home dir, atomic file replacement, hidden child processes.
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

pub fn err<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}

pub fn mtime_ms(m: &fs::Metadata) -> u64 {
    m.modified().ok().and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok()).map(|d| d.as_millis() as u64).unwrap_or(0)
}

pub fn home() -> PathBuf {
    std::env::var_os("USERPROFILE").or_else(|| std::env::var_os("HOME")).map(PathBuf::from).unwrap_or_else(std::env::temp_dir)
}

/// Atomic save: write a temp file next to the target, then rename it over the target.
pub fn atomic_write(path: &str, data: &[u8]) -> Result<(), String> {
    if let Some(d) = Path::new(path).parent() {
        let _ = fs::create_dir_all(d);
    }
    let tmp = format!("{}.chipbench-tmp", path);
    fs::write(&tmp, data).map_err(err)?;
    if let Err(e) = fs::rename(&tmp, path) {
        let _ = fs::remove_file(&tmp);
        fs::write(path, data).map_err(|e2| format!("{e}; {e2}"))?; // e.g. locked by a sync client
    }
    Ok(())
}

/// Run a child process without flashing a console window (Windows); a no-op elsewhere.
pub fn silent(c: &mut Command) -> &mut Command {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        c.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }
    c
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("chipbench-test-{}-{}", std::process::id(), name));
        let _ = fs::remove_dir_all(&d);
        fs::create_dir_all(&d).unwrap();
        d
    }

    #[test]
    fn atomic_write_creates_parents_and_replaces() {
        let d = tmp("atomic");
        let p = d.join("a").join("b.txt");
        atomic_write(&p.to_string_lossy(), b"one").unwrap();
        assert_eq!(fs::read(&p).unwrap(), b"one");
        atomic_write(&p.to_string_lossy(), b"two").unwrap();
        assert_eq!(fs::read(&p).unwrap(), b"two");
        assert!(!d.join("a").join("b.txt.chipbench-tmp").exists());
        let _ = fs::remove_dir_all(&d);
    }

    #[test]
    fn mtime_is_nonzero_for_existing_file() {
        let d = tmp("mtime");
        let p = d.join("f.txt");
        fs::write(&p, b"x").unwrap();
        assert!(mtime_ms(&fs::metadata(&p).unwrap()) > 0);
        let _ = fs::remove_dir_all(&d);
    }

    #[test]
    fn err_formats_display() {
        assert_eq!(err("boom"), "boom");
    }
}
