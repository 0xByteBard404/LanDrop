use dashmap::DashMap;
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tokio::sync::mpsc;

pub type NodeId = String;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NodeInfo {
    pub id: NodeId,
    pub name: String,
}

pub struct NodeEntry {
    pub info: NodeInfo,
    pub tx: mpsc::UnboundedSender<String>,
    pub session_id: String,
}

pub struct AppState {
    pub nodes: DashMap<NodeId, NodeEntry>,
    pub max_file_size: u64,
    pub max_text_size: u64,
    pub ice_servers: String,
}

impl AppState {
    pub fn new(max_file_size: u64, max_text_size: u64, ice_servers: String) -> Arc<Self> {
        Arc::new(Self {
            nodes: DashMap::new(),
            max_file_size,
            max_text_size,
            ice_servers,
        })
    }

    pub fn get_peer_list(&self, exclude: Option<&NodeId>) -> Vec<NodeInfo> {
        self.nodes
            .iter()
            .filter(|entry| exclude.is_none_or(|id| entry.key() != id))
            .map(|entry| entry.value().info.clone())
            .collect()
    }

    pub fn send_to(&self, target: &NodeId, msg: &str) -> bool {
        if let Some(entry) = self.nodes.get(target) {
            entry.tx.send(msg.to_string()).is_ok()
        } else {
            false
        }
    }

    pub fn broadcast(&self, msg: &str, exclude: Option<&NodeId>) {
        for entry in self.nodes.iter() {
            if exclude.is_none_or(|id| entry.key() != id) {
                let _ = entry.value().tx.send(msg.to_string());
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_node(id: &str, name: &str) -> (NodeEntry, mpsc::UnboundedReceiver<String>) {
        let (tx, rx) = mpsc::unbounded_channel();
        let entry = NodeEntry {
            info: NodeInfo {
                id: id.to_string(),
                name: name.to_string(),
            },
            tx,
            session_id: uuid::Uuid::new_v4().to_string(),
        };
        (entry, rx)
    }

    #[test]
    fn new_app_state_has_no_nodes() {
        let state = AppState::new(1024, 1024, "[]".to_string());
        assert_eq!(state.nodes.len(), 0);
    }

    #[test]
    fn get_peer_list_empty() {
        let state = AppState::new(1024, 1024, "[]".to_string());
        let list = state.get_peer_list(None);
        assert!(list.is_empty());
    }

    #[test]
    fn add_node_and_get_peer_list() {
        let state = AppState::new(1024, 1024, "[]".to_string());
        let (entry, _rx) = make_node("n1", "Fox");
        state.nodes.insert("n1".to_string(), entry);

        let list = state.get_peer_list(None);
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].id, "n1");
        assert_eq!(list[0].name, "Fox");
    }

    #[test]
    fn get_peer_list_exclude_self() {
        let state = AppState::new(1024, 1024, "[]".to_string());
        let (e1, _) = make_node("n1", "Fox");
        let (e2, _) = make_node("n2", "Cat");
        state.nodes.insert("n1".to_string(), e1);
        state.nodes.insert("n2".to_string(), e2);

        let list = state.get_peer_list(Some(&"n1".to_string()));
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].id, "n2");
    }

    #[test]
    fn send_to_existing_node() {
        let state = AppState::new(1024, 1024, "[]".to_string());
        let (entry, mut rx) = make_node("n1", "Fox");
        state.nodes.insert("n1".to_string(), entry);

        assert!(state.send_to(&"n1".to_string(), "hello"));
        let msg = rx.try_recv().unwrap();
        assert_eq!(msg, "hello");
    }

    #[test]
    fn send_to_nonexistent_node() {
        let state = AppState::new(1024, 1024, "[]".to_string());
        assert!(!state.send_to(&"ghost".to_string(), "hello"));
    }

    #[test]
    fn broadcast_to_all() {
        let state = AppState::new(1024, 1024, "[]".to_string());
        let (e1, mut rx1) = make_node("n1", "Fox");
        let (e2, mut rx2) = make_node("n2", "Cat");
        state.nodes.insert("n1".to_string(), e1);
        state.nodes.insert("n2".to_string(), e2);

        state.broadcast("ping", None);
        assert_eq!(rx1.try_recv().unwrap(), "ping");
        assert_eq!(rx2.try_recv().unwrap(), "ping");
    }

    #[test]
    fn broadcast_exclude_one() {
        let state = AppState::new(1024, 1024, "[]".to_string());
        let (e1, mut rx1) = make_node("n1", "Fox");
        let (e2, mut rx2) = make_node("n2", "Cat");
        state.nodes.insert("n1".to_string(), e1);
        state.nodes.insert("n2".to_string(), e2);

        state.broadcast("ping", Some(&"n1".to_string()));
        assert!(rx1.try_recv().is_err(), "被排除的节点不应收到消息");
        assert_eq!(rx2.try_recv().unwrap(), "ping");
    }

    #[test]
    fn remove_node() {
        let state = AppState::new(1024, 1024, "[]".to_string());
        let (entry, _) = make_node("n1", "Fox");
        state.nodes.insert("n1".to_string(), entry);
        assert_eq!(state.nodes.len(), 1);

        state.nodes.remove(&"n1".to_string());
        assert_eq!(state.nodes.len(), 0);
        let list = state.get_peer_list(None);
        assert!(list.is_empty());
    }

    #[test]
    fn session_id_isolation() {
        let state = AppState::new(1024, 1024, "[]".to_string());

        // First session
        let (e1, _) = make_node("n1", "Fox");
        let sid1 = e1.session_id.clone();
        state.nodes.insert("n1".to_string(), e1);

        // Reconnect: remove old, insert new with same nodeId
        let (e2, _) = make_node("n1", "Fox2");
        let sid2 = e2.session_id.clone();
        state.nodes.remove(&"n1".to_string());
        state.nodes.insert("n1".to_string(), e2);

        // Only new session should exist
        assert_eq!(state.nodes.len(), 1);
        let entry = state.nodes.get("n1").unwrap();
        assert_eq!(entry.session_id, sid2);
        assert_ne!(sid1, sid2);
    }

    #[test]
    fn remove_if_session_matches() {
        let state = AppState::new(1024, 1024, "[]".to_string());
        let (entry, _) = make_node("n1", "Fox");
        let sid = entry.session_id.clone();
        state.nodes.insert("n1".to_string(), entry);

        // remove_if with matching session_id succeeds
        let removed = state
            .nodes
            .remove_if(&"n1".to_string(), |_, e| e.session_id == sid);
        assert!(removed.is_some());
        assert_eq!(state.nodes.len(), 0);
    }

    #[test]
    fn remove_if_session_mismatch() {
        let state = AppState::new(1024, 1024, "[]".to_string());
        let (entry, _) = make_node("n1", "Fox");
        state.nodes.insert("n1".to_string(), entry);

        // remove_if with wrong session_id does nothing
        let removed = state
            .nodes
            .remove_if(&"n1".to_string(), |_, e| e.session_id == "wrong");
        assert!(removed.is_none());
        assert_eq!(state.nodes.len(), 1);
    }
}
