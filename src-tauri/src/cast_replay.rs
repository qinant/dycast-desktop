use std::collections::HashMap;
use std::io::BufRead;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use serde::Serialize;
use serde_json::Value;
use tokio::fs::File;
use tokio::io::{AsyncBufRead, AsyncBufReadExt, BufReader};
use tokio::sync::Mutex;

const FALLBACK_INTERVAL_MS: u64 = 200;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CastReplayReadResult {
    pub id: u64,
    pub filename: String,
    pub total_messages: usize,
    pub estimated_duration_ms: u64,
}

#[derive(Debug)]
struct ReplayFileMetadata {
    total_messages: usize,
    estimated_duration_ms: u64,
}

struct ReplaySession {
    path: PathBuf,
    reader: BufReader<File>,
}

pub struct CastReplayState {
    next_id: u64,
    sessions: HashMap<u64, ReplaySession>,
}

impl CastReplayState {
    pub fn new() -> Self {
        Self {
            next_id: 1,
            sessions: HashMap::new(),
        }
    }
}

fn message_timestamp(value: &Value) -> Option<u64> {
    value.get("timestamp").and_then(|v| v.as_u64())
}

fn scan_replay_file(path: &Path) -> Result<ReplayFileMetadata, String> {
    let file = std::fs::File::open(path).map_err(|e| format!("读取文件失败: {}", e))?;
    let reader = std::io::BufReader::new(file);
    let mut total_messages = 0;
    let mut estimated_duration_ms = 0;
    let mut prev_timestamp: Option<u64> = None;

    for line in reader.lines() {
        let line = line.map_err(|e| format!("读取文件失败: {}", e))?;
        let line = line.trim();
        if line.is_empty() {
            continue;
        }

        let Ok(value) = serde_json::from_str::<Value>(line) else {
            continue;
        };

        if total_messages > 0 {
            let curr_timestamp = message_timestamp(&value);
            if let (Some(prev), Some(curr)) = (prev_timestamp, curr_timestamp) {
                if curr > prev {
                    estimated_duration_ms += curr - prev;
                } else {
                    estimated_duration_ms += FALLBACK_INTERVAL_MS;
                }
            } else {
                estimated_duration_ms += FALLBACK_INTERVAL_MS;
            }
        }

        prev_timestamp = message_timestamp(&value);
        total_messages += 1;
    }

    if total_messages == 0 {
        return Err("文件中没有有效的弹幕数据".to_string());
    }

    Ok(ReplayFileMetadata {
        total_messages,
        estimated_duration_ms,
    })
}

async fn read_next_valid_line<R: AsyncBufRead + Unpin>(reader: &mut R) -> Result<Option<String>, String> {
    let mut line = String::new();
    loop {
        line.clear();
        // tokio::io 的 read_line 内部经阻塞线程池调度，不会卡住 tokio worker 线程
        let size = reader
            .read_line(&mut line)
            .await
            .map_err(|e| format!("读取文件失败: {}", e))?;
        if size == 0 {
            return Ok(None);
        }

        let trimmed = line.trim();
        if trimmed.is_empty() || serde_json::from_str::<Value>(trimmed).is_err() {
            continue;
        }

        return Ok(Some(trimmed.to_string()));
    }
}

async fn open_replay_reader(path: &Path) -> Result<BufReader<File>, String> {
    let file = File::open(path)
        .await
        .map_err(|e| format!("读取文件失败: {}", e))?;
    Ok(BufReader::new(file))
}

#[tauri::command]
pub async fn cast_replay_read(
    state: tauri::State<'_, Arc<Mutex<CastReplayState>>>,
) -> Result<Option<CastReplayReadResult>, String> {
    let path: Option<PathBuf> = tokio::task::spawn_blocking(move || {
        rfd::FileDialog::new()
            .add_filter("JSON Lines", &["jsonl"])
            .set_title("选择弹幕记录文件")
            .pick_file()
    })
    .await
    .map_err(|e| format!("打开文件对话框失败: {}", e))?;

    let Some(path) = path else {
        return Ok(None);
    };

    let filename = path
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_default();

    let metadata_path = path.clone();
    let metadata = tokio::task::spawn_blocking(move || scan_replay_file(&metadata_path))
        .await
        .map_err(|e| format!("读取文件失败: {}", e))??;

    let reader = open_replay_reader(&path).await?;

    let id = {
        let mut state = state.lock().await;
        let id = state.next_id;
        state.next_id += 1;
        state.sessions.insert(id, ReplaySession { path, reader });
        id
    };

    Ok(Some(CastReplayReadResult {
        id,
        filename,
        total_messages: metadata.total_messages,
        estimated_duration_ms: metadata.estimated_duration_ms,
    }))
}

#[tauri::command]
pub async fn cast_replay_next(
    state: tauri::State<'_, Arc<Mutex<CastReplayState>>>,
    id: u64,
) -> Result<Option<String>, String> {
    let mut state = state.lock().await;
    let Some(session) = state.sessions.get_mut(&id) else {
        return Ok(None);
    };
    read_next_valid_line(&mut session.reader).await
}

#[tauri::command]
pub async fn cast_replay_reset(
    state: tauri::State<'_, Arc<Mutex<CastReplayState>>>,
    id: u64,
) -> Result<(), String> {
    let path = {
        let state = state.lock().await;
        state.sessions.get(&id).map(|s| s.path.clone())
    };

    let Some(path) = path else {
        return Ok(());
    };

    let reader = open_replay_reader(&path).await?;

    let mut state = state.lock().await;
    if let Some(session) = state.sessions.get_mut(&id) {
        session.reader = reader;
    }
    Ok(())
}

#[tauri::command]
pub async fn cast_replay_close(
    state: tauri::State<'_, Arc<Mutex<CastReplayState>>>,
    id: u64,
) -> Result<(), String> {
    let mut state = state.lock().await;
    state.sessions.remove(&id);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_jsonl_path() -> PathBuf {
        let id = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        std::env::temp_dir().join(format!("dycast-replay-test-{}.jsonl", id))
    }

    #[test]
    fn scans_valid_jsonl_metadata_without_counting_invalid_lines() {
        let path = temp_jsonl_path();
        {
            let mut file = std::fs::File::create(&path).unwrap();
            writeln!(file, "{{\"id\":\"1\",\"timestamp\":1000}}").unwrap();
            writeln!(file, "not json").unwrap();
            writeln!(file).unwrap();
            writeln!(file, "{{\"id\":\"2\",\"timestamp\":1250}}").unwrap();
            writeln!(file, "{{\"id\":\"3\"}}").unwrap();
        }

        let metadata = scan_replay_file(&path).unwrap();

        assert_eq!(metadata.total_messages, 3);
        assert_eq!(metadata.estimated_duration_ms, 450);

        let _ = std::fs::remove_file(path);
    }
}
