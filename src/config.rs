use clap::Parser;
use std::fmt;

#[derive(Parser)]
#[command(name = "lan-drop", version, about = "局域网文件传输工具")]
pub struct Config {
    /// 监听端口
    #[arg(short, long, default_value = "3000")]
    pub port: u16,

    /// 前端静态文件目录
    #[arg(short, long, default_value = "./frontend")]
    pub static_dir: String,

    /// 日志级别
    #[arg(short, long, default_value = "info")]
    pub log_level: LogLevel,

    /// 单文件大小上限 MB
    #[arg(short, long, default_value = "512")]
    pub max_file_size_mb: u64,

    /// 文本消息大小上限 MB
    #[arg(short = 't', long, default_value = "1")]
    pub max_text_size_mb: u64,
}

#[derive(Clone)]
pub struct LogLevel(pub tracing::Level);

impl fmt::Display for LogLevel {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        self.0.fmt(f)
    }
}

impl AsRef<str> for LogLevel {
    fn as_ref(&self) -> &str {
        match self.0 {
            tracing::Level::TRACE => "trace",
            tracing::Level::DEBUG => "debug",
            tracing::Level::INFO => "info",
            tracing::Level::WARN => "warn",
            tracing::Level::ERROR => "error",
        }
    }
}

impl From<LogLevel> for String {
    fn from(level: LogLevel) -> String {
        level.0.to_string()
    }
}

impl std::str::FromStr for LogLevel {
    type Err = String;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        let level: tracing::Level = s
            .parse()
            .map_err(|_| format!("Invalid log level: {}", s))?;
        Ok(LogLevel(level))
    }
}
