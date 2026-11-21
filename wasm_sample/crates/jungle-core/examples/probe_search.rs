//! Print nodes searched and depth reached per budget: `cargo run --release --example probe_search`.
use jungle_core::rules::*;
use jungle_core::search::{search, SearchParams};
use jungle_core::*;

fn main() {
    let s = apply_move(&initial_snapshot(Side::Red), Move { src: 42, dst: 35 }).unwrap();
    for (level, budget) in [(Level::Easy, 2_000), (Level::Medium, 30_000), (Level::Hard, 300_000)] {
        let t = std::time::Instant::now();
        let r = search(&cells_of(&s.board), s.to_play, s.no_capture_plies, s.rev, SearchParams { node_budget: budget, seed: 11, level });
        println!("{level:?} budget {budget}: nodes {} depth {} best {:?} score {} in {:?}", r.nodes, r.depth, r.best, r.score, t.elapsed());
    }
}
