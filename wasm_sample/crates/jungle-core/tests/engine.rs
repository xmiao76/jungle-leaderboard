//! Search determinism and budget accounting, and renderer invariants.

use jungle_core::render::{self, cell_origin, square_at, Overlay, Renderer, FRAME_BYTES, WIDTH};
use jungle_core::rules::*;
use jungle_core::search::{choose_index, search, SearchParams};
use jungle_core::*;

fn params(budget: u32, seed: u32) -> SearchParams {
    SearchParams { node_budget: budget, seed, level: Level::Medium, deadline: None }
}

fn play_first(n: usize) -> Snapshot {
    let mut s = initial_snapshot(Side::Red);
    for _ in 0..n {
        let m = legal_moves(&s)[0];
        s = apply_move(&s, m).unwrap();
    }
    s
}

#[test]
fn equal_seed_and_budget_reproduce_the_choice() {
    let s = play_first(5);
    let legal = legal_moves(&s);
    let a = choose_index(&s, &legal, params(20_000, 7));
    let b = choose_index(&s, &legal, params(20_000, 7));
    assert_eq!(a, b);
    assert!((a as usize) < legal.len());
}

#[test]
fn never_exceeds_the_node_budget() {
    let s = play_first(3);
    for budget in [1, 2, 50, 1_000, 25_000] {
        let r = search(&cells_of(&s.board), s.to_play, s.no_capture_plies, s.rev, params(budget, 1));
        assert!(r.nodes <= budget, "budget {budget}: {} nodes", r.nodes);
        // None of these budgets is enough to finish, so each must be spent exactly.
        assert_eq!(r.nodes, budget, "budget {budget} not fully used");
        assert!(legal_moves(&s).contains(&r.best));
    }
}

#[test]
fn a_passed_deadline_aborts_the_search_and_still_returns_a_legal_move() {
    // A clock that only ever moves forward, one millisecond per call: the deadline
    // check fires at most every 1024 visits, so the search must stop far below the
    // huge node budget and keep the best move of its last completed iteration.
    static NOW: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
    fn clock() -> f64 {
        NOW.fetch_add(1, std::sync::atomic::Ordering::Relaxed) as f64
    }
    let s = play_first(3);
    let p = SearchParams { node_budget: u32::MAX, seed: 1, level: Level::Hard, deadline: Some((50.0, clock)) };
    let r = search(&cells_of(&s.board), s.to_play, s.no_capture_plies, s.rev, p);
    assert!(legal_moves(&s).contains(&r.best));
    assert!(r.nodes < 200_000, "deadline did not stop the search: {} nodes", r.nodes);
}

#[test]
fn renders_a_history_square_off_the_board_without_panicking() {
    let mut s = play_first(2);
    s.history.push(Move { src: 200, dst: 250 });
    let mut r = Renderer::default();
    assert_eq!(r.render(&s, false, 300, None).len(), FRAME_BYTES);
}

#[test]
fn a_zero_budget_still_returns_a_legal_move() {
    let s = initial_snapshot(Side::Blue);
    let legal = legal_moves(&s);
    let index = choose_index(&s, &legal, params(0, 3));
    assert!((index as usize) < legal.len());
}

#[test]
fn takes_the_den_when_it_can() {
    let mut board: Board = [None; SQUARES];
    board[10] = Some(Piece { owner: Side::Red, kind: Animal::Cat }); // next to blue den (3)? 10 is below 3
    board[2] = None;
    board[4] = Some(Piece { owner: Side::Red, kind: Animal::Dog });
    board[0] = Some(Piece { owner: Side::Blue, kind: Animal::Rat });
    let s = Snapshot { board, ..initial_snapshot(Side::Red) };
    let legal = legal_moves(&s);
    let index = choose_index(&s, &legal, params(5_000, 9));
    assert_eq!(legal[index as usize].dst, 3, "den entry wins immediately");
}

#[test]
fn captures_a_free_elephant_with_the_rat() {
    let mut board: Board = [None; SQUARES];
    board[42] = Some(Piece { owner: Side::Red, kind: Animal::Rat });
    board[43] = Some(Piece { owner: Side::Blue, kind: Animal::Elephant });
    board[0] = Some(Piece { owner: Side::Blue, kind: Animal::Cat });
    board[62] = Some(Piece { owner: Side::Red, kind: Animal::Tiger });
    let s = Snapshot { board, ..initial_snapshot(Side::Red) };
    let legal = legal_moves(&s);
    let index = choose_index(&s, &legal, params(10_000, 4));
    assert_eq!(legal[index as usize], Move { src: 42, dst: 43 });
}

#[test]
fn renders_one_full_frame_and_rendering_does_not_change_the_choice() {
    let s = play_first(4);
    let legal = legal_moves(&s);
    let before = choose_index(&s, &legal, params(8_000, 11));
    let mut r = Renderer::default();
    assert_eq!(r.render(&s, false, 1000, None).len(), FRAME_BYTES);
    r.render(&s, true, 400, None);
    let after = choose_index(&s, &legal, params(8_000, 11));
    assert_eq!(before, after);
}

#[test]
fn flip_maps_pixels_and_pointer_together() {
    for square in [0u8, 3, 31, 59, 62] {
        for flipped in [false, true] {
            let (x, y) = cell_origin(square, flipped);
            assert_eq!(square_at(x + 32, y + 32, flipped), Some(square));
        }
    }
    assert_eq!(cell_origin(0, true), cell_origin(62, false));
    assert_eq!(square_at(WIDTH, 0, false), None);
}

