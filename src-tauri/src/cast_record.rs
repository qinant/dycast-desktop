use std::path::PathBuf;
use std::sync::Arc;

use serde::Serialize;
use tauri::State;
use tokio::fs::File;
use tokio::io::{AsyncWriteExt, BufWriter};
use tokio::sync::Mutex;

pub struct CastRecordState {
    writer: Mutex<Option<CastRecordWriter>>,
}

struct CastRecordWriter {
    writer: BufWriter<File>,
    path: PathBuf,
    count: u64,
}

#[derive(Debug, Serialize)]
pub struct CastRecordStartResult {
    path: String,
}

#[derive(Debug, Serialize)]
pub struct CastRecordStopResult {
    path: String,
    count: u64,
}

impl CastRecordState {
    pub fn new() -> Self {
        Self {
            writer: Mutex::new(None),
        }
    }
}

fn ensure_jsonl_ext(name: &str) -> String {
    if name.to_lowercase().ends_with(".jsonl") {
        name.to_string()
    } else {
        format!("{}.jsonl", name)
    }
}

#[tauri::command]
pub async fn cast_record_start(
    state: State<'_, Arc<CastRecordState>>,
    suggested_name: String,
) -> Result<Option<CastRecordStartResult>, String> {
    {
        let writer = state.writer.lock().await;
        if writer.is_some() {
            return Err("弹幕记录已启动".to_string());
        }
    }

    let file_name = ensure_jsonl_ext(&suggested_name);
    let path = tokio::task::spawn_blocking(move || {
        rfd::FileDialog::new()
            .add_filter("JSON Lines", &["jsonl"])
            .set_file_name(file_name)
            .save_file()
    })
    .await
    .map_err(|e| format!("打开保存对话框失败: {}", e))?;

    let Some(path) = path else {
        return Ok(None);
    };

    // tokio::fs 的文件创建内部经阻塞线程池调度，不会卡住 tokio worker 线程
    let file = File::create(&path)
        .await
        .map_err(|e| format!("创建记录文件失败: {}", e))?;
    let display_path = path.to_string_lossy().to_string();
    let mut writer = state.writer.lock().await;
    *writer = Some(CastRecordWriter {
        writer: BufWriter::new(file),
        path,
        count: 0,
    });

    Ok(Some(CastRecordStartResult { path: display_path }))
}

#[tauri::command]
pub async fn cast_record_write(
    state: State<'_, Arc<CastRecordState>>,
    lines: String,
    count: u64,
) -> Result<u64, String> {
    let mut guard = state.writer.lock().await;
    let record = guard.as_mut().ok_or_else(|| "弹幕记录未启动".to_string())?;

    // tokio::fs 的写入内部经阻塞线程池调度，不会卡住 tokio worker 线程
    record
        .writer
        .write_all(lines.as_bytes())
        .await
        .map_err(|e| format!("写入记录文件失败: {}", e))?;
    record.count += count;

    Ok(record.count)
}

#[tauri::command]
pub async fn cast_record_stop(
    state: State<'_, Arc<CastRecordState>>,
) -> Result<Option<CastRecordStopResult>, String> {
    let record = {
        let mut guard = state.writer.lock().await;
        guard.take()
    };

    let Some(mut record) = record else {
        return Ok(None);
    };

    record
        .writer
        .flush()
        .await
        .map_err(|e| format!("刷新记录文件失败: {}", e))?;

    Ok(Some(CastRecordStopResult {
        path: record.path.to_string_lossy().to_string(),
        count: record.count,
    }))
}
