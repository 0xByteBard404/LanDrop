use crate::node::{AppState, NodeEntry, NodeId, NodeInfo};
use axum::extract::ws::{Message, WebSocket};
use axum::extract::{State, WebSocketUpgrade};
use axum::response::IntoResponse;
use futures::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::sync::Arc;

const PROTOCOL_VERSION: u32 = 1;

// --- Message structs ---

#[derive(Deserialize)]
struct JoinPayload {
    name: Option<String>,
    #[serde(rename = "nodeId")]
    node_id: Option<String>,
    #[serde(rename = "protocolVersion")]
    protocol_version: Option<u32>,
}

#[derive(Serialize)]
struct JoinedMsg {
    #[serde(rename = "type")]
    msg_type: String,
    #[serde(rename = "nodeId")]
    node_id: String,
    name: String,
    peers: Vec<NodeInfo>,
}

#[derive(Serialize)]
struct PeersMsg {
    #[serde(rename = "type")]
    msg_type: String,
    list: Vec<NodeInfo>,
}

#[derive(Serialize)]
struct LeaveMsg {
    #[serde(rename = "type")]
    msg_type: String,
    #[serde(rename = "nodeId")]
    node_id: String,
}

#[derive(Serialize)]
struct ErrorMsg {
    #[serde(rename = "type")]
    msg_type: String,
    code: String,
    message: String,
}

// --- WebSocket handler ---

pub async fn ws_handler(
    ws: WebSocketUpgrade,
    State(state): State<Arc<AppState>>,
) -> impl IntoResponse {
    ws.on_upgrade(move |socket| handle_socket(socket, state))
}

async fn handle_socket(socket: WebSocket, state: Arc<AppState>) {
    let (mut sink, mut stream) = socket.split();

    // 1. Wait for join message (10s timeout)
    let join = match wait_for_join(&mut stream).await {
        Some(j) => j,
        None => return,
    };

    // 2. Protocol version check
    if join.protocol_version.unwrap_or(0) != PROTOCOL_VERSION {
        let err = ErrorMsg {
            msg_type: "error".into(),
            code: "protocol_version_mismatch".into(),
            message: format!("Expected protocol version {}", PROTOCOL_VERSION),
        };
        let _ = send_json(&mut sink, &err).await;
        return;
    }

    let node_id = join.node_id.unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
    let name = join.name.unwrap_or_else(crate::name_gen::generate_name);

    // If the client reused an old nodeId, remove stale entry (same device refresh)
    if state.nodes.remove(&node_id).is_some() {
        tracing::info!(node_id = %node_id, "移除旧条目（重连）");
    }

    // 3. Send joined response
    let joined = JoinedMsg {
        msg_type: "joined".into(),
        node_id: node_id.clone(),
        name: name.clone(),
        peers: state.get_peer_list(Some(&node_id)),
    };
    if send_json(&mut sink, &joined).await.is_err() {
        return;
    }

    tracing::info!(node_id = %node_id, name = %name, "节点上线");

    // 4. Create channel for outbound messages
    let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel::<String>();

    // 5. Register node
    let info = NodeInfo {
        id: node_id.clone(),
        name: name.clone(),
    };
    state.nodes.insert(node_id.clone(), NodeEntry { info, tx });

    // 6. Broadcast updated peers list
    broadcast_peers(&state, &node_id);

    // 7. Main loop: handle incoming WS messages AND outgoing channel messages
    loop {
        tokio::select! {
            msg = stream.next() => {
                match msg {
                    Some(Ok(Message::Text(text))) => {
                        tracing::info!(node_id = %node_id, text = %text, "收到消息");
                        route_message(&state, &node_id, &text).await;
                    }
                    Some(Ok(Message::Close(reason))) => {
                        tracing::info!(node_id = %node_id, ?reason, "收到 Close 帧");
                        break;
                    }
                    Some(Ok(_)) => {}
                    Some(Err(e)) => {
                        tracing::info!(node_id = %node_id, error = ?e, "WebSocket 读取错误");
                        break;
                    }
                    None => {
                        tracing::info!(node_id = %node_id, "WebSocket 流结束 (None)");
                        break;
                    }
                }
            }
            text = rx.recv() => {
                match text {
                    Some(text) => {
                        if sink.send(Message::Text(text.into())).await.is_err() {
                            break;
                        }
                    }
                    None => break,
                }
            }
        }
    }

    // 8. Cleanup on disconnect
    state.nodes.remove(&node_id);
    tracing::info!(node_id = %node_id, name = %name, "节点离线");

    let leave = LeaveMsg {
        msg_type: "leave".into(),
        node_id: node_id.clone(),
    };
    let leave_str = serde_json::to_string(&leave).unwrap();
    state.broadcast(&leave_str, Some(&node_id));
    broadcast_peers(&state, &node_id);
}

