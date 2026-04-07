mod common;

use common::TestApp;

#[tokio::test]
async fn join_handshake_returns_joined() {
    let app = TestApp::start().await;
    let ws = app.ws_connect().await;

    assert!(ws.node_id.is_some(), "should receive nodeId");
    assert!(ws.name.is_some(), "should receive name");
    assert!(!ws.node_id.as_ref().unwrap().is_empty());
    assert!(!ws.name.as_ref().unwrap().is_empty());
}

#[tokio::test]
async fn join_with_custom_name() {
    let app = TestApp::start().await;
    let ws = app.ws_connect_with(Some("TestDevice"), None, Some(1)).await;

    let mut ws = ws;
    while let Some(msg) = ws.recv_json().await {
        if msg["type"] == "joined" {
            assert_eq!(msg["name"].as_str(), Some("TestDevice"));
            return;
        }
    }
    panic!("Did not receive joined message");
}

#[tokio::test]
async fn join_with_wrong_protocol_version_rejected() {
    let app = TestApp::start().await;
    let mut ws = app.ws_connect_with(None, None, Some(999)).await;

    let msg = ws.recv_json().await.expect("should receive a message");
    assert_eq!(msg["type"].as_str(), Some("error"));
    assert_eq!(msg["code"].as_str(), Some("protocol_version_mismatch"));
}

#[tokio::test]
async fn second_node_receives_peer_list_in_joined() {
    let app = TestApp::start().await;

    let ws1 = app.ws_connect().await;
    let ws2 = app.ws_connect().await;

    // ws2 gets peer list in the "joined" response (initial_peers)
    assert_eq!(ws2.initial_peers.len(), 1);
    assert_eq!(ws2.initial_peers[0]["id"].as_str(), ws1.node_id.as_deref());
}

#[tokio::test]
async fn existing_node_receives_peers_when_new_joins() {
    let app = TestApp::start().await;

    let mut ws1 = app.ws_connect().await;
    let _ws2 = app.ws_connect().await;

    // ws1 should receive a "peers" message about ws2 joining
    let msgs = ws1.collect_messages(500).await;
    assert!(
        msgs.iter().any(|m| m["type"] == "peers"),
        "ws1 should receive peers update when ws2 joins"
    );
}

#[tokio::test]
async fn node_rename_broadcasts_peers() {
    let app = TestApp::start().await;

    let ws1 = app.ws_connect().await;
    let mut ws2 = app.ws_connect().await;

    let _ = ws2.collect_messages(200).await;

    let mut ws1 = ws1;
    ws1.send_json(&serde_json::json!({
        "type": "rename",
        "name": "NewName"
    })).await;

    let msgs = ws2.collect_messages(500).await;
    let peers_msg = msgs.iter().find(|m| m["type"] == "peers");
    assert!(peers_msg.is_some(), "ws2 should receive peers after rename");
    let list = peers_msg.unwrap()["list"].as_array().unwrap();
    let ws1_id = ws1.node_id.as_deref().unwrap();
    let renamed = list.iter().find(|p| p["id"].as_str() == Some(ws1_id));
    assert!(renamed.is_some());
    assert_eq!(renamed.unwrap()["name"].as_str(), Some("NewName"));
}

#[tokio::test]
async fn chat_message_broadcasts_to_all() {
    let app = TestApp::start().await;

    let mut ws1 = app.ws_connect().await;
    let mut ws2 = app.ws_connect().await;
    let mut ws3 = app.ws_connect().await;

    let _ = ws1.collect_messages(200).await;
    let _ = ws2.collect_messages(200).await;
    let _ = ws3.collect_messages(200).await;

    ws2.send_json(&serde_json::json!({
        "type": "chat",
        "content": "Hello everyone!"
    })).await;

    let msgs1 = ws1.collect_messages(500).await;
    let msgs3 = ws3.collect_messages(500).await;

    assert!(msgs1.iter().any(|m| m["type"] == "chat" && m["content"] == "Hello everyone!"));
    assert!(msgs3.iter().any(|m| m["type"] == "chat" && m["content"] == "Hello everyone!"));
}

#[tokio::test]
async fn disconnect_broadcasts_leave() {
    let app = TestApp::start().await;

    let ws1 = app.ws_connect().await;
    let mut ws2 = app.ws_connect().await;

    let _ = ws2.collect_messages(200).await;

    drop(ws1);

    let msgs = ws2.collect_messages(1000).await;
    assert!(
        msgs.iter().any(|m| m["type"] == "leave"),
        "should receive leave message when node disconnects"
    );
    assert!(
        msgs.iter().any(|m| m["type"] == "peers"),
        "should receive updated peers list"
    );
}

#[tokio::test]
async fn file_offer_routed_to_target() {
    let app = TestApp::start().await;

    let ws1 = app.ws_connect().await;
    let mut ws2 = app.ws_connect().await;

    let _ = ws2.collect_messages(200).await;

    let mut ws1 = ws1;
    ws1.send_json(&serde_json::json!({
        "type": "offer-file",
        "to": ws2.node_id.as_deref().unwrap(),
        "fileName": "test.txt",
        "fileSize": 100
    })).await;

    let msgs = ws2.collect_messages(500).await;
    assert!(msgs.iter().any(|m| m["type"] == "offer-file" && m["fileName"] == "test.txt"));
}

#[tokio::test]
async fn file_too_large_rejected() {
    let app = TestApp::start_with_limits(100, 1024).await;

    let mut ws = app.ws_connect().await;

    ws.send_json(&serde_json::json!({
        "type": "offer-file",
        "to": "ghost",
        "fileName": "big.bin",
        "fileSize": 200
    })).await;

    let msgs = ws.collect_messages(500).await;
    assert!(msgs.iter().any(|m| m["type"] == "error" && m["code"] == "file_too_large"));
}

#[tokio::test]
async fn direct_message_to_unknown_target() {
    let app = TestApp::start().await;

    let mut ws = app.ws_connect().await;

    ws.send_json(&serde_json::json!({
        "type": "offer-file",
        "to": "nonexistent",
        "fileName": "test.txt",
        "fileSize": 10
    })).await;

    let msgs = ws.collect_messages(500).await;
    assert!(msgs.iter().any(|m| m["type"] == "error" && m["code"] == "target_not_found"));
}

#[tokio::test]
async fn from_field_is_force_replaced() {
    let app = TestApp::start().await;

    let ws1 = app.ws_connect().await;
    let mut ws2 = app.ws_connect().await;

    let _ = ws2.collect_messages(200).await;

    let mut ws1 = ws1;
    ws1.send_json(&serde_json::json!({
        "type": "offer-file",
        "to": ws2.node_id.as_deref().unwrap(),
        "from": "spoofed-id",
        "fileName": "test.txt",
        "fileSize": 10
    })).await;

    let msgs = ws2.collect_messages(500).await;
    let offer = msgs.iter().find(|m| m["type"] == "offer-file");
    assert!(offer.is_some());
    assert_eq!(
        offer.unwrap()["from"].as_str(),
        ws1.node_id.as_deref(),
        "from field should be force-replaced with real sender id"
    );
}
