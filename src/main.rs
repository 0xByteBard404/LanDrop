use clap::Parser;
use tracing_subscriber::EnvFilter;

fn main() {
    let config = lan_drop::config::Config::parse();

    tracing_subscriber::fmt()
        .with_env_filter(
            EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| EnvFilter::new(config.log_level.as_ref())),
        )
        .init();

    let rt = tokio::runtime::Runtime::new().expect("Failed to create tokio runtime");
    let (_lan_url, shutdown_tx, server_handle) = rt.block_on(lan_drop::server::run_server(config));

    tracing::info!("按 Ctrl+C 优雅退出");

    // Wait for Ctrl+C
    rt.block_on(async {
        tokio::signal::ctrl_c().await.unwrap();
    });

    tracing::info!("正在关闭...");
    let _ = shutdown_tx.send(());
    let _ = rt.block_on(server_handle);
}
