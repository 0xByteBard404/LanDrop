use clap::Parser;
use std::fmt;

#[derive(Parser)]
#[command(name = "lan-drop", version, about = "局域网文件传输工具")]
pub struct Config {
    /// 监听端口
    #[arg(short, long, default_value = "3000")]
    pub port: u16,

    /// 前端静态文件目录
    #[arg(short, long)]
    pub static_dir: Option<String>,

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

impl Config {
    /// Get the static dir.
    /// If not specified via CLI, tries exe-relative `frontend/` first,
    /// then falls back to cwd-relative `./frontend` (for development).
    pub fn static_dir(&self) -> String {
        if let Some(dir) = &self.static_dir {
            return dir.clone();
        }
        // Try exe-relative path first (for packaged distribution)
        if let Ok(exe) = std::env::current_exe() {
            if let Some(parent) = exe.parent() {
                let path = parent.join("frontend");
                if path.exists() {
                    return path.to_string_lossy().to_string();
                }
            }
        }
        // Fall back to cwd-relative (for development with cargo run)
        "./frontend".to_string()
    }
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_config() {
        let config = Config::try_parse_from(["lan-drop"]).unwrap();
        assert_eq!(config.port, 3000);
        assert!(config.static_dir.is_none());
        assert_eq!(config.max_file_size_mb, 512);
        assert_eq!(config.max_text_size_mb, 1);
    }

    #[test]
    fn custom_port() {
        let config = Config::try_parse_from(["lan-drop", "--port", "8080"]).unwrap();
        assert_eq!(config.port, 8080);
    }

    #[test]
    fn custom_static_dir() {
        let config = Config::try_parse_from(["lan-drop", "--static-dir", "/tmp/www"]).unwrap();
        assert_eq!(config.static_dir(), "/tmp/www");
    }

    #[test]
    fn custom_file_size_limit() {
        let config = Config::try_parse_from(["lan-drop", "--max-file-size-mb", "1024"]).unwrap();
        assert_eq!(config.max_file_size_mb, 1024);
    }

    #[test]
    fn log_level_from_str_valid() {
        for level_str in &["trace", "debug", "info", "warn", "error"] {
            let level: LogLevel = level_str.parse().unwrap_or_else(|_| panic!("{} 应为有效级别", level_str));
            assert_eq!(level.as_ref(), *level_str);
        }
    }

    #[test]
    fn log_level_from_str_invalid() {
        let result = "invalid".parse::<LogLevel>();
        assert!(result.is_err());
    }

    #[test]
    fn log_level_display() {
        let level = LogLevel(tracing::Level::INFO);
        assert_eq!(format!("{}", level), "INFO");
    }

    #[test]
    fn log_level_into_string() {
        let level = LogLevel(tracing::Level::WARN);
        let s: String = level.into();
        assert_eq!(s, "WARN");
    }
}
