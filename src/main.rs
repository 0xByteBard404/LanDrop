mod config;
mod name_gen;
mod node;
mod signaling;

use clap::Parser;
use tokio::net::TcpListener;
use tower_http::cors::CorsLayer;
use tower_http::services::ServeDir;
use tracing_subscriber::EnvFilter;

use crate::node::AppState;

#[tokio::main]
async fn main() {
    let config = config::Config::parse();

    tracing_subscriber::fmt()
        .with_env_filter(
            EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| EnvFilter::new(config.log_level.as_ref())),
        )
        .init();

    let state = AppState::new(config.max_file_size);

    let app = axum::Router::new()
        .route("/ws", axum::routing::get(signaling::ws_handler))
        .route(
            "/health",
            axum::routing::get(|| async {
                axum::Json(serde_json::json!({"status": "ok"}))
            }),
        )
        .fallback_service(ServeDir::new(&config.static_dir))
        .layer(CorsLayer::permissive())
        .with_state(state);

    let listener = TcpListener::bind(format!("0.0.0.0:{}", config.port))
        .await
        .unwrap_or_else(|e| panic!("Failed to bind port {}: {}", config.port, e));

    let local_ip = get_local_ip();
    tracing::info!("LanDrop v0.1.0 已启动！");
    tracing::info!("本机访问:    http://localhost:{}", config.port);
    if let Some(ip) = &local_ip {
        tracing::info!("局域网访问:  http://{}:{}", ip, config.port);
    }
    tracing::info!("文件大小上限: {} MB", config.max_file_size);
    tracing::info!("按 Ctrl+C 优雅退出");

    axum::serve(listener, app)
        .await
        .unwrap();
}

fn get_local_ip() -> Option<String> {
    let output = std::process::Command::new("ifconfig")
        .output()
        .ok()?;
    let text = String::from_utf8_lossy(&output.stdout);
    for line in text.lines() {
        if line.contains("inet ") && !line.contains("127.0.0.1") {
            let parts: Vec<&str> = line.split_whitespace().collect();
            for (i, part) in parts.iter().enumerate() {
                if *part == "inet" {
                    return Some(parts.get(i + 1)?.to_string());
                }
            }
        }
    }
    None
}
