use crate::config::Config;
use crate::node::AppState;
use crate::signaling;
use std::sync::Arc;
use tokio::net::TcpListener;
use tokio::task::JoinHandle;
use tower_http::cors::CorsLayer;
use tower_http::services::ServeDir;

/// Start the axum server with graceful shutdown support.
///
/// Returns `(lan_url, shutdown_sender, server_task_handle)`.
pub async fn run_server(config: Config) -> (String, tokio::sync::oneshot::Sender<()>, JoinHandle<()>) {
    let state = AppState::new(
        config.max_file_size_mb * 1024 * 1024,
        config.max_text_size_mb * 1024 * 1024,
    );

    let local_ip = get_local_ip();
    let lan_url = local_ip.as_ref().map_or_else(
        || format!("http://localhost:{}", config.port),
        |ip| format!("http://{}:{}", ip, config.port),
    );

    let app = build_app(state, &lan_url, &config.static_dir());

    let listener = TcpListener::bind(format!("0.0.0.0:{}", config.port))
        .await
        .unwrap_or_else(|e| panic!("Failed to bind port {}: {}", config.port, e));

    tracing::info!("LanDrop v{} 已启动！", env!("CARGO_PKG_VERSION"));
    tracing::info!("本机访问:    http://localhost:{}", config.port);
    if let Some(ip) = &local_ip {
        tracing::info!("局域网访问:  http://{}:{}", ip, config.port);
    }
    tracing::info!("文件大小上限: {} MB", config.max_file_size_mb);
    tracing::info!("文本大小上限: {} MB", config.max_text_size_mb);

    let (shutdown_tx, shutdown_rx) = tokio::sync::oneshot::channel::<()>();

    let handle = tokio::spawn(async move {
        axum::serve(listener, app)
            .with_graceful_shutdown(async {
                let _ = shutdown_rx.await;
            })
            .await
            .unwrap();
    });

    (lan_url, shutdown_tx, handle)
}

/// Build the axum Router with all routes.
pub fn build_app(state: Arc<AppState>, lan_url: &str, static_dir: &str) -> axum::Router {
    let lan_url = lan_url.to_string();
    axum::Router::new()
        .route("/ws", axum::routing::get(signaling::ws_handler))
        .route(
            "/health",
            axum::routing::get(|| async {
                axum::Json(serde_json::json!({"status": "ok"}))
            }),
        )
        .route(
            "/api/info",
            axum::routing::get({
                let url = lan_url.clone();
                move |axum::extract::State(state): axum::extract::State<Arc<AppState>>| async move {
                    axum::Json(serde_json::json!({
                        "url": url,
                        "maxFileSize": state.max_file_size,
                        "maxTextSize": state.max_text_size,
                        "protocolVersion": signaling::PROTOCOL_VERSION,
                        "maxNameLength": signaling::MAX_NAME_LENGTH,
                    }))
                }
            }),
        )
        .route(
            "/favicon.ico",
            axum::routing::get(|| async {
                (
                    [(axum::http::header::CONTENT_TYPE, "image/svg+xml")],
                    r#"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><text y=".9em" font-size="90">📡</text></svg>"#,
                )
            }),
        )
        .fallback_service(ServeDir::new(static_dir))
        .layer(CorsLayer::permissive())
        .with_state(state)
}

/// Get the first non-loopback IPv4 address of this machine.
pub fn get_local_ip() -> Option<String> {
    let interfaces = if_addrs::get_if_addrs().ok()?;
    interfaces
        .iter()
        .find(|iface| !iface.is_loopback() && iface.addr.ip().is_ipv4())
        .map(|iface| iface.addr.ip().to_string())
}
