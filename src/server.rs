use crate::config::Config;
use crate::node::AppState;
use crate::signaling;
use axum::http::{header, StatusCode};
use rust_embed::Embed;
use std::sync::Arc;
use tokio::net::TcpListener;
use tokio::task::JoinHandle;
use tower_http::cors::CorsLayer;

/// Embedded frontend assets — compiled into the binary at build time.
#[derive(Embed)]
#[folder = "frontend/"]
struct FrontendAssets;

/// Content-Security-Policy：限制前端资源加载来源，防 XSS 注入。
/// - script-src 'self'：仅同源脚本（qrcode.min.js 已确认不用 eval/Function）
/// - style-src 'unsafe-inline'：进度条等动态 style 属性
/// - blob:/data:：图片/视频预览与 favicon
/// - ws:/wss:：WebSocket 信令连接
const CSP: &str = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self' ws: wss:; font-src 'self'";

/// Start the axum server with graceful shutdown support.
///
/// Returns `(lan_url, shutdown_sender, server_task_handle)`.
pub async fn run_server(
    config: Config,
) -> (String, tokio::sync::oneshot::Sender<()>, JoinHandle<()>) {
    let state = AppState::new(
        config.max_file_size_mb * 1024 * 1024,
        config.max_text_size_mb * 1024 * 1024,
    );

    let local_ip = get_local_ip();
    let lan_url = local_ip.as_ref().map_or_else(
        || format!("http://localhost:{}", config.port),
        |ip| format!("http://{}:{}", ip, config.port),
    );

    let app = build_app(state, &lan_url);

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
        if let Err(e) = axum::serve(listener, app)
            .with_graceful_shutdown(async {
                let _ = shutdown_rx.await;
            })
            .await
        {
            tracing::error!("服务器异常退出: {e}");
        }
    });

    (lan_url, shutdown_tx, handle)
}

/// Build the axum Router with all routes.
pub fn build_app(state: Arc<AppState>, lan_url: &str) -> axum::Router {
    let lan_url = lan_url.to_string();
    axum::Router::new()
        .route("/ws", axum::routing::get(signaling::ws_handler))
        .route(
            "/health",
            axum::routing::get(|| async { axum::Json(serde_json::json!({"status": "ok"})) }),
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
        .fallback(serve_embedded_file)
        // 同源访问本不需要 CORS；保留 permissive 仅为兼容局域网内不同 IP/工具直接调用 /api/info
        .layer(CorsLayer::permissive())
        .with_state(state)
}

/// Serve embedded frontend files.
async fn serve_embedded_file(req: axum::extract::Request) -> impl axum::response::IntoResponse {
    let path = req.uri().path().trim_start_matches('/');

    // Root path → index.html
    let path = if path.is_empty() { "index.html" } else { path };

    // Try exact path first, then path + /index.html
    let file =
        FrontendAssets::get(path).or_else(|| FrontendAssets::get(&format!("{}/index.html", path)));

    match file {
        Some(file) => {
            let mime_type = mime_guess::from_path(path)
                .first_or_octet_stream()
                .to_string();
            (
                StatusCode::OK,
                [
                    (header::CONTENT_TYPE, mime_type),
                    (header::CONTENT_SECURITY_POLICY, CSP.to_string()),
                ],
                file.data.to_vec(),
            )
        }
        None => {
            // Fallback to index.html
            match FrontendAssets::get("index.html") {
                Some(file) => (
                    StatusCode::OK,
                    [
                        (header::CONTENT_TYPE, "text/html; charset=utf-8".to_string()),
                        (header::CONTENT_SECURITY_POLICY, CSP.to_string()),
                    ],
                    file.data.to_vec(),
                ),
                None => (
                    StatusCode::NOT_FOUND,
                    [
                        (header::CONTENT_TYPE, "text/plain".to_string()),
                        (header::CONTENT_SECURITY_POLICY, CSP.to_string()),
                    ],
                    "404 Not Found".as_bytes().to_vec(),
                ),
            }
        }
    }
}

/// Get the first non-loopback IPv4 address, skipping common virtual interfaces
/// (docker/veth/virbr/bridge/tun/tap/...) so the printed LAN URL is reachable.
pub fn get_local_ip() -> Option<String> {
    let interfaces = if_addrs::get_if_addrs().ok()?;
    const VIRTUAL_PREFIXES: &[&str] = &[
        "docker", "veth", "virbr", "br-", "tun", "tap", "utun", "flannel", "cni",
    ];
    interfaces
        .iter()
        .filter(|iface| {
            !iface.is_loopback()
                && iface.addr.ip().is_ipv4()
                && !VIRTUAL_PREFIXES.iter().any(|p| iface.name.starts_with(p))
        })
        .map(|iface| iface.addr.ip().to_string())
        .next()
}
