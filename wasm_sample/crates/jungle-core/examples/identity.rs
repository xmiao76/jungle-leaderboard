//! Print the identity the release binary reports, as JSON (used by the build).
use jungle_core::{identity, RULES_DIGEST, RULES_ID};

fn main() {
    println!(
        "{{\"title\":\"{}\",\"gameVersion\":\"{}\",\"model\":\"{}\",\"codeAgent\":\"{}\",\"githubUrl\":\"{}\",\"engineVersion\":\"{}\",\"runtime\":\"{}\",\"rulesId\":\"{}\",\"rulesDigest\":\"{}\"}}",
        identity::TITLE,
        identity::GAME_VERSION,
        identity::MODEL,
        identity::CODE_AGENT,
        identity::GITHUB_URL,
        identity::ENGINE_VERSION,
        identity::RUNTIME,
        RULES_ID,
        RULES_DIGEST
    );
}
