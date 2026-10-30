//! GB-scale log files: sparse line index, line windows, streaming grep.
use crate::util::{err, mtime_ms};
use std::fs;
use std::io::{BufRead, Read, Seek, SeekFrom};
use std::sync::Mutex;
use tauri::Manager;

/* ---------------------------------------------------------------- GB-scale logs: sparse line index */

#[derive(Clone)]
pub struct LogIdx {
    pub key: String,
    pub bytes: u64,
    pub lines: u64,
    pub marks: Vec<u64>,
}

pub struct LogCache(pub Mutex<Vec<LogIdx>>);

pub const LOG_STEP: u64 = 256;

pub fn log_build(app: &tauri::AppHandle, path: &str) -> Result<LogIdx, String> {
    let md = fs::metadata(path).map_err(err)?;
    let key = format!("{}|{}|{}", path.to_lowercase(), mtime_ms(&md), md.len());
    let st = app.state::<LogCache>();
    if let Some(i) = st.0.lock().map_err(err)?.iter().find(|i| i.key == key) {
        return Ok(i.clone());
    }
    let mut f = std::io::BufReader::with_capacity(1 << 20, fs::File::open(path).map_err(err)?);
    let mut buf = vec![0u8; 1 << 20];
    let (mut off, mut lines, mut marks) = (0u64, 0u64, vec![0u64]);
    let mut last = b'\n';
    loop {
        let n = f.read(&mut buf).map_err(err)?;
        if n == 0 {
            break;
        }
        for (i, b) in buf[..n].iter().enumerate() {
            if *b == b'\n' {
                lines += 1;
                if lines % LOG_STEP == 0 {
                    marks.push(off + i as u64 + 1);
                }
            }
        }
        last = buf[n - 1];
        off += n as u64;
    }
    if off > 0 && last != b'\n' {
        lines += 1;
    }
    let idx = LogIdx { key, bytes: off, lines, marks };
    let mut c = st.0.lock().map_err(err)?;
    c.push(idx.clone());
    if c.len() > 3 {
        c.remove(0);
    }
    Ok(idx)
}

#[derive(serde::Serialize)]
pub struct LogInfo {
    pub bytes: u64,
    pub lines: u64,
}

#[tauri::command(async)]
pub fn log_index(app: tauri::AppHandle, path: String) -> Result<LogInfo, String> {
    let i = log_build(&app, &path)?;
    Ok(LogInfo { bytes: i.bytes, lines: i.lines })
}

#[tauri::command(async)]
pub fn log_lines(app: tauri::AppHandle, path: String, start: u64, count: u64) -> Result<Vec<String>, String> {
    let i = log_build(&app, &path)?;
    let m = (start / LOG_STEP) as usize;
    let mut f = std::io::BufReader::new(fs::File::open(&path).map_err(err)?);
    f.seek(SeekFrom::Start(*i.marks.get(m).unwrap_or(&0))).map_err(err)?;
    let mut ln = m as u64 * LOG_STEP;
    let mut out = Vec::with_capacity(count.min(2000) as usize);
    let mut buf = Vec::new();
    while ln < start + count.min(2000) {
        buf.clear();
        if f.read_until(b'\n', &mut buf).map_err(err)? == 0 {
            break;
        }
        if ln >= start {
            out.push(String::from_utf8_lossy(&buf).trim_end_matches(['\r', '\n']).chars().take(4000).collect());
        }
        ln += 1;
    }
    Ok(out)
}

#[derive(serde::Serialize)]
pub struct LogHit {
    pub line: u64,
    pub text: String,
}

#[tauri::command(async)]
pub fn log_grep(path: String, pattern: String, max: usize) -> Result<Vec<LogHit>, String> {
    let re = regex::RegexBuilder::new(&pattern).case_insensitive(true).build().map_err(err)?;
    let mut f = std::io::BufReader::with_capacity(1 << 20, fs::File::open(&path).map_err(err)?);
    let (mut out, mut buf, mut ln) = (Vec::new(), Vec::new(), 0u64);
    loop {
        buf.clear();
        if f.read_until(b'\n', &mut buf).map_err(err)? == 0 {
            break;
        }
        let s = String::from_utf8_lossy(&buf);
        if re.is_match(&s) {
            out.push(LogHit { line: ln, text: s.trim_end_matches(['\r', '\n']).chars().take(2000).collect() });
            if out.len() >= max {
                break;
            }
        }
        ln += 1;
    }
    Ok(out)
}
