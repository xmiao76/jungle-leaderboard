//! The standalone game's view of jungle-core. The web shell owns presentation and
//! input; every rule, move hint, AI decision and pixel comes from the same core the
//! Arena entrant uses.

use jungle_core::render::{overlay_for, square_at, Renderer};
use jungle_core::rules::{self, apply_move, initial_snapshot, legal_moves};
use jungle_core::search::{choose_index, SearchParams};
use jungle_core::{identity, Level, Move, Phase, Piece, Reason, Side, Snapshot, RULES_DIGEST, RULES_ID, SQUARES};
use wasm_bindgen::prelude::*;

fn side_from(code: u8) -> Side {
    if code == 0 { Side::Red } else { Side::Blue }
}

fn level_from(code: u8) -> Level {
    match code {
        0 => Level::Easy,
        2 => Level::Hard,
        _ => Level::Medium,
    }
}

/// Compact snapshot encoding shared by the shell and its AI worker:
/// rev u32 | first u8 | to_play u8 | quiet u32 | status u8 | winner u8 (0 red, 1 blue, 2 none)
/// | reason-len u8 | reason bytes | 63 cells | history pairs.
pub fn encode(s: &Snapshot) -> Vec<u8> {
    let mut out = Vec::with_capacity(96 + s.history.len() * 2);
    out.extend_from_slice(&s.rev.to_le_bytes());
    out.push(s.first_side.index() as u8);
    out.push(s.to_play.index() as u8);
    out.extend_from_slice(&s.no_capture_plies.to_le_bytes());
    out.push(s.status as u8);
    out.push(s.winner.map_or(2, |w| w.index() as u8));
    let reason = s.reason.as_str().as_bytes();
    out.push(reason.len() as u8);
    out.extend_from_slice(reason);
    out.extend(s.board.iter().map(|p| rules::encode(*p)));
    for m in &s.history {
        out.extend_from_slice(&[m.src, m.dst]);
    }
    out
}

pub fn decode(bytes: &[u8]) -> Option<Snapshot> {
    let rev = u32::from_le_bytes(bytes.get(0..4)?.try_into().ok()?);
    let first_side = side_from(*bytes.get(4)?);
    let to_play = side_from(*bytes.get(5)?);
    let no_capture_plies = u32::from_le_bytes(bytes.get(6..10)?.try_into().ok()?);
    let status = match bytes.get(10)? {
        0 => Phase::Playing,
        1 => Phase::Won,
        2 => Phase::Drawn,
        _ => Phase::Forfeited,
    };
    let winner = match bytes.get(11)? {
        2 => None,
        w => Some(side_from(*w)),
    };
    let reason_len = *bytes.get(12)? as usize;
    let reason = Reason::parse(std::str::from_utf8(bytes.get(13..13 + reason_len)?).ok()?);
    let cells_at = 13 + reason_len;
    let mut board = [None; SQUARES];
    for (i, cell) in bytes.get(cells_at..cells_at + SQUARES)?.iter().enumerate() {
        board[i] = rules::decode(*cell);
    }
    let history = bytes[cells_at + SQUARES..].chunks_exact(2).map(|p| Move { src: p[0], dst: p[1] }).collect();
    Some(Snapshot { rev, board, first_side, to_play, history, no_capture_plies, status, winner, reason })
}

#[wasm_bindgen]
pub struct Game {
    current: Snapshot,
    undo: Vec<Snapshot>,
    renderer: Renderer,
}

#[wasm_bindgen]
impl Game {
    /// `first`: 0 = red moves first, 1 = blue.
    #[wasm_bindgen(constructor)]
    pub fn new(first: u8) -> Game {
        Game { current: initial_snapshot(side_from(first)), undo: Vec::new(), renderer: Renderer::default() }
    }

    pub fn rev(&self) -> u32 {
        self.current.rev
    }
    pub fn to_play(&self) -> u8 {
        self.current.to_play.index() as u8
    }
    pub fn first_side(&self) -> u8 {
        self.current.first_side.index() as u8
    }
    pub fn quiet(&self) -> u32 {
        self.current.no_capture_plies
    }
    /// 0 playing, 1 won, 2 drawn, 3 forfeited.
    pub fn status(&self) -> u8 {
        self.current.status as u8
    }
    /// 0 red, 1 blue, 2 none.
    pub fn winner(&self) -> u8 {
        self.current.winner.map_or(2, |w| w.index() as u8)
    }
    pub fn reason(&self) -> String {
        self.current.reason.as_str().into()
    }
    /// 63 cells: 0 empty, 1–8 red rat…elephant, 9–16 blue.
    pub fn cells(&self) -> Vec<u8> {
        self.current.board.iter().map(|p| rules::encode(*p)).collect()
    }
    /// History as (src, dst) pairs.
    pub fn history(&self) -> Vec<u8> {
        self.current.history.iter().flat_map(|m| [m.src, m.dst]).collect()
    }
    /// Legal moves for the side to play as (src, dst) pairs, sorted.
    pub fn legal(&self) -> Vec<u8> {
        legal_moves(&self.current).iter().flat_map(|m| [m.src, m.dst]).collect()
    }
    /// Whether the last committed move captured a piece.
    pub fn last_was_capture(&self) -> bool {
        !self.current.history.is_empty() && self.current.no_capture_plies == 0
    }
    pub fn snapshot(&self) -> Vec<u8> {
        encode(&self.current)
    }

