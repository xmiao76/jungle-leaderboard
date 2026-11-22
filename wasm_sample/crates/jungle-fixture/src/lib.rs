//! Fixture opponent for the conformance host. It implements the full WIT, always
//! chooses legal index 0, and draws a grayscale board with square pieces and a
//! "FIXTURE" watermark so its frames are never mistaken for the release's.

use jungle_core::render::{cell_origin, Canvas, HEIGHT, SQ, WIDTH};
use jungle_core::rules::{den_owner, is_water, trap_owner};
use jungle_core::{RULES_DIGEST, RULES_ID};

wit_bindgen::generate!({ world: "competitor", path: "../../wit" });

use exports::jungle::arena::game::{Guest, Metadata, Phase, PlyMove, Settings, Side, Snapshot};
use jungle::arena::display;

/// 5×7 glyphs for the few letters the fixture writes.
fn glyph(c: char) -> [u8; 7] {
    match c {
        'F' => [0x1F, 0x10, 0x10, 0x1E, 0x10, 0x10, 0x10],
        'I' => [0x0E, 0x04, 0x04, 0x04, 0x04, 0x04, 0x0E],
        'X' => [0x11, 0x11, 0x0A, 0x04, 0x0A, 0x11, 0x11],
        'T' => [0x1F, 0x04, 0x04, 0x04, 0x04, 0x04, 0x04],
        'U' => [0x11, 0x11, 0x11, 0x11, 0x11, 0x11, 0x0E],
        'R' => [0x1E, 0x11, 0x11, 0x1E, 0x14, 0x12, 0x11],
        'E' => [0x1F, 0x10, 0x10, 0x1E, 0x10, 0x10, 0x1F],
        'O' => [0x0E, 0x11, 0x11, 0x11, 0x11, 0x11, 0x0E],
        'V' => [0x11, 0x11, 0x11, 0x11, 0x11, 0x0A, 0x04],
        '1'..='8' => {
            let n = c as u8 - b'0';
            [[0x04, 0x0C, 0x04, 0x04, 0x04, 0x04, 0x0E], [0x0E, 0x11, 0x01, 0x02, 0x04, 0x08, 0x1F], [0x1F, 0x02, 0x04, 0x02, 0x01, 0x11, 0x0E],
             [0x02, 0x06, 0x0A, 0x12, 0x1F, 0x02, 0x02], [0x1F, 0x10, 0x1E, 0x01, 0x01, 0x11, 0x0E], [0x06, 0x08, 0x10, 0x1E, 0x11, 0x11, 0x0E],
             [0x1F, 0x01, 0x02, 0x04, 0x08, 0x08, 0x08], [0x0E, 0x11, 0x11, 0x0E, 0x11, 0x11, 0x0E]][n as usize - 1]
        }
        _ => [0; 7],
    }
}

fn text(canvas: &mut Canvas, x: i32, y: i32, scale: i32, s: &str, rgb: [u8; 3], alpha: f32) {
    for (i, c) in s.chars().enumerate() {
        for (row, bits) in glyph(c).iter().enumerate() {
            for col in 0..5 {
                if bits & (1 << (4 - col)) != 0 {
                    canvas.fill_rect(x + (i as i32 * 6 + col) * scale, y + row as i32 * scale, scale, scale, rgb, alpha);
                }
            }
        }
    }
}

struct Fixture;

impl Guest for Fixture {
    fn info() -> Metadata {
        Metadata {
            title: "Conformance fixture (index 0)".into(),
            game_version: "1.0.0".into(),
            model: "Claude-Opus-5.5".into(),
            code_agent: "ClaudeCode".into(),
            github_url: "https://github.com/xmiao76/jungle-leaderboard".into(),
            engine_version: "fixture: always legal index 0".into(),
            runtime: "Rust 1.94.1, wasm32-unknown-unknown, wit-bindgen 0.63.0".into(),
            rules_id: RULES_ID.into(),
            rules_digest: RULES_DIGEST.into(),
        }
    }

    fn init(_config: Settings) {}

    fn choose_move(_state: Snapshot, _legal: Vec<PlyMove>, _node_budget: u32) -> u32 {
        0
    }

    fn render(state: Snapshot, flipped: bool, _progress: u16) {
        let mut canvas = Canvas::default();
        for square in 0..63u8 {
            let (x, y) = cell_origin(square, flipped);
            let s = square as usize;
            let shade = if is_water(s) { [150, 150, 150] } else if trap_owner(s).is_some() { [200, 200, 200] } else if den_owner(s).is_some() { [90, 90, 90] } else { [235, 235, 235] };
            canvas.fill_rect(x, y, SQ, SQ, shade, 1.0);
            canvas.fill_rect(x, y, SQ, 1, [120, 120, 120], 1.0);
            canvas.fill_rect(x, y, 1, SQ, [120, 120, 120], 1.0);
        }
        text(&mut canvas, WIDTH / 2 - 120, 4 * SQ + 18, 5, "FIXTURE", [60, 60, 60], 0.35);
        for (square, cell) in state.board.iter().enumerate() {
            let Some(piece) = cell else { continue };
            let (x, y) = cell_origin(square as u8, flipped);
            let (fill, ink) = if piece.owner == Side::Red { ([40, 40, 40], [255, 255, 255]) } else { ([255, 255, 255], [0, 0, 0]) };
            canvas.fill_rect(x + 10, y + 10, SQ - 20, SQ - 20, [0, 0, 0], 1.0);
            canvas.fill_rect(x + 12, y + 12, SQ - 24, SQ - 24, fill, 1.0);
            let rank = char::from(b'1' + piece.kind as u8);
            text(&mut canvas, x + 23, y + 18, 3, &rank.to_string(), ink, 1.0);
        }
        if state.status != Phase::Playing {
            text(&mut canvas, WIDTH / 2 - 54, 8, 4, "OVER", [0, 0, 0], 1.0);
        }
        display::present(WIDTH as u16, HEIGHT as u16, &canvas.pixels);
    }
}

export!(Fixture);
