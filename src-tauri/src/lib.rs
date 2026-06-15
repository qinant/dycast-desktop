mod cast_record;
mod cast_replay;
mod live_info;
mod ws_relay;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(std::sync::Arc::new(cast_record::CastRecordState::new()))
        .manage(std::sync::Arc::new(live_info::HttpState::new()))
        .manage(std::sync::Arc::new(std::sync::Mutex::new(
            cast_replay::CastReplayState::new(),
        )))
        .manage(std::sync::Arc::new(std::sync::Mutex::new(
            ws_relay::WsState::new(),
        )))
        .invoke_handler(tauri::generate_handler![
            live_info::fetch_binary,
            live_info::fetch_head,
            live_info::fetch_live_html,
            live_info::fetch_live_info,
            cast_record::cast_record_start,
            cast_record::cast_record_write,
            cast_record::cast_record_stop,
            cast_replay::cast_replay_read,
            cast_replay::cast_replay_next,
            cast_replay::cast_replay_reset,
            cast_replay::cast_replay_close,
            ws_relay::ws_connect,
            ws_relay::ws_send,
            ws_relay::ws_send_text,
            ws_relay::ws_close
        ])
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .setup(|_app| {
            #[cfg(debug_assertions)]
            {
                use tauri::Manager;

                _app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
                if let Some(window) = _app.get_webview_window("main") {
                    window.open_devtools();
                }
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
