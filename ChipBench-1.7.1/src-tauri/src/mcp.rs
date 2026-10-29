//! MCP connection helpers (1.7): find a working Python, run the MCP server's self-test, locate the AI clients' config files.
//! The MCP server itself stays a plain Python script (mcp/chipbench_mcp.py); this module only helps the UI wire it up.
use crate::util::{err, home, silent};
use std::path::{Path, PathBuf};
use std::process::Command;

#[derive(serde::Serialize, Debug, PartialEq)]
pub struct PythonInfo {
    /// how it was found: "py", "python", "python3" or "CHIPBENCH_PYTHON"
    pub via: String,
    /// absolute path of the interpreter (sys.executable) - this is what goes into client configs
    pub exe: String,
    pub version: String,
}

/// "3.12.4" -> (3, 12)
pub fn parse_version(v: &str) -> Option<(u32, u32)> {
    let mut it = v.trim().split('.');
    let major = it.next()?.parse::<u32>().ok()?;
    let minor = it.next()?.parse::<u32>().ok()?;
    Some((major, minor))
}

/// Python 3.8+ is required by the server (standard library only).
pub fn version_ok(v: &str) -> bool {
    matches!(parse_version(v), Some((3, m)) if m >= 8)
}

fn probe(via: &str, program: &str, pre: &[&str]) -> Option<PythonInfo> {
    let mut c = Command::new(program);
    c.args(pre).args(["-c", "import sys;print(sys.executable);print('%d.%d.%d' % sys.version_info[:3])"]);
    let out = silent(&mut c).output().ok()?;
    if !out.status.success() {
        return None; // e.g. the Microsoft Store "python.exe" stub exits non-zero
    }
    let text = String::from_utf8_lossy(&out.stdout).into_owned();
    let mut lines = text.lines();
    let exe = lines.next()?.trim().to_string();
    let version = lines.next().unwrap_or("").trim().to_string();
    if exe.is_empty() || !version_ok(&version) {
        return None;
    }
    Some(PythonInfo { via: via.to_string(), exe, version })
}

/// Every usable Python 3.8+ (deduplicated by path), best first: CHIPBENCH_PYTHON, the `py -3` launcher, `python`, `python3`.
#[tauri::command(async)]
pub fn detect_python() -> Vec<PythonInfo> {
    let mut found: Vec<PythonInfo> = Vec::new();
    let mut push = |p: Option<PythonInfo>| {
        if let Some(p) = p {
            if !found.iter().any(|f| f.exe.eq_ignore_ascii_case(&p.exe)) {
                found.push(p);
            }
        }
    };
    if let Ok(v) = std::env::var("CHIPBENCH_PYTHON") {
        if !v.trim().is_empty() {
            push(probe("CHIPBENCH_PYTHON", v.trim(), &[]));
        }
    }
    push(probe("py", "py", &["-3"]));
    push(probe("python", "python", &[]));
    push(probe("python3", "python3", &[]));
    found
}

fn file_name_of(p: &str) -> String {
    Path::new(p).file_name().map(|n| n.to_string_lossy().to_lowercase()).unwrap_or_default()
}

/// Run `<python> <script> --selftest` and return its JSON report. Only the MCP script and a python-looking executable are accepted.
#[tauri::command(async)]
pub fn mcp_selftest(python: String, script: String) -> Result<String, String> {
    if file_name_of(&script) != "chipbench_mcp.py" {
        return Err("script must be chipbench_mcp.py".into());
    }
    let py = file_name_of(&python);
    if !(py.starts_with("python") || py == "py" || py == "py.exe") {
        return Err("not a Python interpreter".into());
    }
    let mut c = Command::new(&python);
    if py == "py" || py == "py.exe" {
        c.arg("-3");
    }
    c.arg(&script).arg("--selftest");
    let out = silent(&mut c).output().map_err(err)?;
    let stdout = String::from_utf8_lossy(&out.stdout).trim().to_string();
    if out.status.success() && !stdout.is_empty() {
        Ok(stdout)
    } else {
        let e = String::from_utf8_lossy(&out.stderr).trim().to_string();
        Err(if e.is_empty() { format!("exit code {:?}", out.status.code()) } else { e })
    }
}

#[derive(serde::Serialize, Debug)]
pub struct ClientConfig {
    pub id: String,
    pub name: String,
    pub path: String,
    pub exists: bool,
    /// JSON key that holds the server table: "mcpServers" (Claude / Cursor) or "servers" (VS Code)
    pub key: String,
}

fn client(id: &str, name: &str, path: PathBuf, key: &str) -> ClientConfig {
    ClientConfig { id: id.into(), name: name.into(), exists: path.exists(), path: path.to_string_lossy().into_owned(), key: key.into() }
}

/// Where the common MCP clients keep their user-level config (Windows layout).
#[tauri::command(async)]
pub fn mcp_clients() -> Vec<ClientConfig> {
    let mut v = Vec::new();
    if let Some(appdata) = std::env::var_os("APPDATA") {
        let a = PathBuf::from(appdata);
        v.push(client("claude-desktop", "Claude Desktop", a.join("Claude").join("claude_desktop_config.json"), "mcpServers"));
        v.push(client("vscode", "VS Code（用户级，GitHub Copilot 等）", a.join("Code").join("User").join("mcp.json"), "servers"));
    }
    v.push(client("cursor", "Cursor", home().join(".cursor").join("mcp.json"), "mcpServers"));
    v
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn version_parsing() {
        assert_eq!(parse_version("3.12.4"), Some((3, 12)));
        assert_eq!(parse_version(" 3.8.0\r"), Some((3, 8)));
        assert_eq!(parse_version("abc"), None);
        assert_eq!(parse_version(""), None);
    }

    #[test]
    fn python_version_gate() {
        assert!(version_ok("3.8.0"));
        assert!(version_ok("3.13.1"));
        assert!(!version_ok("3.7.9"));
        assert!(!version_ok("2.7.18"));
        assert!(!version_ok(""));
    }

    #[test]
    fn selftest_refuses_other_scripts_and_programs() {
        assert!(mcp_selftest("python".into(), "C:/x/evil.py".into()).is_err());
        assert!(mcp_selftest("cmd.exe".into(), "C:/x/chipbench_mcp.py".into()).is_err());
        assert!(mcp_selftest("powershell".into(), "C:/x/chipbench_mcp.py".into()).is_err());
    }

    #[test]
    fn client_list_always_has_cursor() {
        assert!(mcp_clients().iter().any(|c| c.id == "cursor"));
    }
}
