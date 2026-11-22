//! The `desktop-jungle-v2` rulebook (v1 plus the repetition draw).
//!
//! One move generator serves everything — the legal list, validation, adjudication and
//! the search — over a compact board of one byte per square.

use crate::types::*;

pub const DEN: [u8; 2] = [59, 3]; // indexed by Side::index(): red, blue
const WATER_SQUARES: [u8; 12] = [22, 23, 25, 26, 29, 30, 32, 33, 36, 37, 39, 40];
const RED_TRAPS: [u8; 3] = [52, 58, 60];
const BLUE_TRAPS: [u8; 3] = [2, 4, 10];
/// `openingByAscendingRank`, rat first.
const OPENING: [[u8; 8]; 2] = [[48, 50, 54, 44, 46, 56, 62, 42], [14, 12, 8, 18, 16, 6, 0, 20]];
pub const NO_CAPTURE_LIMIT: u32 = 100;
/// A committed move that produces a position for this many times draws the game.
pub const REPETITION_LIMIT: u32 = 3;

const fn table<const N: usize>(squares: [u8; N]) -> [bool; SQUARES] {
    let mut t = [false; SQUARES];
    let mut i = 0;
    while i < N {
        t[squares[i] as usize] = true;
        i += 1;
    }
    t
}

const WATER: [bool; SQUARES] = table(WATER_SQUARES);
const TRAP_OF_RED: [bool; SQUARES] = table(RED_TRAPS);
const TRAP_OF_BLUE: [bool; SQUARES] = table(BLUE_TRAPS);

pub fn is_water(square: usize) -> bool {
    WATER[square]
}

/// The side that owns the trap on `square`, if any.
pub fn trap_owner(square: usize) -> Option<Side> {
    if TRAP_OF_RED[square] {
        Some(Side::Red)
    } else if TRAP_OF_BLUE[square] {
        Some(Side::Blue)
    } else {
        None
    }
}

pub fn den_owner(square: usize) -> Option<Side> {
    if square == DEN[0] as usize {
        Some(Side::Red)
    } else if square == DEN[1] as usize {
        Some(Side::Blue)
    } else {
        None
    }
}

// ---- Compact board ---------------------------------------------------------------------

/// 0 = empty; otherwise `side * 8 + rank` (red 1..=8, blue 9..=16).
pub type Cells = [u8; SQUARES];

pub fn encode(piece: Option<Piece>) -> u8 {
    piece.map_or(0, |p| p.owner.index() as u8 * 8 + p.kind.rank())
}

pub fn decode(cell: u8) -> Option<Piece> {
    if cell == 0 {
        return None;
    }
    let owner = if cell <= 8 { Side::Red } else { Side::Blue };
    Animal::from_index(((cell - 1) % 8) as usize).map(|kind| Piece { owner, kind })
}

#[inline]
fn owner_of(cell: u8) -> Option<Side> {
    match cell {
        0 => None,
        1..=8 => Some(Side::Red),
        _ => Some(Side::Blue),
    }
}

#[inline]
fn rank_of(cell: u8) -> u8 {
    (cell - 1) % 8 + 1
}

pub fn cells_of(board: &Board) -> Cells {
    let mut cells = [0u8; SQUARES];
    for (i, p) in board.iter().enumerate() {
        cells[i] = encode(*p);
    }
    cells
}

pub fn board_of(cells: &Cells) -> Board {
    let mut board = [None; SQUARES];
    for (i, c) in cells.iter().enumerate() {
        board[i] = decode(*c);
    }
    board
}

// ---- Move generation ------------------------------------------------------------------------

const RAT: u8 = 1;
const TIGER: u8 = 6;
const LION: u8 = 7;
const ELEPHANT: u8 = 8;
const DIRS: [(i32, i32); 4] = [(-1, 0), (1, 0), (0, -1), (0, 1)];

#[inline]
fn step(square: usize, dr: i32, dc: i32) -> Option<usize> {
    let r = (square / COLS) as i32 + dr;
    let c = (square % COLS) as i32 + dc;
    if r < 0 || r >= ROWS as i32 || c < 0 || c >= COLS as i32 {
        None
    } else {
        Some(r as usize * COLS + c as usize)
    }
}