#[test]
fn flipped_frame_differs_and_settled_frames_are_reproducible() {
    let s = play_first(6);
    let mut r = Renderer::default();
    let plain = r.render(&s, false, 1000, None).to_vec();
    let flipped = r.render(&s, true, 1000, None).to_vec();
    let animated = r.render(&s, false, 300, None).to_vec();
    let again = r.render(&s, false, 1000, None).to_vec();
    assert_ne!(plain, flipped);
    assert_ne!(plain, animated, "progress < 1000 shows the move in flight");
    assert_eq!(plain, again, "a settled frame depends only on the snapshot");
}

#[test]
fn pieces_carry_their_label_inside_their_own_square() {
    // A label is drawn in white on the piece; probe for bright pixels in the label band.
    let s = initial_snapshot(Side::Red);
    let mut r = Renderer::default();
    let frame = r.render(&s, false, 1000, None).to_vec();
    let (x, y) = cell_origin(42, false); // red elephant
    let mut bright = 0;
    for yy in y + 46..y + 58 {
        for xx in x + 10..x + 54 {
            let i = ((yy * WIDTH + xx) * 4) as usize;
            if frame[i] > 230 && frame[i + 1] > 230 && frame[i + 2] > 230 {
                bright += 1;
            }
        }
    }
    assert!(bright > 25, "expected label pixels, found {bright}");
}

#[test]
fn overlay_marks_moves_and_captures_for_the_selected_piece() {
    let mut board: Board = [None; SQUARES];
    board[42] = Some(Piece { owner: Side::Red, kind: Animal::Wolf });
    board[43] = Some(Piece { owner: Side::Blue, kind: Animal::Cat });
    board[0] = Some(Piece { owner: Side::Blue, kind: Animal::Rat });
    let s = Snapshot { board, ..initial_snapshot(Side::Red) };
    let ov: Overlay = render::overlay_for(&s, 42);
    assert_eq!(ov.captures, vec![43]);
    assert_eq!(ov.targets, vec![35, 49]);
}

#[test]
fn terminal_and_forfeit_snapshots_render() {
    let s = play_first(2);
    let f = forfeit(&s, Side::Blue, Reason::Timeout).unwrap();
    let mut r = Renderer::default();
    let live = r.render(&s, false, 1000, None).to_vec();
    let over = r.render(&f, false, 1000, None).to_vec();
    assert_ne!(live, over, "the result banner is drawn");
}

/// Blue starts a shuffle (dog 6↔5) and Red mirrors it (cat 42↔43). After seven plies Red is
/// to move with the cat on 43, and 43 → 42 would recreate the starting position for the third
/// time: a draw by repetition. `extra` decides who is ahead.
fn shuffled(extra: (usize, Piece)) -> Snapshot {
    let mut board: Board = [None; SQUARES];
    board[42] = Some(Piece { owner: Side::Red, kind: Animal::Cat });
    board[6] = Some(Piece { owner: Side::Blue, kind: Animal::Dog });
    board[extra.0] = Some(extra.1);
    let start = Snapshot {
        rev: 0,
        board,
        first_side: Side::Blue,
        to_play: Side::Blue,
        history: vec![],
        no_capture_plies: 0,
        status: Phase::Playing,
        winner: None,
        reason: Reason::None,
    };
    [(6, 5), (42, 43), (5, 6), (43, 42), (6, 5), (42, 43), (5, 6)]
        .iter()
        .fold(start, |s, &(src, dst)| apply_move(&s, Move { src, dst }).unwrap())
}

const BACK: Move = Move { src: 43, dst: 42 };

#[test]
fn the_shuffle_fixture_really_ends_in_a_repetition() {
    let s = shuffled((62, Piece { owner: Side::Red, kind: Animal::Elephant }));
    let drawn = apply_move(&s, BACK).unwrap();
    assert_eq!((drawn.status, drawn.reason), (Phase::Drawn, Reason::Repetition));
}

#[test]
fn ahead_it_refuses_the_move_that_draws_by_repetition() {
    let s = shuffled((62, Piece { owner: Side::Red, kind: Animal::Elephant }));
    let legal = legal_moves(&s);
    let chosen = legal[choose_index(&s, &legal, params(20_000, 5)) as usize];
    assert_ne!(chosen, BACK, "a side that is ahead keeps playing instead of repeating");
}

#[test]
fn behind_it_takes_the_draw_by_repetition() {
    let s = shuffled((0, Piece { owner: Side::Blue, kind: Animal::Elephant }));
    let legal = legal_moves(&s);
    let chosen = legal[choose_index(&s, &legal, params(20_000, 5)) as usize];
    assert_eq!(chosen, BACK, "a side that is behind settles for the draw");
}

#[test]
fn without_the_game_history_the_repetition_is_invisible() {
    // The same board searched as a fresh position: the third occurrence cannot be known, so
    // stepping back is just another move. This is why choose_index passes the history.
    let s = shuffled((0, Piece { owner: Side::Blue, kind: Animal::Elephant }));
    let fresh = search(&cells_of(&s.board), s.to_play, s.no_capture_plies, s.rev, params(20_000, 5));
    let informed = choose_index(&s, &legal_moves(&s), params(20_000, 5));
    assert_eq!(legal_moves(&s)[informed as usize], BACK);
    assert!(fresh.score < 0, "fresh search sees only a material deficit, got {}", fresh.score);
}
