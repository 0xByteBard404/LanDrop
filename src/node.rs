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
}

pub struct AppState {
    pub nodes: DashMap<NodeId, NodeEntry>,
    pub max_file_size: u64,
}

impl AppState {
    pub fn new(max_file_size: u64) -> Arc<Self> {
        Arc::new(Self {
            nodes: DashMap::new(),
            max_file_size,
        })
    }

    pub fn get_peer_list(&self, exclude: Option<&NodeId>) -> Vec<NodeInfo> {
        self.nodes
            .iter()
            .filter(|entry| exclude.map_or(true, |id| entry.key() != id))
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
            if exclude.map_or(true, |id| entry.key() != id) {
                let _ = entry.value().tx.send(msg.to_string());
            }
        }
    }
}
