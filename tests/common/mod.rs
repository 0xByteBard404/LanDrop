#![allow(dead_code)] // 测试辅助模块：字段/方法跨多个 test binary 共用，未必在每个中都使用

use axum::Router;
use futures::{SinkExt, StreamExt};
use lan_drop::node::AppState;
use lan_drop::signaling;
use reqwest::Client;
use std::net::SocketAddr;
use std::sync::Arc;
use tokio::net::TcpListener;
use tokio_tungstenite::{connect_async, tungstenite::Message};
use tower_http::cors::CorsLayer;

/// Test helper: starts a real axum server on a random port.
pub struct TestApp {
    pub addr: SocketAddr,
    pub state: Arc<AppState>,
    client: Client,
    shutdown_tx: Option<tokio::sync::oneshot::Sender<()>>,
}

impl TestApp {
    pub async fn start() -> Self {
        Self::start_with_limits(512 * 1024 * 1024, 1024 * 1024).await
    }

    pub async fn start_with_limits(max_file_size: u64, max_text_size: u64) -> Self {
        let state = AppState::new(max_file_size, max_text_size, "[]".to_string());
        let state_clone = state.clone();

        let app = Router::new()
            .route("/ws", axum::routing::get(signaling::ws_handler))
            .route(
                "/health",
                axum::routing::get(|| async {
                    axum::Json(serde_json::json!({"status": "ok"}))
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
            .layer(CorsLayer::permissive())
            .with_state(state_clone);

        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();

        let (shutdown_tx, shutdown_rx) = tokio::sync::oneshot::channel::<()>();

        tokio::spawn(async move {
            axum::serve(listener, app)
                .with_graceful_shutdown(async {
                    let _ = shutdown_rx.await;
                })
                .await
                .unwrap();
        });

        let client = Client::builder().no_proxy().build().unwrap();

        let instance = Self {
            addr,
            state,
            client: client.clone(),
            shutdown_tx: Some(shutdown_tx),
        };

        // Wait for server to be ready
        let url = instance.url();
        for _ in 0..50 {
            if client.get(format!("{}/health", url)).send().await.is_ok() {
                break;
            }
            tokio::time::sleep(std::time::Duration::from_millis(20)).await;
        }

        instance
    }

    pub fn url(&self) -> String {
        format!("http://{}", self.addr)
    }

    pub fn ws_url(&self) -> String {
        format!("ws://{}/ws", self.addr)
    }

    pub fn client(&self) -> &Client {
        &self.client
    }

    pub async fn ws_connect(&self) -> WsClient {
        WsClient::connect(&self.ws_url()).await
    }

    /// Connect with a specific join payload
    pub async fn ws_connect_with(
        &self,
        name: Option<&str>,
        node_id: Option<&str>,
        protocol_version: Option<u32>,
    ) -> WsClient {
        let mut ws = WsClient::connect_raw(&self.ws_url()).await;
        let mut join = serde_json::json!({"type": "join"});
        if let Some(name) = name {
            join["name"] = serde_json::Value::String(name.to_string());
        }
        if let Some(node_id) = node_id {
            join["nodeId"] = serde_json::Value::String(node_id.to_string());
        }
        if let Some(pv) = protocol_version {
            join["protocolVersion"] = serde_json::Value::Number(pv.into());
        }
        ws.send_json(&join).await;
        ws
    }
}

impl Drop for TestApp {
    fn drop(&mut self) {
        if let Some(tx) = self.shutdown_tx.take() {
            let _ = tx.send(());
        }
    }
}

/// WebSocket test client that handles the join handshake automatically.
pub struct WsClient {
    sink: futures::stream::SplitSink<
        tokio_tungstenite::WebSocketStream<
            tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>,
        >,
        Message,
    >,
    stream: futures::stream::SplitStream<
        tokio_tungstenite::WebSocketStream<
            tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>,
        >,
    >,
    pub node_id: Option<String>,
    pub name: Option<String>,
    pub initial_peers: Vec<serde_json::Value>,
}

impl WsClient {
    /// Connect and complete join handshake with auto-generated identity
    pub async fn connect(ws_url: &str) -> Self {
        let mut ws = Self::connect_raw(ws_url).await;
        let join = serde_json::json!({"type": "join", "protocolVersion": 1});
        ws.send_json(&join).await;

        // Wait for "joined" response
        while let Some(msg) = ws.stream.next().await {
            if let Ok(Message::Text(text)) = msg {
                let v: serde_json::Value = serde_json::from_str(&text).unwrap();
                if v["type"] == "joined" {
                    ws.node_id = Some(v["nodeId"].as_str().unwrap().to_string());
                    ws.name = Some(v["name"].as_str().unwrap().to_string());
                    ws.initial_peers = v["peers"].as_array().cloned().unwrap_or_default();
                    return ws;
                }
            }
        }
        panic!("WebSocket closed before receiving joined");
    }

    pub async fn connect_raw(ws_url: &str) -> Self {
        let (stream, _) = connect_async(ws_url).await.unwrap();
        let (sink, stream) = stream.split();
        Self {
            sink,
            stream,
            node_id: None,
            name: None,
            initial_peers: Vec::new(),
        }
    }

    pub async fn send_json(&mut self, value: &serde_json::Value) {
        let text = serde_json::to_string(value).unwrap();
        self.sink.send(Message::Text(text.into())).await.unwrap();
    }

    /// Receive next text message, returns None if stream ends
    pub async fn recv_json(&mut self) -> Option<serde_json::Value> {
        while let Some(msg) = self.stream.next().await {
            match msg {
                Ok(Message::Text(text)) => {
                    return Some(serde_json::from_str(&text).unwrap());
                }
                Ok(Message::Close(_)) => return None,
                Err(_) => return None,
                _ => continue,
            }
        }
        None
    }

    /// Collect all messages until a timeout (useful for verifying broadcast)
    pub async fn collect_messages(&mut self, timeout_ms: u64) -> Vec<serde_json::Value> {
        let mut messages = Vec::new();
        let deadline = tokio::time::Instant::now() + tokio::time::Duration::from_millis(timeout_ms);
        loop {
            let remaining = deadline.saturating_duration_since(tokio::time::Instant::now());
            if remaining.is_zero() {
                break;
            }
            tokio::select! {
                msg = self.stream.next() => {
                    match msg {
                        Some(Ok(Message::Text(text))) => {
                            if let Ok(v) = serde_json::from_str::<serde_json::Value>(&text) {
                                messages.push(v);
                            }
                        }
                        _ => break,
                    }
                }
                _ = tokio::time::sleep(remaining) => break,
            }
        }
        messages
    }
}
