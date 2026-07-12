#![cfg_attr(target_os = "windows", windows_subsystem = "windows")]

use clap::Parser;
use std::sync::{Arc, Mutex};
use tao::event_loop::{ControlFlow, EventLoopBuilder};
use tray_icon::{
    menu::{Menu, MenuEvent, MenuItem, PredefinedMenuItem},
    Icon, TrayIconBuilder,
};

enum UserEvent {
    MenuEvent(tray_icon::menu::MenuEvent),
}

fn main() {
    let config = lan_drop::config::Config::parse();

    // Initialize logging to file (no console on Windows subsystem)
    let log_path = std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(|d| d.join("landrop.log")))
        .unwrap_or_else(|| std::path::PathBuf::from("landrop.log"));

    // 兜底优先级：exe 同级目录 → 系统临时目录 → stderr（避免完全静默）
    let log_file = std::fs::File::create(&log_path)
        .or_else(|_| std::fs::File::create(std::env::temp_dir().join("landrop.log")))
        .ok();
    if let Some(file) = log_file {
        tracing_subscriber::fmt()
            .with_env_filter(tracing_subscriber::EnvFilter::new(config.log_level.as_ref()))
            .with_writer(std::sync::Mutex::new(file))
            .init();
    } else {
        // 最终兜底：stderr（Windows GUI 子系统下可能无效，但避免完全无日志）
        tracing_subscriber::fmt()
            .with_env_filter(tracing_subscriber::EnvFilter::new(config.log_level.as_ref()))
            .init();
    }

    tracing::info!("LanDrop Tray 模式启动中...");

    // Create tokio runtime and start server
    let rt = tokio::runtime::Runtime::new().expect("Failed to create tokio runtime");
    let (lan_url, shutdown_tx, server_handle) =
        rt.block_on(lan_drop::server::run_server(config));

    tracing::info!("服务已启动: {}", lan_url);

    // Auto-open browser
    if let Err(e) = webbrowser::open(&lan_url) {
        tracing::error!("无法打开浏览器: {}", e);
    }

    // Wrap shutdown state in Arc<Mutex<Option<...>>> for FnMut closure
    let shutdown_tx = Arc::new(Mutex::new(Some(shutdown_tx)));
    let server_handle = Arc::new(Mutex::new(Some(server_handle)));
    let rt = Arc::new(rt);

    // Create tao event loop
    let event_loop = EventLoopBuilder::<UserEvent>::with_user_event().build();

    // Forward menu events into the tao event loop
    let proxy = event_loop.create_proxy();
    MenuEvent::set_event_handler(Some(move |event| {
        let _ = proxy.send_event(UserEvent::MenuEvent(event));
    }));

    // Create tray icon
    let icon_bytes = include_bytes!("../../frontend/icon.ico");
    let img = image::load_from_memory_with_format(icon_bytes, image::ImageFormat::Ico)
        .expect("Failed to load icon")
        .to_rgba8();
    let (w, h) = (img.width(), img.height());
    let icon = Icon::from_rgba(img.into_raw(), w, h).expect("Failed to create tray icon");

    let menu = Menu::new();
    let dashboard_item = MenuItem::new("服务看板", true, None);
    let quit_item = MenuItem::new("退出", true, None);
    menu.append_items(&[
        &dashboard_item,
        &PredefinedMenuItem::separator(),
        &quit_item,
    ])
    .expect("Failed to create menu");

    let _tray = TrayIconBuilder::new()
        .with_icon(icon)
        .with_menu(Box::new(menu))
        .with_tooltip("LanDrop")
        .build()
        .expect("Failed to create tray icon");

    let dashboard_id = dashboard_item.id().clone();
    let quit_id = quit_item.id().clone();
    let lan_url = lan_url.clone();

    // Run the tao event loop — this never returns
    event_loop.run(move |event, _, control_flow| {
        *control_flow = ControlFlow::Wait;

        match event {
            tao::event::Event::UserEvent(UserEvent::MenuEvent(menu_event)) => {
                if menu_event.id == dashboard_id {
                    if let Err(e) = webbrowser::open(&lan_url) {
                        tracing::error!("无法打开浏览器: {}", e);
                    }
                } else if menu_event.id == quit_id {
                    tracing::info!("正在关闭服务...");
                    if let Some(tx) = shutdown_tx.lock().unwrap().take() {
                        let _ = tx.send(());
                    }
                    if let Some(handle) = server_handle.lock().unwrap().take() {
                        rt.block_on(async {
                            let _ = handle.await;
                        });
                    }
                    std::process::exit(0);
                }
            }
            _ => {}
        }
    });
}
