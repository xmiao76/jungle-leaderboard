//! The portable conformance cases, adjudication rows and opening handshake from the
//! brief (spec/fixtures), run against the core rules.

use jungle_core::rules::*;
use jungle_core::*;
use serde_json::Value;

const MOVES: &str = include_str!("../../../spec/fixtures/moves.json");
const ADJUDICATION: &str = include_str!("../../../spec/fixtures/adjudication.json");
const OPENING: &str = include_str!("../../../spec/fixtures/opening.json");

fn piece(text: &str) -> Piece {
    let (side, kind) = text.split_once(':').unwrap();
    Piece { owner: if side == "red" { Side::Red } else { Side::Blue }, kind: Animal::from_name(kind).unwrap() }
}

fn sparse(cells: &Value, to_play: Side, quiet: u32) -> Snapshot {
    let mut board: Board = [None; SQUARES];
    for (square, text) in cells.as_object().unwrap() {
        board[square.parse::<usize>().unwrap()] = Some(piece(text.as_str().unwrap()));
    }
    Snapshot {
        rev: 0,
        board,
        first_side: to_play,
        to_play,
        history: vec![],
        no_capture_plies: quiet,
        status: Phase::Playing,
        winner: None,
        reason: Reason::None,
    }
}

fn mv(pair: &Value) -> Move {
    Move { src: pair[0].as_u64().unwrap() as u8, dst: pair[1].as_u64().unwrap() as u8 }
}

#[test]
fn portable_conformance_cases() {
    let cases: Vec<Value> = serde_json::from_str(MOVES).unwrap();
    assert_eq!(cases.len(), 23);
    for case in &cases {
        let snapshot = sparse(&case["board"], Side::Red, 0);
        let candidate = mv(&case["move"]);
        let expected = case["legal"].as_bool().unwrap();
        assert_eq!(legal_moves(&snapshot).contains(&candidate), expected, "case {}", case["name"]);
    }
}

/// A row commits one `move`, or several `moves` in order (Red first, alternating sides).
fn plies(row: &Value) -> Vec<Move> {
    match row["moves"].as_array() {
        Some(list) => list.iter().map(mv).collect(),
        None => vec![mv(&row["move"])],
    }
}

#[test]
fn adjudication_rows() {
    let rows: Vec<Value> = serde_json::from_str(ADJUDICATION).unwrap();
    assert!(rows.iter().any(|r| r["reason"] == "repetition"), "the brief's repetition rows are present");
    for row in &rows {
        let before = sparse(&row["board"], Side::Red, row["quietBefore"].as_u64().unwrap() as u32);
        let sequence = plies(row);
        let after = sequence.iter().fold(before.clone(), |s, &m| apply_move(&s, m).unwrap());
        let name = row["name"].as_str().unwrap();
        assert_eq!(after.no_capture_plies as u64, row["quietAfter"].as_u64().unwrap(), "{name}");
        let status = match after.status {
            Phase::Playing => "playing",
            Phase::Won => "won",
            Phase::Drawn => "drawn",
            Phase::Forfeited => "forfeited",
        };
        assert_eq!(status, row["status"].as_str().unwrap(), "{name}");
        assert_eq!(after.winner.map(Side::name), row["winner"].as_str(), "{name}");
        assert_eq!(after.reason.as_str(), row["reason"].as_str().unwrap(), "{name}");
        assert_eq!(after.rev, before.rev + sequence.len() as u32, "{name}");
        assert_eq!(after.history.len(), sequence.len(), "{name}");
        let expected_turn = if sequence.len() % 2 == 1 { Side::Blue } else { Side::Red };
        assert_eq!(after.to_play, expected_turn, "{name}: to-play passes even on a terminal move");
    }
}

#[test]
fn repetition_counts_positions_from_the_history() {
    let board: Value = serde_json::json!({ "42": "red:cat", "6": "blue:dog" });
    let loop_moves = [(42, 43), (6, 5), (43, 42), (5, 6)].map(|(src, dst)| Move { src, dst });
    let mut s = sparse(&board, Side::Red, 0);
    let mut counts = vec![];
    for &m in loop_moves.iter().chain(loop_moves.iter()) {
        s = apply_move(&s, m).unwrap();
        counts.push(position_occurrences(&cells_of(&s.board), s.to_play, &s.history, s.no_capture_plies));
    }
    assert_eq!(counts, [1, 1, 1, 2, 2, 2, 2, 3]);
    assert_eq!((s.status, s.reason), (Phase::Drawn, Reason::Repetition));
}

#[test]
fn repetition_never_reaches_back_past_a_capture() {
    let board: Value = serde_json::json!({ "42": "red:wolf", "43": "blue:cat", "6": "blue:dog" });
    let s = apply_move(&sparse(&board, Side::Red, 0), Move { src: 42, dst: 43 }).unwrap();
    assert_eq!(s.no_capture_plies, 0);
    assert!(earlier_positions(&cells_of(&s.board), s.to_play, &s.history, s.no_capture_plies).is_empty());
}

#[test]
fn opening_handshake() {
    let opening: Value = serde_json::from_str(OPENING).unwrap();
    let red = initial_snapshot(Side::Red);
    let blue = initial_snapshot(Side::Blue);
    let red_legal = legal_moves(&red);
    assert_eq!(red_legal.len(), 24);
    assert_eq!(legal_moves(&blue).len(), 24);
    assert_eq!(red_legal[0], mv(&opening["redFirst"]["index0"]));
    assert_eq!(red_legal[23], mv(&opening["redFirst"]["index23"]));
    assert_eq!(legal_moves(&blue)[0], mv(&opening["blueFirst"]["index0"]));
    let mut sorted = red_legal.clone();
    sorted.sort();
    assert_eq!(red_legal, sorted, "legal list is sorted by (src, dst)");

    let after = apply_move(&red, red_legal[0]).unwrap();
    assert_eq!(after.rev, 1);
    assert_eq!(after.board[42], None);
    assert_eq!(after.board[35], Some(Piece { owner: Side::Red, kind: Animal::Elephant }));
    assert_eq!(after.no_capture_plies, 1);
    assert_eq!(after.history, vec![Move { src: 42, dst: 35 }]);
    assert_eq!(after.to_play, Side::Blue);
}

#[test]
fn forfeit_keeps_board_turn_counters_and_history() {
    let s = apply_move(&initial_snapshot(Side::Red), Move { src: 42, dst: 35 }).unwrap();
    let f = forfeit(&s, Side::Blue, Reason::Timeout).unwrap();
    assert_eq!(f.rev, s.rev + 1);
    assert_eq!((f.status, f.winner, f.reason), (Phase::Forfeited, Some(Side::Red), Reason::Timeout));
    assert_eq!((f.board, f.to_play, f.no_capture_plies, &f.history), (s.board, s.to_play, s.no_capture_plies, &s.history));
    assert_eq!(forfeit(&f, Side::Red, Reason::Trap), Err(RuleError::GameOver));
}

#[test]
fn illegal_and_late_moves_are_refused() {
    let s = initial_snapshot(Side::Red);
    assert_eq!(apply_move(&s, Move { src: 42, dst: 44 }), Err(RuleError::Illegal(Move { src: 42, dst: 44 })));
    assert_eq!(apply_move(&s, Move { src: 14, dst: 15 }), Err(RuleError::Illegal(Move { src: 14, dst: 15 })));
}

#[test]
fn cell_encoding_round_trips() {
    let s = initial_snapshot(Side::Red);
    assert_eq!(board_of(&cells_of(&s.board)), s.board);
}
