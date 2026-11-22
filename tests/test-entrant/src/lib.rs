//! Test-only Arena entrant. It always plays the first sorted legal move and draws a
//! plain parchment board with a "TEST ENTRANT" watermark. Cargo features turn it into the
//! deliberately broken components in arena/test-fixtures/; it is never published.

mod font;
mod render;

use render::{Canvas, Rgba, HEIGHT, SQ, WIDTH};

#[cfg(not(feature = "broken-extra-import"))]
wit_bindgen::generate!({ world: "competitor", path: "../../wit" });

// Test-only: the same exports plus an undeclared import, which the Arena must reject
// before running any guest code.
#[cfg(feature = "broken-extra-import")]
wit_bindgen::generate!({
    inline: r#"
        package test:extra;
        interface net { ping: func(); }
        world competitor-extra {
            import jungle:arena/display@1.0.0;
            import net;
            export jungle:arena/game@1.0.0;
        }
    "#,
    path: "../../wit",
    world: "test:extra/competitor-extra",
    generate_all,
});

use exports::jungle::arena::game::{Animal, Guest, Metadata, Phase, Settings, Side, Snapshot};
use exports::jungle::arena::game::PlyMove;
use jungle::arena::display;

#[cfg(feature = "older")]
const GAME_VERSION: &str = "1.0.0";
#[cfg(not(feature = "older"))]
const GAME_VERSION: &str = "1.1.0";

const RULES_ID: &str = "desktop-jungle-v1";
#[cfg(not(feature = "broken-digest"))]
const RULES_DIGEST: &str = "a0936f1eee833dd11107ed581dc7c5c2f72f0612d9fc7055c93a1d2fbb0c3d63";
#[cfg(feature = "broken-digest")]
const RULES_DIGEST: &str = "0000000000000000000000000000000000000000000000000000000000000000";

const WATER: [u8; 12] = [22, 23, 25, 26, 29, 30, 32, 33, 36, 37, 39, 40];
const RED_TRAPS: [u8; 3] = [52, 58, 60];
const BLUE_TRAPS: [u8; 3] = [2, 4, 10];
const RED_DEN: u8 = 59;
const BLUE_DEN: u8 = 3;

// Parchment-and-ink palette: plainly different from any real entrant's board.
const LAND_A: Rgba = [236, 224, 196, 255];
const LAND_B: Rgba = [226, 212, 180, 255];
const WATER_C: Rgba = [118, 170, 196, 255];
const WATER_RIPPLE: Rgba = [255, 255, 255, 70];
const TRAP_MARK: Rgba = [120, 84, 52, 200];
const DEN_C: Rgba = [96, 64, 40, 255];
const INK: Rgba = [40, 32, 24, 255];
const RED_PIECE: Rgba = [176, 52, 40, 255];
const BLUE_PIECE: Rgba = [40, 76, 156, 255];
const WHITE: Rgba = [255, 255, 255, 255];
const HIGHLIGHT: Rgba = [230, 168, 23, 255];
#[cfg(feature = "older")]
const WATERMARK: Rgba = [40, 32, 24, 70];
#[cfg(not(feature = "older"))]
const WATERMARK: Rgba = [20, 110, 90, 90];

struct Entrant;

impl Guest for Entrant {
    fn info() -> Metadata {
        Metadata {
            title: "Arena test entrant".into(),
            game_version: GAME_VERSION.into(),
            model: "Claude-Opus-5.5".into(),
            code_agent: "ClaudeCode".into(),
            github_url: "https://github.com/xmiao76/jungle-leaderboard".into(),
            engine_version: format!("test entrant {GAME_VERSION}: always plays legal index 0"),
            runtime: "Rust 1.94.1, wasm32-unknown-unknown, wit-bindgen 0.63.0".into(),
            rules_id: RULES_ID.into(),
            rules_digest: RULES_DIGEST.into(),
        }
    }

    fn init(_config: Settings) {
        #[cfg(feature = "broken-extra-import")]
        test::extra::net::ping();
    }

    fn choose_move(state: Snapshot, legal: Vec<PlyMove>, _node_budget: u32) -> u32 {
        if !misbehaves_at(state.rev) {
            return 0;
        }
        if cfg!(feature = "broken-trap") {
            panic!("deliberate trap");
        }
        if cfg!(feature = "broken-hang") {
            let mut n: u64 = 0;
            loop {
                n = core::hint::black_box(n.wrapping_add(1));
            }
        }
        if cfg!(feature = "broken-index") {
            return legal.len() as u32;
        }
        0
    }

    fn render(state: Snapshot, flipped: bool, progress: u16) {
        let frame = draw(&state, flipped, progress.min(1000));
        if !misbehaves_at(state.rev) {
            display::present(WIDTH as u16, HEIGHT as u16, &frame);
            return;
        }
        if cfg!(feature = "broken-no-frame") {
            return;
        }
        if cfg!(feature = "broken-frame-size") {
            display::present(440, HEIGHT as u16, &frame[..(440 * HEIGHT * 4) as usize]);
            return;
        }
        display::present(WIDTH as u16, HEIGHT as u16, &frame);
        if cfg!(feature = "broken-double-frame") {
            display::present(WIDTH as u16, HEIGHT as u16, &frame);
        }
    }
}

