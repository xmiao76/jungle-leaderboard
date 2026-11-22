//! Move search: iterative-deepening negamax with alpha-beta pruning.
//!
//! - The node budget is a hard ceiling. Every position visited counts — the root of
//!   each iteration, interior nodes, leaves and repeat visits.
//! - All state is created fresh per call (no transposition table survives between
//!   calls), and ties are broken by a xorshift stream seeded from (seed, rev). Equal
//!   inputs therefore always reproduce the same choice; rendering cannot affect it.
//! - If the budget runs out before any iteration completes, the best move by static
//!   ordering is returned: there is always a legal fallback.
//! - Repetition is a draw, as the referee rules it: a line that would produce a position for
//!   the third time in the game scores 0, and so does one that returns to a position already
//!   reached since the root of this search (whoever can repeat it can force the draw). A side
//!   that is ahead therefore avoids shuffling, and one that is behind may seek it.

use crate::rules::{self, Cells, DEN, NO_CAPTURE_LIMIT, REPETITION_LIMIT};
use crate::types::*;

// ---- Position keys (Zobrist hashing) --------------------------------------------------------

/// Cell values are 0 (empty) and 1..=16 (`rules::encode`).
const CELL_VALUES: usize = 17;

const fn splitmix64(state: u64) -> (u64, u64) {
    let next = state.wrapping_add(0x9E37_79B9_7F4A_7C15);
    let mut z = next;
    z = (z ^ (z >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
    z = (z ^ (z >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
    (next, z ^ (z >> 31))
}

/// One fixed key per (square, piece); empty squares contribute nothing. Constants, so every
/// key — and every choice made with them — is the same in every build and every instance.
const fn zobrist_table() -> ([[u64; CELL_VALUES]; SQUARES], u64) {
    let mut table = [[0u64; CELL_VALUES]; SQUARES];
    let mut state = 0x4A55_4E47_4C45_0002;
    let mut square = 0;
    while square < SQUARES {
        let mut value = 1;
        while value < CELL_VALUES {
            let (next, key) = splitmix64(state);
            state = next;
            table[square][value] = key;
            value += 1;
        }
        square += 1;
    }
    let (_, blue_to_move) = splitmix64(state);
    (table, blue_to_move)
}

const KEYS: ([[u64; CELL_VALUES]; SQUARES], u64) = zobrist_table();
const ZOBRIST: [[u64; CELL_VALUES]; SQUARES] = KEYS.0;
const BLUE_TO_MOVE: u64 = KEYS.1;

/// A 64-bit fingerprint of a position: every square and the side to move.
pub fn position_key(cells: &Cells, to_play: Side) -> u64 {
    let side = if to_play == Side::Blue { BLUE_TO_MOVE } else { 0 };
    cells.iter().enumerate().fold(side, |key, (square, &cell)| key ^ ZOBRIST[square][cell as usize])
}

const WIN: i32 = 1_000_000;
const MAX_DEPTH: u8 = 32;
/// Material values by rank-1 (rat … elephant).
const VALUE: [i32; 8] = [330, 200, 260, 310, 460, 760, 860, 950];

#[derive(Clone, Copy, Debug)]
pub struct SearchParams {
    pub node_budget: u32,
    pub seed: u32,
    pub level: Level,
    /// Optional wall-clock deadline as `(deadline, clock)` in milliseconds, for the
    /// standalone game (Hard thinks at most one second). The Arena entrant has no
    /// clock and always passes `None`, keeping its choices purely budget-bounded
    /// and reproducible. When the deadline passes the search aborts and returns the
    /// best move of the deepest completed iteration, exactly as at budget exhaustion.
    pub deadline: Option<(f64, fn() -> f64)>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct SearchResult {
    pub best: Move,
    pub score: i32,
    pub nodes: u32,
    /// Deepest fully searched iteration (0 = static fallback).
    pub depth: u8,
}

#[derive(Clone, Copy)]
struct Pos {
    cells: Cells,
    to_play: Side,
    quiet: u32,
    /// `position_key(cells, to_play)`, kept up to date incrementally.
    key: u64,
}

/// Deterministic xorshift32 stream.
struct Rng(u32);
impl Rng {
    fn new(seed: u32, rev: u32) -> Rng {
        let mixed = seed ^ rev.wrapping_mul(0x9E37_79B9) ^ 0xA5A5_5A5A;
        Rng(if mixed == 0 { 0x1234_5678 } else { mixed })
    }
    fn next(&mut self) -> u32 {
        let mut x = self.0;
        x ^= x << 13;
        x ^= x >> 17;
        x ^= x << 5;
        self.0 = x;
        x
    }
}

struct Searcher {
    nodes: u32,
    budget: u32,
    aborted: bool,
    deadline: Option<(f64, fn() -> f64)>,
    /// Keys of the game's positions since the last capture (root last), then of the current
    /// search line. A node is checked against it before it pushes its own key.
    line: Vec<u64>,
    /// Index of the root in `line`: entries from here on were reached by this search.
    root: usize,
}

fn rank(cell: u8) -> usize {
    ((cell - 1) % 8) as usize
}

fn side_of(cell: u8) -> Side {
    if cell <= 8 { Side::Red } else { Side::Blue }
}

fn manhattan(a: usize, b: usize) -> i32 {
    ((a / COLS) as i32 - (b / COLS) as i32).abs() + ((a % COLS) as i32 - (b % COLS) as i32).abs()
}

/// Static evaluation from the side to move's perspective.
fn evaluate(pos: &Pos) -> i32 {
    let mut score = [0i32; 2];
    for (square, &cell) in pos.cells.iter().enumerate() {
        if cell == 0 {
            continue;
        }
        let side = side_of(cell);
        let r = rank(cell);
        let enemy_den = DEN[side.opponent().index()] as usize;
        let distance = manhattan(square, enemy_den);
        let mut s = VALUE[r];
        // Advancement matters more for pieces that can actually win races.
        s += (12 - distance).max(0) * (6 + r as i32 * 2);
        if distance == 1 {
            s += 260;
        } else if distance == 2 {
            s += 90;
        }
        if rules::trap_owner(square) == Some(side.opponent()) {
            s -= VALUE[r] / 3; // standing in an enemy trap is dangerous
        }
        score[side.index()] += s;
    }
    let me = pos.to_play.index();
    score[me] - score[1 - me]
}

/// Captures first (most valuable victim), den entries before everything.
fn order_key(pos: &Pos, mv: Move) -> i32 {
    let victim = pos.cells[mv.dst as usize];
    let mover = pos.cells[mv.src as usize];
    let enemy_den = DEN[pos.to_play.opponent().index()] as usize;
    if mv.dst as usize == enemy_den {
        return 1_000_000;
    }
    let mut key = 0;
    if victim != 0 {
        key += 10_000 + VALUE[rank(victim)] * 10 - VALUE[rank(mover)];
    }
    key += manhattan(mv.src as usize, enemy_den) - manhattan(mv.dst as usize, enemy_den);
    key
}

fn play(pos: &Pos, mv: Move) -> Pos {
    let (src, dst) = (mv.src as usize, mv.dst as usize);
    let (piece, victim) = (pos.cells[src], pos.cells[dst]);
    let mut next = *pos;
    next.cells[dst] = piece;
    next.cells[src] = 0;
    next.quiet = if victim != 0 { 0 } else { pos.quiet + 1 };
    next.to_play = pos.to_play.opponent();
    // ZOBRIST[_][0] is 0, so an empty destination needs no special case.
    next.key = pos.key ^ ZOBRIST[src][piece as usize] ^ ZOBRIST[dst][piece as usize] ^ ZOBRIST[dst][victim as usize] ^ BLUE_TO_MOVE;
    next
}

fn ordered_moves(pos: &Pos) -> Vec<Move> {
    let mut moves = Vec::with_capacity(32);
    rules::generate(&pos.cells, pos.to_play, &mut moves);
    // Stable sort keeps (src, dst) order among equal keys: deterministic.
    moves.sort_by_key(|&m| -order_key(pos, m));
    moves
}

impl Searcher {
    /// Count one visited position, or refuse (and abort) once the budget is spent
    /// or the wall-clock deadline has passed (checked every 256 visits, so the
    /// overshoot past the deadline stays well under a millisecond of search).
    fn visit(&mut self) -> bool {
        if self.aborted || self.nodes >= self.budget {
            self.aborted = true;
            return false;
        }
        self.nodes += 1;
        if self.nodes % 256 == 0 {
            if let Some((deadline, clock)) = self.deadline {
                if clock() >= deadline {
                    self.aborted = true;
                    return false;
                }
            }
        }
        true
    }

    /// Score of `pos` for its side to move, which is about to choose a move.
    fn negamax(&mut self, pos: &Pos, depth: u8, mut alpha: i32, beta: i32, ply: i32) -> i32 {
        if !self.visit() {
            return 0;
        }
        let moves = ordered_moves(pos);
        if moves.is_empty() {
            return -WIN + ply; // immobilized: the previous mover won
        }
        // Draws in the rules' order: repetition, then the no-capture limit.
        if self.repeats(pos) || pos.quiet >= NO_CAPTURE_LIMIT {
            return 0;
        }
        if depth == 0 {
            return evaluate(pos);
        }
        self.line.push(pos.key);
        let mut best = -WIN - 1;
        for mv in moves {
            let score = self.score_move(pos, mv, depth, alpha, beta, ply);
            if self.aborted {
                best = 0;
                break;
            }
            best = best.max(score);
            alpha = alpha.max(score);
            if alpha >= beta {
                break;
            }
        }
        self.line.pop();
        best
    }

    /// True when `pos` is a draw by repetition: it would occur for the third time in the game,
    /// or it repeats a position this search already reached (root included). Only positions
    /// since the last capture can match, and `pos.quiet` says how many those are.
    fn repeats(&self, pos: &Pos) -> bool {
        let window = (pos.quiet as usize).min(self.line.len());
        let first = self.line.len() - window;
        let mut seen = 0;
        for (index, &key) in self.line.iter().enumerate().skip(first) {
            if key == pos.key {
                if index >= self.root {
                    return true;
                }
                seen += 1;
            }
        }
        seen + 1 >= REPETITION_LIMIT
    }

    fn score_move(&mut self, pos: &Pos, mv: Move, depth: u8, alpha: i32, beta: i32, ply: i32) -> i32 {
        let next = play(pos, mv);
        let mover = pos.to_play;
        if mv.dst as usize == DEN[mover.opponent().index()] as usize || rules::piece_count(&next.cells, mover.opponent()) == 0 {
            // A terminal position is still a visited position.
            self.visit();
            return WIN - ply - 1;
        }
        -self.negamax(&next, depth - 1, -beta, -alpha, ply + 1)
    }
}

/// Choose a move for the side to play, with no earlier positions known (a fresh position).
pub fn search(cells: &Cells, to_play: Side, quiet: u32, rev: u32, params: SearchParams) -> SearchResult {
    search_game(cells, to_play, quiet, rev, &[], params)
}

/// Choose a move for the side to play. `earlier` holds the keys (`position_key`) of the game's
/// positions since the last capture, oldest first, without the current one; the side to move
/// must have at least one legal move.
pub fn search_game(cells: &Cells, to_play: Side, quiet: u32, rev: u32, earlier: &[u64], params: SearchParams) -> SearchResult {
    let pos = Pos { cells: *cells, to_play, quiet, key: position_key(cells, to_play) };
    let mut root = ordered_moves(&pos);
    let fallback = root[0];
    if root.len() == 1 {
        // One legal move: no search can change the choice, so answer at once.
        return SearchResult { best: fallback, score: 0, nodes: 0, depth: 0 };
    }
    let mut line = earlier.to_vec();
    line.push(pos.key);
    let mut searcher =
        Searcher { nodes: 0, budget: params.node_budget, aborted: false, deadline: params.deadline, line, root: earlier.len() };
    let mut rng = Rng::new(params.seed, rev);
    // Fixed per-move noise for this call: variety at Easy, tie-breaking otherwise.
    let amplitude: i32 = match params.level {
        Level::Easy => 140,
        Level::Medium => 14,
        Level::Hard => 3,
    };
    let noise: Vec<(Move, i32)> = root.iter().map(|&m| (m, (rng.next() % (amplitude as u32 + 1)) as i32)).collect();
    let noise_of = |m: Move| noise.iter().find(|(n, _)| *n == m).map_or(0, |(_, v)| *v);

    let mut result = SearchResult { best: fallback, score: 0, nodes: 0, depth: 0 };
    if params.node_budget == 0 {
        return result; // direct policy: best by static ordering
    }

    for depth in 1..=MAX_DEPTH {
        if !searcher.visit() {
            break; // the root of this iteration is a visited position too
        }
        let mut best: Option<(Move, i32)> = None;
        let mut best_raw: Option<i32> = None;
        for &mv in &root {
            // Exact scores are needed only within `amplitude` of the best: anything that
            // fails low below that bound cannot win even with maximum noise.
            let alpha = best_raw.map_or(-WIN - 1, |b| b - amplitude - 1);
            let raw = searcher.score_move(&pos, mv, depth, alpha, WIN + 1, 0);
            if searcher.aborted {
                break;
            }
            best_raw = Some(best_raw.map_or(raw, |b| b.max(raw)));
            let score = raw.saturating_add(noise_of(mv));
            if best.is_none_or(|(_, b)| score > b) {
                best = Some((mv, score));
            }
        }
        if searcher.aborted {
            break;
        }
        let (mv, score) = best.expect("root has moves");
        result = SearchResult { best: mv, score, nodes: searcher.nodes, depth };
        // Search the previous best first next time.
        root.retain(|&m| m != mv);
        root.insert(0, mv);
        if score.abs() >= WIN - 64 {
            break; // a forced result is known
        }
    }
    result.nodes = searcher.nodes;
    result
}

/// Index into the contractual legal list (sorted by (src, dst)). Falls back to 0.
pub fn choose_index(snapshot: &Snapshot, legal: &[Move], params: SearchParams) -> u32 {
    if legal.is_empty() {
        return 0;
    }
    let cells = rules::cells_of(&snapshot.board);
    let earlier: Vec<u64> = rules::earlier_positions(&cells, snapshot.to_play, &snapshot.history, snapshot.no_capture_plies)
        .iter()
        .map(|(c, side)| position_key(c, *side))
        .collect();
    let result = search_game(&cells, snapshot.to_play, snapshot.no_capture_plies, snapshot.rev, &earlier, params);
    legal.iter().position(|&m| m == result.best).unwrap_or(0) as u32
}