#[inline]
fn trapped(owner: Side, square: usize) -> bool {
    trap_owner(square) == Some(owner.opponent())
}

/// Capture test on pre-move squares. Both squares hold opposing pieces.
fn can_capture(attacker: u8, from: usize, defender: u8, to: usize) -> bool {
    if is_water(from) != is_water(to) {
        return false; // never across the water boundary
    }
    if is_water(from) {
        return true; // only rats swim: rat takes rat
    }
    let (a_side, d_side) = (owner_of(attacker).unwrap(), owner_of(defender).unwrap());
    if trapped(d_side, to) {
        return true;
    }
    if trapped(a_side, from) {
        return false;
    }
    let (a, d) = (rank_of(attacker), rank_of(defender));
    if a == RAT && d == ELEPHANT {
        return true;
    }
    if a == ELEPHANT && d == RAT {
        return false;
    }
    a >= d
}

fn can_enter(cells: &Cells, piece: u8, from: usize, to: usize) -> bool {
    let side = owner_of(piece).unwrap();
    if to == DEN[side.index()] as usize {
        return false;
    }
    let target = cells[to];
    if target == 0 {
        return true;
    }
    if owner_of(target) == Some(side) {
        return false;
    }
    can_capture(piece, from, target, to)
}

fn jump(cells: &Cells, rank: u8, from: usize, dr: i32, dc: i32) -> Option<usize> {
    let mut square = step(from, dr, dc)?;
    let mut crossed = 0;
    while is_water(square) {
        if cells[square] != 0 && rank_of(cells[square]) == RAT {
            return None; // any rat on traversed water blocks
        }
        crossed += 1;
        square = step(square, dr, dc)?;
    }
    let allowed = match rank {
        LION => crossed == 2 || crossed == 3,
        TIGER => crossed == 2,
        _ => false,
    };
    allowed.then_some(square)
}

/// Push every legal move of `side`, in square order then destination order.
pub fn generate(cells: &Cells, side: Side, out: &mut Vec<Move>) {
    let start = out.len();
    for from in 0..SQUARES {
        let piece = cells[from];
        if owner_of(piece) != Some(side) {
            continue;
        }
        let rank = rank_of(piece);
        for (dr, dc) in DIRS {
            let Some(to) = step(from, dr, dc) else { continue };
            let dst = if is_water(to) && rank != RAT {
                if rank != LION && rank != TIGER || is_water(from) {
                    continue;
                }
                match jump(cells, rank, from, dr, dc) {
                    Some(landing) => landing,
                    None => continue,
                }
            } else {
                to
            };
            if can_enter(cells, piece, from, dst) {
                out.push(Move { src: from as u8, dst: dst as u8 });
            }
        }
    }
    out[start..].sort_unstable();
}

pub fn has_legal_move(cells: &Cells, side: Side) -> bool {
    let mut moves = Vec::with_capacity(32);
    generate(cells, side, &mut moves);
    !moves.is_empty()
}

pub fn piece_count(cells: &Cells, side: Side) -> usize {
    cells.iter().filter(|&&c| owner_of(c) == Some(side)).count()
}

// ---- Repetition ---------------------------------------------------------------------------

/// The positions before the current one that could still equal it, oldest first: those since
/// the last capture. A capture can never be undone and every later move only relocated a
/// piece, so stepping the trailing quiet moves back from `cells` recreates each earlier
/// position exactly. `quiet` bounds them (a synthetic start may carry more than its history).
pub fn earlier_positions(cells: &Cells, to_play: Side, history: &[Move], quiet: u32) -> Vec<(Cells, Side)> {
    let reversible = (quiet as usize).min(history.len());
    let mut board = *cells;
    let mut side = to_play;
    let mut out: Vec<(Cells, Side)> = history
        .iter()
        .rev()
        .take(reversible)
        .map(|mv| {
            board[mv.src as usize] = board[mv.dst as usize];
            board[mv.dst as usize] = 0;
            side = side.opponent();
            (board, side)
        })
        .collect();
    out.reverse();
    out
}

/// How many times the current position (squares and side to move) has occurred, this one included.
pub fn position_occurrences(cells: &Cells, to_play: Side, history: &[Move], quiet: u32) -> u32 {
    let earlier = earlier_positions(cells, to_play, history, quiet);
    1 + earlier.iter().filter(|(c, side)| *side == to_play && c == cells).count() as u32
}