    /// Commit a move; returns false (and changes nothing) if it is not legal.
    pub fn play(&mut self, src: u8, dst: u8) -> bool {
        match apply_move(&self.current, Move { src, dst }) {
            Ok(next) => {
                self.undo.push(std::mem::replace(&mut self.current, next));
                true
            }
            Err(_) => false,
        }
    }

    /// Undo up to `plies` moves; returns how many were undone.
    pub fn undo(&mut self, plies: u32) -> u32 {
        let mut done = 0;
        while done < plies {
            let Some(previous) = self.undo.pop() else { break };
            self.current = previous;
            done += 1;
        }
        done
    }

    pub fn can_undo(&self) -> u32 {
        self.undo.len() as u32
    }

    /// Render the current position. `selected` < 0 means no selection overlay.
    pub fn render(&mut self, flipped: bool, progress: u16, selected: i32) -> Vec<u8> {
        let overlay = (selected >= 0).then(|| overlay_for(&self.current, selected as u8));
        self.renderer.render(&self.current, flipped, progress, overlay.as_ref()).to_vec()
    }

    pub fn piece_owner(&self, square: u8) -> i32 {
        self.current.board.get(square as usize).copied().flatten().map_or(-1, |p| p.owner.index() as i32)
    }

    pub fn piece_name(&self, square: u8) -> String {
        self.current.board.get(square as usize).copied().flatten().map_or(String::new(), |p: Piece| p.kind.name().into())
    }
}

/// Board square under a frame pixel (448 × 576 coordinates), or -1. Flip-aware.
#[wasm_bindgen]
pub fn square_at_pixel(x: i32, y: i32, flipped: bool) -> i32 {
    square_at(x, y, flipped).map_or(-1, i32::from)
}

/// Pick a move for an encoded snapshot; returns the index into its sorted legal list.
#[wasm_bindgen]
pub fn choose(snapshot: &[u8], node_budget: u32, seed: u32, level: u8) -> i32 {
    let Some(s) = decode(snapshot) else { return -1 };
    if s.status != Phase::Playing {
        return -1;
    }
    let legal = legal_moves(&s);
    if legal.is_empty() {
        return -1;
    }
    choose_index(&s, &legal, SearchParams { node_budget, seed, level: level_from(level) }) as i32
}

/// Legal moves of an encoded snapshot as (src, dst) pairs (parity tests).
#[wasm_bindgen]
pub fn legal_of(snapshot: &[u8]) -> Vec<u8> {
    decode(snapshot).map_or(Vec::new(), |s| legal_moves(&s).iter().flat_map(|m| [m.src, m.dst]).collect())
}

/// Apply a move to an encoded snapshot; empty on an illegal move (parity tests).
#[wasm_bindgen]
pub fn apply_to(snapshot: &[u8], src: u8, dst: u8) -> Vec<u8> {
    decode(snapshot).and_then(|s| apply_move(&s, Move { src, dst }).ok()).map_or(Vec::new(), |s| encode(&s))
}

/// Render an encoded snapshot without any overlay (parity tests).
#[wasm_bindgen]
pub fn render_snapshot(snapshot: &[u8], flipped: bool, progress: u16) -> Vec<u8> {
    let Some(s) = decode(snapshot) else { return Vec::new() };
    Renderer::default().render(&s, flipped, progress, None).to_vec()
}

/// The identity the release binary's `info()` reports, as JSON for the menu.
#[wasm_bindgen]
pub fn identity_json() -> String {
    format!(
        "{{\"title\":\"{}\",\"gameVersion\":\"{}\",\"model\":\"{}\",\"codeAgent\":\"{}\",\"engineVersion\":\"{}\",\"runtime\":\"{}\",\"rulesId\":\"{}\",\"rulesDigest\":\"{}\"}}",
        identity::TITLE,
        identity::GAME_VERSION,
        identity::MODEL,
        identity::CODE_AGENT,
        identity::ENGINE_VERSION,
        identity::RUNTIME,
        RULES_ID,
        RULES_DIGEST
    )
}

/// Default node budget for a standalone difficulty (0 easy, 1 medium, 2 hard).
#[wasm_bindgen]
pub fn budget_for(level: u8) -> u32 {
    jungle_core::standalone_budget(level_from(level))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn snapshot_encoding_round_trips() {
        let mut g = Game::new(1);
        let legal = g.legal();
        assert!(g.play(legal[0], legal[1]));
        let s = g.current.clone();
        assert_eq!(decode(&encode(&s)), Some(s));
    }

    #[test]
    fn undo_restores_history_counters_and_turn() {
        let mut g = Game::new(0);
        let before = g.current.clone();
        let l = g.legal();
        g.play(l[0], l[1]);
        let l = g.legal();
        g.play(l[0], l[1]);
        assert_eq!(g.undo(2), 2);
        assert_eq!(g.current, before);
        assert_eq!(g.undo(1), 0);
    }

    #[test]
    fn illegal_play_changes_nothing() {
        let mut g = Game::new(0);
        assert!(!g.play(42, 44));
        assert_eq!(g.rev(), 0);
    }

    #[test]
    fn both_first_mover_choices_start_correctly() {
        assert_eq!((Game::new(0).to_play(), Game::new(0).first_side()), (0, 0));
        assert_eq!((Game::new(1).to_play(), Game::new(1).first_side()), (1, 1));
        assert_eq!(&Game::new(1).legal()[0..2], &[0, 1]);
    }
}
