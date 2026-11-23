//! Jungle core: rules, search and renderer shared by the standalone web game
//! (`jungle-web`) and the Arena entrant (`jungle-entrant`). Nothing here knows about
//! a binding layer, so both builds make identical decisions and draw identical boards.

pub mod atlas;
pub mod render;
pub mod rules;
pub mod search;
pub mod types;

pub use types::*;

/// Identity reported by `info()` and shown in the standalone menu.
pub mod identity {
    /// Composed per jungle_prompt.md's title rule: `<model> · <code-agent>`, plus
    /// ` · <model-platform>` only when the platform is non-empty and not `official`
    /// (here it is `official`, so it appends nothing). The test below pins the parts.
    pub const TITLE: &str = "Claude-Opus-5.5 · ClaudeCode";
    pub const GAME_VERSION: &str = "1.1.0";
    pub const MODEL: &str = "Claude-Opus-5.5";
    pub const CODE_AGENT: &str = "ClaudeCode";
    pub const MODEL_PLATFORM: &str = "official";
    pub const GITHUB_URL: &str = "https://github.com/xmiao76/jungle-leaderboard";
    pub const ENGINE_VERSION: &str = "jungle-core 1.1.0 (alpha-beta, iterative deepening, repetition-aware)";
    pub const RUNTIME: &str = "Rust 1.94.1, wasm32-unknown-unknown, wit-bindgen 0.63.0";
}

#[cfg(test)]
mod identity_tests {
    use super::identity;

    /// The title is the identity parts joined per jungle_prompt.md: model · code agent,
    /// plus the platform only when it is non-empty and not `official`.
    #[test]
    fn title_is_composed_from_the_identity_parts() {
        let platform = match identity::MODEL_PLATFORM {
            "" | "official" => String::new(),
            other => format!(" · {other}"),
        };
        assert_eq!(identity::TITLE, format!("{} · {}{platform}", identity::MODEL, identity::CODE_AGENT));
    }
}

/// Default node budgets for the standalone difficulty levels. Arena games use the
/// host's budget instead.
pub fn standalone_budget(level: Level) -> u32 {
    match level {
        Level::Easy => 2_000,
        Level::Medium => 30_000,
        Level::Hard => 300_000,
    }
}
