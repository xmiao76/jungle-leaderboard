//! Write raw RGBA frames for visual review: `cargo run -p jungle-core --example dump_frame -- out_dir`.
use jungle_core::render::{overlay_for, Renderer};
use jungle_core::rules::*;
use jungle_core::*;

fn main() {
    let out = std::env::args().nth(1).unwrap_or_else(|| ".".into());
    let mut s = initial_snapshot(Side::Red);
    for _ in 0..7 {
        let m = legal_moves(&s)[legal_moves(&s).len() / 2];
        s = apply_move(&s, m).unwrap();
    }
    let mut r = Renderer::default();
    std::fs::write(format!("{out}/opening.rgba"), r.render(&initial_snapshot(Side::Red), false, 1000, None)).unwrap();
    let ov = overlay_for(&s, legal_moves(&s)[0].src);
    std::fs::write(format!("{out}/midgame-overlay.rgba"), r.render(&s, false, 1000, Some(&ov))).unwrap();
    std::fs::write(format!("{out}/midgame-flipped-anim.rgba"), r.render(&s, true, 450, None)).unwrap();
    let f = forfeit(&s, Side::Blue, Reason::Timeout).unwrap();
    std::fs::write(format!("{out}/forfeit.rgba"), r.render(&f, false, 1000, None)).unwrap();
}
