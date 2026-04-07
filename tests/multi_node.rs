mod common;

use common::TestApp;

#[tokio::test]
async fn three_nodes_see_each_other() {
    let app = TestApp::start().await;

    let _ws1 = app.ws_connect().await;
    let _ws2 = app.ws_connect().await;
    let ws3 = app.ws_connect().await;

    // ws3 gets peer list in "joined" response containing ws1 and ws2
    assert_eq!(ws3.initial_peers.len(), 2, "ws3 should see 2 other nodes");
}

#[tokio::test]
async fn node_leave_updates_peers_for_remaining() {
    let app = TestApp::start().await;

    let ws1 = app.ws_connect().await;
    let mut ws2 = app.ws_connect().await;
    let ws3 = app.ws_connect().await;

    let _ = ws2.collect_messages(200).await;

    drop(ws3);

    let msgs = ws2.collect_messages(1000).await;
    assert!(msgs.iter().any(|m| m["type"] == "leave"));

    let peers_msgs: Vec<_> = msgs.iter().filter(|m| m["type"] == "peers").collect();
    assert!(!peers_msgs.is_empty());
    let last = peers_msgs.last().unwrap();
    let list = last["list"].as_array().unwrap();
    assert_eq!(list.len(), 1);
    assert_eq!(list[0]["id"].as_str(), ws1.node_id.as_deref());
}

#[tokio::test]
async fn same_device_reconnect_session_isolation() {
    let app = TestApp::start().await;

    let mut ws1_old = app.ws_connect_with(None, Some("device-1"), Some(1)).await;
    while let Some(msg) = ws1_old.recv_json().await {
        if msg["type"] == "joined" { break; }
    }

    let mut ws2 = app.ws_connect().await;
    let _ = ws2.collect_messages(200).await;

    let mut ws1_new = app.ws_connect_with(None, Some("device-1"), Some(1)).await;
    while let Some(msg) = ws1_new.recv_json().await {
        if msg["type"] == "joined" { break; }
    }

    drop(ws1_old);

    let msgs = ws2.collect_messages(1000).await;

    let peers_msgs: Vec<_> = msgs.iter().filter(|m| m["type"] == "peers").collect();
    assert!(!peers_msgs.is_empty(), "should receive peers update after reconnect");

    assert_eq!(app.state.nodes.len(), 2);
}

#[tokio::test]
async fn concurrent_connections() {
    let app = TestApp::start().await;

    let mut handles = Vec::new();
    for _ in 0..10 {
        let url = app.ws_url();
        handles.push(tokio::spawn(async move {
            common::WsClient::connect(&url).await
        }));
    }

    let mut clients = Vec::new();
    for handle in handles {
        clients.push(handle.await.unwrap());
    }

    assert_eq!(app.state.nodes.len(), 10);

    let ids: std::collections::HashSet<&str> = clients
        .iter()
        .filter_map(|c| c.node_id.as_deref())
        .collect();
    assert_eq!(ids.len(), 10, "all nodeIds should be unique");
}

#[tokio::test]
async fn message_between_specific_peers() {
    let app = TestApp::start().await;

    let ws1 = app.ws_connect().await;
    let mut ws2 = app.ws_connect().await;
    let mut ws3 = app.ws_connect().await;

    let _ = ws2.collect_messages(200).await;
    let _ = ws3.collect_messages(200).await;

    let mut ws1 = ws1;
    ws1.send_json(&serde_json::json!({
        "type": "send-text",
        "to": ws2.node_id.as_deref().unwrap(),
        "content": "private message"
    })).await;

    let msgs2 = ws2.collect_messages(500).await;
    assert!(msgs2.iter().any(|m| m["type"] == "send-text" && m["content"] == "private message"));

    let msgs3 = ws3.collect_messages(300).await;
    assert!(
        !msgs3.iter().any(|m| m["type"] == "send-text" && m["content"] == "private message"),
        "ws3 should not receive direct message between ws1 and ws2"
    );
}
