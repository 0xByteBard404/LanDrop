use crate::node::{AppState, NodeEntry, NodeId, NodeInfo};
use axum::extract::ws::{Message, WebSocket};
use axum::extract::{State, WebSocketUpgrade};
use axum::response::IntoResponse;
use futures::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::sync::Arc;

pub const PROTOCOL_VERSION: u32 = 1;
pub const MAX_NAME_LENGTH: usize = 32;

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
    #[serde(rename = "maxFileSize")]
    max_file_size: u64,
    #[serde(rename = "maxTextSize")]
    max_text_size: u64,
    #[serde(rename = "protocolVersion")]
    protocol_version: u32,
    #[serde(rename = "maxNameLength")]
    max_name_length: usize,
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
    #[serde(rename = "transferId", skip_serializing_if = "Option::is_none")]
    transfer_id: Option<String>,
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
            transfer_id: None,
        };
        let _ = send_json(&mut sink, &err).await;
        return;
    }

    let node_id = join.node_id.unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
    let name = join.name.unwrap_or_else(crate::name_gen::generate_name);
    let session_id = uuid::Uuid::new_v4().to_string();

    // If the client reused an old nodeId, remove stale entry (same device refresh)
    let had_old = state.nodes.remove(&node_id);
    if had_old.is_some() {
        tracing::info!(node_id = %node_id, "移除旧条目（重连），剩余节点: {:?}", state.nodes.iter().map(|e| e.key().clone()).collect::<Vec<_>>());
    }

    // 3. Send joined response
    let joined = JoinedMsg {
        msg_type: "joined".into(),
        node_id: node_id.clone(),
        name: name.clone(),
        peers: state.get_peer_list(Some(&node_id)),
        max_file_size: state.max_file_size,
        max_text_size: state.max_text_size,
        protocol_version: PROTOCOL_VERSION,
        max_name_length: MAX_NAME_LENGTH,
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
    state.nodes.insert(node_id.clone(), NodeEntry { info, tx, session_id: session_id.clone() });

    tracing::info!(node_id = %node_id, online_count = state.nodes.len(), "注册完成，当前在线节点: {:?}", state.nodes.iter().map(|e| e.key().clone()).collect::<Vec<_>>());

    // 6. Broadcast updated peers list
    broadcast_peers(&state, &node_id);

    // 7. Main loop: handle incoming WS messages AND outgoing channel messages
    loop {
        tokio::select! {
            msg = stream.next() => {
                match msg {
                    Some(Ok(Message::Text(text))) => {
                        tracing::info!(node_id = %node_id, text = %text, "收到消息");
                        // Handle rename locally (no "to" field)
                        if let Ok(val) = serde_json::from_str::<Value>(&text) {
                            if val.get("type").and_then(|v| v.as_str()) == Some("rename") {
                                if let Some(new_name) = val.get("name").and_then(|v| v.as_str()) {
                                    let new_name = new_name.to_string();
                                    if !new_name.is_empty() && new_name.len() <= MAX_NAME_LENGTH {
                                        if let Some(mut entry) = state.nodes.get_mut(&node_id) {
                                            entry.value_mut().info.name = new_name.clone();
                                        }
                                        tracing::info!(node_id = %node_id, name = %new_name, "设备重命名");
                                        broadcast_peers(&state, &node_id);
                                        // Also update the node_id variable for cleanup log
                                    }
                                }
                                continue;
                            }
                            // Handle chat: broadcast to all other nodes
                            if val.get("type").and_then(|v| v.as_str()) == Some("chat") {
                                if let Some(content) = val.get("content").and_then(|v| v.as_str()) {
                                    if content.len() as u64 > state.max_text_size {
                                        let err = ErrorMsg {
                                            msg_type: "error".into(),
                                            code: "text_too_long".into(),
                                            message: format!("Chat text length {} exceeds maximum {} bytes", content.len(), state.max_text_size),
                                            transfer_id: None,
                                        };
                                        let _ = state.send_to(&node_id, &serde_json::to_string(&err).unwrap());
                                        continue;
                                    }
                                }
                                let mut chat_msg = val.clone();
                                chat_msg["from"] = Value::String(node_id.clone());
                                chat_msg["name"] = Value::String(
                                    state.nodes.get(&node_id).map(|e| e.info.name.clone()).unwrap_or_default()
                                );
                                let chat_str = serde_json::to_string(&chat_msg).unwrap();
                                state.broadcast(&chat_str, None);
                                tracing::info!(node_id = %node_id, "广播聊天消息");
                                continue;
                            }
                        }
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

    // 8. Cleanup on disconnect (only if this session still owns the entry)
    let removed = state.nodes.remove_if(&node_id, |_, entry| entry.session_id == session_id);
    if removed.is_some() {
        tracing::info!(node_id = %node_id, name = %name, "节点离线");

        let leave = LeaveMsg {
            msg_type: "leave".into(),
            node_id: node_id.clone(),
        };
        let leave_str = serde_json::to_string(&leave).unwrap();
        state.broadcast(&leave_str, Some(&node_id));
        broadcast_peers(&state, &node_id);
    } else {
        tracing::info!(node_id = %node_id, "旧会话断开，跳过清理（已被新会话替代）");
    }
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
                    transfer_id: value
                        .get("transferId")
                        .and_then(|v| v.as_str())
                        .map(|s| s.to_string()),
                };
                let _ = state.send_to(from_id, &serde_json::to_string(&err).unwrap());
                return;
            }
        }
    }

    // Validate text length for send-text messages (max 1MB)
    if msg_type == "send-text" {
        if let Some(content) = value.get("content").and_then(|v| v.as_str()) {
            if content.len() as u64 > state.max_text_size {
                let err = ErrorMsg {
                    msg_type: "error".into(),
                    code: "text_too_long".into(),
                    message: format!(
                        "Text length {} exceeds maximum {} bytes",
                        content.len(),
                        state.max_text_size
                    ),
                    transfer_id: None,
                };
                let _ = state.send_to(from_id, &serde_json::to_string(&err).unwrap());
                return;
            }
        }
    }

    let msg_str = serde_json::to_string(&value).unwrap();

    tracing::info!(from = %from_id, target = %target, msg_type = %msg_type, "路由消息");

    if !state.send_to(&target, &msg_str) {
        tracing::warn!(target = %target, from = %from_id, "目标节点不存在, 当前在线: {:?}", state.nodes.iter().map(|e| e.key().clone()).collect::<Vec<_>>());
        let err = ErrorMsg {
            msg_type: "error".into(),
            code: "target_not_found".into(),
            message: format!("Node {} not found", target),
            transfer_id: None,
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::node::NodeEntry;
    use tokio::sync::mpsc;

    fn make_node(id: &str, name: &str) -> (NodeEntry, mpsc::UnboundedReceiver<String>) {
        let (tx, rx) = mpsc::unbounded_channel();
        let entry = NodeEntry {
            info: crate::node::NodeInfo {
                id: id.to_string(),
                name: name.to_string(),
            },
            tx,
            session_id: uuid::Uuid::new_v4().to_string(),
        };
        (entry, rx)
    }

    #[tokio::test]
    async fn route_message_valid() {
        let state = AppState::new(1024 * 1024, 1024);
        let (entry, mut rx) = make_node("target", "Cat");
        state.nodes.insert("target".to_string(), entry);

        let msg = r#"{"type":"chat","to":"target","content":"hi"}"#;
        route_message(&state, &"sender".to_string(), msg).await;

        let received = rx.try_recv().unwrap();
        let v: Value = serde_json::from_str(&received).unwrap();
        assert_eq!(v["type"], "chat");
        assert_eq!(v["to"], "target");
        assert_eq!(v["from"], "sender"); // force-replaced
    }

    #[tokio::test]
    async fn route_message_force_replaces_from() {
        let state = AppState::new(1024 * 1024, 1024);
        let (entry, mut rx) = make_node("target", "Cat");
        state.nodes.insert("target".to_string(), entry);

        // Client tries to spoof from field
        let msg = r#"{"type":"offer-file","to":"target","from":"spoofed","fileName":"test.txt","fileSize":100}"#;
        route_message(&state, &"real_sender".to_string(), msg).await;

        let received = rx.try_recv().unwrap();
        let v: Value = serde_json::from_str(&received).unwrap();
        assert_eq!(v["from"], "real_sender");
    }

    #[tokio::test]
    async fn route_message_invalid_json_ignored() {
        let state = AppState::new(1024 * 1024, 1024);
        let (entry, mut rx) = make_node("target", "Cat");
        state.nodes.insert("target".to_string(), entry);

        route_message(&state, &"sender".to_string(), "not json").await;
        assert!(rx.try_recv().is_err());
    }

    #[tokio::test]
    async fn route_message_no_to_field_ignored() {
        let state = AppState::new(1024 * 1024, 1024);
        let (entry, mut rx) = make_node("target", "Cat");
        state.nodes.insert("target".to_string(), entry);

        let msg = r#"{"type":"chat","content":"hi"}"#;
        route_message(&state, &"sender".to_string(), msg).await;
        assert!(rx.try_recv().is_err());
    }

    #[tokio::test]
    async fn route_message_file_too_large() {
        let state = AppState::new(100, 1024); // max file 100 bytes
        let (sender_entry, mut sender_rx) = make_node("sender", "Fox");
        state.nodes.insert("sender".to_string(), sender_entry);

        let msg = r#"{"type":"offer-file","to":"target","transferId":"t-123","fileSize":200}"#;
        route_message(&state, &"sender".to_string(), msg).await;

        let err_msg = sender_rx.try_recv().unwrap();
        let v: Value = serde_json::from_str(&err_msg).unwrap();
        assert_eq!(v["type"], "error");
        assert_eq!(v["code"], "file_too_large");
        // transferId must be echoed back so the client can locate the transfer card
        assert_eq!(v["transferId"], "t-123");
    }

    #[tokio::test]
    async fn route_message_text_too_long() {
        let state = AppState::new(1024 * 1024, 10); // max text 10 bytes
        let (sender_entry, mut sender_rx) = make_node("sender", "Fox");
        state.nodes.insert("sender".to_string(), sender_entry);

        let long_text = "a".repeat(20);
        let msg = &format!(r#"{{"type":"send-text","to":"target","content":"{}"}}"#, long_text);
        route_message(&state, &"sender".to_string(), msg).await;

        let err_msg = sender_rx.try_recv().unwrap();
        let v: Value = serde_json::from_str(&err_msg).unwrap();
        assert_eq!(v["type"], "error");
        assert_eq!(v["code"], "text_too_long");
    }

    #[tokio::test]
    async fn route_message_target_not_found() {
        let state = AppState::new(1024 * 1024, 1024);
        let (sender_entry, mut sender_rx) = make_node("sender", "Fox");
        state.nodes.insert("sender".to_string(), sender_entry);

        let msg = r#"{"type":"chat","to":"ghost","content":"hi"}"#;
        route_message(&state, &"sender".to_string(), msg).await;

        let err_msg = sender_rx.try_recv().unwrap();
        let v: Value = serde_json::from_str(&err_msg).unwrap();
        assert_eq!(v["type"], "error");
        assert_eq!(v["code"], "target_not_found");
    }

    #[tokio::test]
    async fn broadcast_peers_sends_to_all_except_excluded() {
        let state = AppState::new(1024 * 1024, 1024);
        let (e1, mut rx1) = make_node("n1", "Fox");
        let (e2, mut rx2) = make_node("n2", "Cat");
        let (e3, mut rx3) = make_node("n3", "Dog");
        state.nodes.insert("n1".to_string(), e1);
        state.nodes.insert("n2".to_string(), e2);
        state.nodes.insert("n3".to_string(), e3);

        broadcast_peers(&state, &"n1".to_string());

        // n1 excluded, should not receive
        assert!(rx1.try_recv().is_err());

        // n2 receives peers list excluding itself (contains n1 and n3)
        let msg2: Value = serde_json::from_str(&rx2.try_recv().unwrap()).unwrap();
        assert_eq!(msg2["type"], "peers");
        let list2 = msg2["list"].as_array().unwrap();
        assert_eq!(list2.len(), 2); // n1 and n3 (n2 excluded from its own list)
        let ids2: Vec<&str> = list2.iter().map(|v| v["id"].as_str().unwrap()).collect();
        assert!(ids2.contains(&"n1"));
        assert!(ids2.contains(&"n3"));

        // n3 receives peers list excluding itself (contains n1 and n2)
        let msg3: Value = serde_json::from_str(&rx3.try_recv().unwrap()).unwrap();
        let list3 = msg3["list"].as_array().unwrap();
        assert_eq!(list3.len(), 2);
        let ids3: Vec<&str> = list3.iter().map(|v| v["id"].as_str().unwrap()).collect();
        assert!(ids3.contains(&"n1"));
        assert!(ids3.contains(&"n2"));
    }

    #[test]
    fn join_payload_deserialize() {
        let json = r#"{"type":"join","name":"Fox","nodeId":"abc","protocolVersion":1}"#;
        let payload: JoinPayload = serde_json::from_str(json).unwrap();
        assert_eq!(payload.name, Some("Fox".to_string()));
        assert_eq!(payload.node_id, Some("abc".to_string()));
        assert_eq!(payload.protocol_version, Some(1));
    }

    #[test]
    fn join_payload_minimal() {
        let json = r#"{"type":"join"}"#;
        let payload: JoinPayload = serde_json::from_str(json).unwrap();
        assert!(payload.name.is_none());
        assert!(payload.node_id.is_none());
        assert!(payload.protocol_version.is_none());
    }

    #[test]
    fn joined_msg_serializes_correctly() {
        let msg = JoinedMsg {
            msg_type: "joined".into(),
            node_id: "abc".into(),
            name: "Fox".into(),
            peers: vec![crate::node::NodeInfo {
                id: "other".into(),
                name: "Cat".into(),
            }],
            max_file_size: 1024,
            max_text_size: 512,
            protocol_version: 1,
            max_name_length: 32,
        };
        let json = serde_json::to_string(&msg).unwrap();
        let v: Value = serde_json::from_str(&json).unwrap();
        assert_eq!(v["type"], "joined");
        assert_eq!(v["nodeId"], "abc");
        assert_eq!(v["name"], "Fox");
        assert_eq!(v["maxFileSize"], 1024);
        assert_eq!(v["maxTextSize"], 512);
        assert_eq!(v["protocolVersion"], 1);
    }
}