export!(Entrant);

/// With the `late` feature, a broken build behaves until revision 2, so it passes the admission
/// smoke test (which uses revision 0) and fails mid-match instead.
fn misbehaves_at(rev: u32) -> bool {
    !cfg!(feature = "late") || rev >= 2
}

/// Top-left pixel of a board square in the requested view.
fn cell_origin(square: u8, flipped: bool) -> (i32, i32) {
    let cell = if flipped { 62 - square as i32 } else { square as i32 };
    ((cell % 7) * SQ, (cell / 7) * SQ)
}

fn animal_name(kind: Animal) -> &'static str {
    match kind {
        Animal::Rat => "RAT",
        Animal::Cat => "CAT",
        Animal::Dog => "DOG",
        Animal::Wolf => "WOLF",
        Animal::Leopard => "LEOPARD",
        Animal::Tiger => "TIGER",
        Animal::Lion => "LION",
        Animal::Elephant => "ELEPHANT",
    }
}

fn rank(kind: Animal) -> u8 {
    kind as u8 + 1
}

fn side_name(side: Side) -> &'static str {
    match side {
        Side::Red => "RED",
        Side::Blue => "BLUE",
    }
}

fn draw_terrain(canvas: &mut Canvas, flipped: bool) {
    for square in 0..63u8 {
        let (x, y) = cell_origin(square, flipped);
        let checker = ((square / 7) + (square % 7)) % 2 == 0;
        canvas.fill_rect(x, y, SQ, SQ, if checker { LAND_A } else { LAND_B });

        if WATER.contains(&square) {
            canvas.fill_rect(x, y, SQ, SQ, WATER_C);
            for wave in 0..3 {
                canvas.fill_rect(x + 10, y + 16 + wave * 16, SQ - 20, 2, WATER_RIPPLE);
            }
        } else if RED_TRAPS.contains(&square) || BLUE_TRAPS.contains(&square) {
            for i in 8..SQ - 8 {
                canvas.fill_rect(x + i, y + i, 2, 2, TRAP_MARK);
                canvas.fill_rect(x + SQ - i, y + i, 2, 2, TRAP_MARK);
            }
        } else if square == RED_DEN || square == BLUE_DEN {
            canvas.outline(x + 6, y + 6, SQ - 12, SQ - 12, 4, DEN_C);
            canvas.text_centered(x + SQ / 2, y + SQ / 2 - 3, 1, "DEN", DEN_C);
        }
        canvas.outline(x, y, SQ, SQ, 1, [0, 0, 0, 40]);
    }
}

fn draw_piece(canvas: &mut Canvas, cx: i32, cy: i32, owner: Side, kind: Animal) {
    let fill = if owner == Side::Red { RED_PIECE } else { BLUE_PIECE };
    canvas.disc(cx, cy, 27, INK);
    canvas.disc(cx, cy, 25, fill);
    let digit = [b'0' + rank(kind)];
    canvas.text_centered(cx, cy - 16, 3, core::str::from_utf8(&digit).unwrap_or("?"), WHITE);
    canvas.text_centered(cx, cy + 9, 1, animal_name(kind), WHITE);
}

fn draw(state: &Snapshot, flipped: bool, progress: u16) -> Vec<u8> {
    let mut canvas = Canvas::new(LAND_A);
    draw_terrain(&mut canvas, flipped);
    canvas.text_centered(WIDTH / 2, 4 * SQ + 25, 2, &format!("TEST ENTRANT {GAME_VERSION}"), WATERMARK);

    let last = state.history.last();
    if let Some(m) = last {
        for square in [m.src, m.dst] {
            let (x, y) = cell_origin(square, flipped);
            canvas.outline(x + 2, y + 2, SQ - 4, SQ - 4, 3, HIGHLIGHT);
        }
    }

    for (square, cell) in state.board.iter().enumerate() {
        let Some(piece) = cell else { continue };
        let (mut x, mut y) = cell_origin(square as u8, flipped);
        // Mid-animation: slide the last mover from its source square.
        if let Some(m) = last {
            if progress < 1000 && m.dst as usize == square {
                let (sx, sy) = cell_origin(m.src, flipped);
                let t = progress as i32;
                x = sx + (x - sx) * t / 1000;
                y = sy + (y - sy) * t / 1000;
            }
        }
        draw_piece(&mut canvas, x + SQ / 2, y + SQ / 2, piece.owner, piece.kind);
    }

    if state.status != Phase::Playing {
        let banner = match (state.status, state.winner) {
            (Phase::Drawn, _) => format!("DRAW: {}", state.reason.to_uppercase()),
            (_, Some(w)) => format!("{} WINS: {}", side_name(w), state.reason.to_uppercase()),
            _ => "GAME OVER".to_string(),
        };
        canvas.fill_rect(0, 4 * SQ, WIDTH, SQ, [20, 16, 12, 210]);
        canvas.text_centered(WIDTH / 2, 4 * SQ + 18, 3, &banner, WHITE);
    }
    canvas.pixels
}