// ---- Snapshot-level API -------------------------------------------------------------------

pub fn initial_snapshot(first_side: Side) -> Snapshot {
    let mut board: Board = [None; SQUARES];
    for side in Side::BOTH {
        for (rank, &square) in OPENING[side.index()].iter().enumerate() {
            board[square as usize] = Some(Piece { owner: side, kind: Animal::ALL[rank] });
        }
    }
    Snapshot {
        rev: 0,
        board,
        first_side,
        to_play: first_side,
        history: Vec::new(),
        no_capture_plies: 0,
        status: Phase::Playing,
        winner: None,
        reason: Reason::None,
    }
}

/// The contractual legal list for the side to play: sorted by (src, dst); empty when over.
pub fn legal_moves(snapshot: &Snapshot) -> Vec<Move> {
    let mut moves = Vec::with_capacity(32);
    if snapshot.status == Phase::Playing {
        generate(&cells_of(&snapshot.board), snapshot.to_play, &mut moves);
    }
    moves
}

#[derive(Debug, PartialEq, Eq)]
pub enum RuleError {
    GameOver,
    Illegal(Move),
}

/// Terminal checks in profile order: den, elimination, immobilization, repetition, no-capture.
/// `occurrences` counts the new position, as `position_occurrences` returns it.
pub fn adjudicate(cells: &Cells, mover: Side, dst: usize, quiet: u32, occurrences: u32) -> (Phase, Option<Side>, Reason) {
    let defender = mover.opponent();
    if dst == DEN[defender.index()] as usize {
        (Phase::Won, Some(mover), Reason::Den)
    } else if piece_count(cells, defender) == 0 {
        (Phase::Won, Some(mover), Reason::Elimination)
    } else if !has_legal_move(cells, defender) {
        (Phase::Won, Some(mover), Reason::Immobilization)
    } else if occurrences >= REPETITION_LIMIT {
        (Phase::Drawn, None, Reason::Repetition)
    } else if quiet >= NO_CAPTURE_LIMIT {
        (Phase::Drawn, None, Reason::NoCapture)
    } else {
        (Phase::Playing, None, Reason::None)
    }
}

/// Commit one legal move. `to_play` passes to the opponent even on a terminal move.
pub fn apply_move(snapshot: &Snapshot, mv: Move) -> Result<Snapshot, RuleError> {
    if snapshot.status != Phase::Playing {
        return Err(RuleError::GameOver);
    }
    if !legal_moves(snapshot).contains(&mv) {
        return Err(RuleError::Illegal(mv));
    }
    let mut cells = cells_of(&snapshot.board);
    let captured = cells[mv.dst as usize] != 0;
    cells[mv.dst as usize] = cells[mv.src as usize];
    cells[mv.src as usize] = 0;
    let quiet = if captured { 0 } else { snapshot.no_capture_plies + 1 };
    let mut history = snapshot.history.clone();
    history.push(mv);
    let occurrences = position_occurrences(&cells, snapshot.to_play.opponent(), &history, quiet);
    let (status, winner, reason) = adjudicate(&cells, snapshot.to_play, mv.dst as usize, quiet, occurrences);
    Ok(Snapshot {
        rev: snapshot.rev + 1,
        board: board_of(&cells),
        first_side: snapshot.first_side,
        to_play: snapshot.to_play.opponent(),
        history,
        no_capture_plies: quiet,
        status,
        winner,
        reason,
    })
}

/// Award the game to the other side; board, turn, counters and history are unchanged.
pub fn forfeit(snapshot: &Snapshot, loser: Side, reason: Reason) -> Result<Snapshot, RuleError> {
    if snapshot.status != Phase::Playing {
        return Err(RuleError::GameOver);
    }
    Ok(Snapshot { rev: snapshot.rev + 1, status: Phase::Forfeited, winner: Some(loser.opponent()), reason, ..snapshot.clone() })
}

/// The piece a move captured, if `after` follows `before` by `mv`.
pub fn captured_by(before: &Snapshot, mv: Move) -> Option<Piece> {
    before.board[mv.dst as usize]
}
