mod common;

use common::TestApp;

#[tokio::test]
async fn health_returns_ok() {
    let app = TestApp::start().await;
    let resp = app.client()
        .get(&format!("{}/health", app.url()))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 200);
    let body: serde_json::Value = resp.json().await.unwrap();
    assert_eq!(body["status"], "ok");
}

#[tokio::test]
async fn favicon_returns_svg() {
    let app = TestApp::start().await;
    let resp = app.client()
        .get(&format!("{}/favicon.ico", app.url()))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 200);
    let ct = resp.headers().get("content-type").unwrap();
    assert_eq!(ct, "image/svg+xml");
}

#[tokio::test]
async fn non_existent_route_returns_404() {
    let app = TestApp::start().await;
    let resp = app.client()
        .get(&format!("{}/nonexistent-page", app.url()))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 404);
}

#[tokio::test]
async fn ws_endpoint_upgrade_succeeds() {
    let app = TestApp::start().await;
    // WsClient::connect will panic if upgrade fails
    let _ws = app.ws_connect().await;
    // If we get here, the WebSocket handshake succeeded
}
