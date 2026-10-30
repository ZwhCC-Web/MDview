//! Text / binary file I/O with encoding detection; saves are atomic (see util::atomic_write).
use crate::util::{atomic_write, err};
use base64::{engine::general_purpose::STANDARD, Engine};
use encoding_rs::Encoding;
use std::fs;

/* ---------------------------------------------------------------- text files */

#[derive(serde::Serialize)]
pub struct TextFile {
    pub text: String,
    pub encoding: String,
}

pub fn decode(bytes: &[u8]) -> TextFile {
    if let Some((enc, bom)) = Encoding::for_bom(bytes) {
        let (cow, _) = enc.decode_without_bom_handling(&bytes[bom..]);
        return TextFile { text: cow.into_owned(), encoding: enc.name().to_string() };
    }
    if let Ok(s) = std::str::from_utf8(bytes) {
        return TextFile { text: s.to_string(), encoding: "UTF-8".into() };
    }
    let mut det = chardetng::EncodingDetector::new();
    det.feed(bytes, true);
    let enc = det.guess(None, true);
    let (cow, _, _) = enc.decode(bytes);
    let name = match enc.name() {
        "GBK" | "gb18030" => "GBK",
        n => n,
    };
    TextFile { text: cow.into_owned(), encoding: name.to_string() }
}

#[tauri::command(async)]
pub fn read_text(path: String) -> Result<TextFile, String> {
    Ok(decode(&fs::read(&path).map_err(err)?))
}

/// 1.6.1: binary read without base64 — the bytes travel as a raw IPC body and arrive in JS as an ArrayBuffer
/// (≈4/3 less data, no atob() loop on the UI thread). PDF / Office / images / firmware all use this.
#[tauri::command(async)]
pub fn read_bytes(path: String) -> Result<tauri::ipc::Response, String> {
    Ok(tauri::ipc::Response::new(fs::read(&path).map_err(err)?))
}

#[tauri::command(async)]
pub fn read_b64(path: String) -> Result<String, String> {
    Ok(STANDARD.encode(fs::read(&path).map_err(err)?))
}

#[tauri::command(async)]
pub fn write_text(path: String, content: String, encoding: Option<String>) -> Result<(), String> {
    match encoding.as_deref() {
        None | Some("") | Some("UTF-8") | Some("utf-8") => atomic_write(&path, content.as_bytes()),
        Some(label) => {
            let enc = Encoding::for_label(label.as_bytes()).ok_or_else(|| format!("未知编码: {label}"))?;
            let (bytes, _, lossy) = enc.encode(&content);
            if lossy {
                return Err(format!("内容中有无法用 {label} 表示的字符，请先转换为 UTF-8"));
            }
            atomic_write(&path, &bytes)
        }
    }
}

#[tauri::command(async)]
pub fn write_b64(path: String, data: String) -> Result<(), String> {
    atomic_write(&path, &STANDARD.decode(data.as_bytes()).map_err(err)?)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn utf8_plain_and_bom() {
        let f = decode("温度 25℃".as_bytes());
        assert_eq!((f.text.as_str(), f.encoding.as_str()), ("温度 25℃", "UTF-8"));
        let g = decode(b"\xEF\xBB\xBFabc");
        assert_eq!((g.text.as_str(), g.encoding.as_str()), ("abc", "UTF-8"));
    }

    #[test]
    fn utf16le_bom() {
        let f = decode(&[0xFF, 0xFE, 0x61, 0x00, 0x62, 0x00]);
        assert_eq!((f.text.as_str(), f.encoding.as_str()), ("ab", "UTF-16LE"));
    }

    #[test]
    fn gbk_round_trip_through_write_text() {
        let d = std::env::temp_dir().join(format!("chipbench-test-gbk-{}", std::process::id()));
        let _ = fs::remove_dir_all(&d);
        fs::create_dir_all(&d).unwrap();
        let p = d.join("gbk.txt").to_string_lossy().into_owned();
        let text = "寄存器配置：时钟分频与波特率设置，用于验证 GBK 编码往返。".to_string();
        write_text(p.clone(), text.clone(), Some("GBK".into())).unwrap();
        assert!(std::str::from_utf8(&fs::read(&p).unwrap()).is_err(), "file must really be GBK");
        assert_eq!(read_text(p).unwrap().text, text);
        let _ = fs::remove_dir_all(&d);
    }

    #[test]
    fn unencodable_characters_are_rejected_not_lossy() {
        let d = std::env::temp_dir().join(format!("chipbench-test-lossy-{}", std::process::id()));
        let _ = fs::remove_dir_all(&d);
        fs::create_dir_all(&d).unwrap();
        assert!(write_text(d.join("l.txt").to_string_lossy().into_owned(), "emoji 😀".into(), Some("GBK".into())).is_err());
        let _ = fs::remove_dir_all(&d);
    }
}