async fn wait_for_join(
    stream: &mut futures::stream::SplitStream<WebSocket>,
) -> Option<JoinPayload> {
    let result = tokio::time::timeout(std::time::Duration::from_secs(10), async {
        while let Some(msg) = stream.next().await {
            if let Ok(Message::Text(text)) = msg {
                if let Ok(value) = serde_json::from_str::<Value>(&text) {
                    if value.get("type").and_then(|v| v.as_str()) == Some("join") {
                        if let Ok(payload) = serde_json::from_value::<JoinPayload>(value) {
                            return Some(payload);
                        }
                    }
                }
            }
        }
        None
    })
    .await;

    result.unwrap_or(None)
}

async fn route_message(state: &Arc<AppState>, from_id: &NodeId, text: &str) {
    let mut value: Value = match serde_json::from_str(text) {
        Ok(v) => v,
        Err(e) => {
            tracing::warn!(raw = %text, error = %e, "畸形消息");
            return;
        }
    };

    // Force replace from field
    value["from"] = Value::String(from_id.clone());

    let target = match value.get("to").and_then(|v| v.as_str()) {
        Some(t) => t.to_string(),
        None => {
            tracing::warn!(from = %from_id, "消息缺少 to 字段");
            return;
        }
    };

    // Validate file size for offer-file messages
    let msg_type = value.get("type").and_then(|v| v.as_str()).unwrap_or("");
    if msg_type == "offer-file" {
        if let Some(file_size) = value.get("fileSize").and_then(|v| v.as_u64()) {
            if file_size > state.max_file_size {
                let err = ErrorMsg {
                    msg_type: "error".into(),
                    code: "file_too_large".into(),
                    message: format!(
                        "File size {} exceeds maximum {} bytes",
                        file_size, state.max_file_size
                    ),
                };
                let _ = state.send_to(from_id, &serde_json::to_string(&err).unwrap());
                return;
            }
        }
    }

    let msg_str = serde_json::to_string(&value).unwrap();

    if !state.send_to(&target, &msg_str) {
        tracing::warn!(target = %target, from = %from_id, "目标节点不存在");
        let err = ErrorMsg {
            msg_type: "error".into(),
            code: "target_not_found".into(),
            message: format!("Node {} not found", target),
        };
        let _ = state.send_to(from_id, &serde_json::to_string(&err).unwrap());
    }
}

fn broadcast_peers(state: &Arc<AppState>, exclude: &NodeId) {
    let all_ids: Vec<NodeId> = state.nodes.iter().map(|e| e.key().clone()).collect();

    for node_id in &all_ids {
        if node_id == exclude {
            continue;
        }
        let list = state.get_peer_list(Some(node_id));
        let peers = PeersMsg {
            msg_type: "peers".into(),
            list,
        };
        let msg = serde_json::to_string(&peers).unwrap();
        let _ = state.send_to(node_id, &msg);
    }
}

async fn send_json<T: Serialize>(
    sink: &mut futures::stream::SplitSink<WebSocket, Message>,
    data: &T,
) -> Result<(), ()> {
    let text = serde_json::to_string(data).map_err(|_| ())?;
    sink.send(Message::Text(text.into())).await.map_err(|_| ())
}
