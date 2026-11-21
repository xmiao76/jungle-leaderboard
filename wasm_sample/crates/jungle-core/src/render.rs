//! Board renderer: one 448 × 576 RGBA8 frame (7 × 9 squares of 64 px), top row first.
//!
//! Every settled frame (`progress == 1000`) is reconstructed from the snapshot alone, so
//! seeking straight to any revision draws it correctly. Rendering never touches search
//! state or randomness. The standalone shell passes an `Overlay` for selection and move
//! hints; the Arena entrant never does.

use crate::atlas::{Atlas, Sprite};
use crate::rules::{self, den_owner, is_water, trap_owner};
use crate::types::*;

pub const SQ: i32 = 64;
pub const WIDTH: i32 = SQ * COLS as i32;
pub const HEIGHT: i32 = SQ * ROWS as i32;
pub const FRAME_BYTES: usize = (WIDTH * HEIGHT * 4) as usize;

type Rgb = [u8; 3];
const RED: Rgb = [200, 69, 47];
const RED_DARK: Rgb = [140, 40, 26];
const BLUE: Rgb = [46, 95, 191];
const BLUE_DARK: Rgb = [26, 58, 128];
const CREAM: Rgb = [251, 246, 234];
const GOLD: Rgb = [242, 193, 78];
const INK: Rgb = [27, 32, 22];

/// Standalone-only hints drawn under the pieces.
#[derive(Clone, Debug, Default)]
pub struct Overlay {
    pub selected: Option<u8>,
    pub targets: Vec<u8>,
    pub captures: Vec<u8>,
}

pub struct Canvas {
    pub pixels: Vec<u8>,
}

impl Default for Canvas {
    fn default() -> Self {
        Canvas { pixels: vec![255; FRAME_BYTES] }
    }
}

impl Canvas {
    #[inline]
    fn blend(&mut self, x: i32, y: i32, rgb: Rgb, alpha: f32) {
        if x < 0 || y < 0 || x >= WIDTH || y >= HEIGHT || alpha <= 0.0 {
            return;
        }
        let i = ((y * WIDTH + x) * 4) as usize;
        let a = alpha.min(1.0);
        for k in 0..3 {
            let d = self.pixels[i + k] as f32;
            self.pixels[i + k] = (rgb[k] as f32 * a + d * (1.0 - a)).round() as u8;
        }
        self.pixels[i + 3] = 255;
    }

    /// Composite a premultiplied sprite with its top-left at (x, y).
    pub fn blit(&mut self, sprite: &Sprite, pixels: &[u8], x: i32, y: i32, opacity: f32) {
        for sy in 0..sprite.height as i32 {
            let ty = y + sy;
            if ty < 0 || ty >= HEIGHT {
                continue;
            }
            for sx in 0..sprite.width as i32 {
                let tx = x + sx;
                if tx < 0 || tx >= WIDTH {
                    continue;
                }
                let s = ((sy * sprite.width as i32 + sx) * 4) as usize;
                let a = pixels[s + 3] as f32 / 255.0 * opacity;
                if a <= 0.0 {
                    continue;
                }
                let d = ((ty * WIDTH + tx) * 4) as usize;
                for k in 0..3 {
                    let src = pixels[s + k] as f32 * opacity;
                    self.pixels[d + k] = (src + self.pixels[d + k] as f32 * (1.0 - a)).round().clamp(0.0, 255.0) as u8;
                }
                self.pixels[d + 3] = 255;
            }
        }
    }

    pub fn blit_named(&mut self, name: &str, x: i32, y: i32, opacity: f32) {
        let atlas = Atlas::get();
        if let Some(sprite) = atlas.sprite(name) {
            self.blit(sprite, atlas.pixels(sprite), x, y, opacity);
        }
    }

    pub fn blit_centered(&mut self, name: &str, cx: i32, cy: i32, opacity: f32) {
        let atlas = Atlas::get();
        if let Some(sprite) = atlas.sprite(name) {
            self.blit(sprite, atlas.pixels(sprite), cx - sprite.width as i32 / 2, cy - sprite.height as i32 / 2, opacity);
        }
    }

    /// Anti-aliased filled disc; `shade` darkens the lower half for depth.
    pub fn disc(&mut self, cx: f32, cy: f32, r: f32, top: Rgb, bottom: Rgb, opacity: f32) {
        let (x0, x1) = ((cx - r - 1.0) as i32, (cx + r + 1.0) as i32);
        let (y0, y1) = ((cy - r - 1.0) as i32, (cy + r + 1.0) as i32);
        for y in y0..=y1 {
            for x in x0..=x1 {
                let dx = x as f32 + 0.5 - cx;
                let dy = y as f32 + 0.5 - cy;
                let coverage = (r - (dx * dx + dy * dy).sqrt() + 0.5).clamp(0.0, 1.0);
                if coverage > 0.0 {
                    let t = ((dy / r) * 0.5 + 0.5).clamp(0.0, 1.0);
                    let rgb = [
                        (top[0] as f32 * (1.0 - t) + bottom[0] as f32 * t) as u8,
                        (top[1] as f32 * (1.0 - t) + bottom[1] as f32 * t) as u8,
                        (top[2] as f32 * (1.0 - t) + bottom[2] as f32 * t) as u8,
                    ];
                    self.blend(x, y, rgb, coverage * opacity);
                }
            }
        }
    }

    /// Anti-aliased ring of the given thickness.
    pub fn ring(&mut self, cx: f32, cy: f32, r: f32, thickness: f32, rgb: Rgb, opacity: f32) {
        let outer = r + thickness / 2.0;
        let (x0, x1) = ((cx - outer - 1.0) as i32, (cx + outer + 1.0) as i32);
        let (y0, y1) = ((cy - outer - 1.0) as i32, (cy + outer + 1.0) as i32);
        for y in y0..=y1 {
            for x in x0..=x1 {
                let d = ((x as f32 + 0.5 - cx).powi(2) + (y as f32 + 0.5 - cy).powi(2)).sqrt();
                let coverage = (thickness / 2.0 - (d - r).abs() + 0.5).clamp(0.0, 1.0);
                self.blend(x, y, rgb, coverage * opacity);
            }
        }
    }

    pub fn fill_rect(&mut self, x: i32, y: i32, w: i32, h: i32, rgb: Rgb, opacity: f32) {
        for yy in y.max(0)..(y + h).min(HEIGHT) {
            for xx in x.max(0)..(x + w).min(WIDTH) {
                self.blend(xx, yy, rgb, opacity);
            }
        }
    }
}

/// Top-left pixel of a board square in the requested view. Flipping maps square i to cell 62 - i.
pub fn cell_origin(square: u8, flipped: bool) -> (i32, i32) {
    let cell = if flipped { 62 - square as i32 } else { square as i32 };
    ((cell % COLS as i32) * SQ, (cell / COLS as i32) * SQ)
}

/// The board square under a frame pixel, honouring the same flip mapping.
pub fn square_at(x: i32, y: i32, flipped: bool) -> Option<u8> {
    if x < 0 || y < 0 || x >= WIDTH || y >= HEIGHT {
        return None;
    }
    let cell = (y / SQ) * COLS as i32 + x / SQ;
    Some(if flipped { 62 - cell } else { cell } as u8)
}

fn tile_name(square: usize, flipped: bool) -> &'static str {
    if is_water(square) {
        return "tile-water";
    }
    if let Some(owner) = trap_owner(square) {
        return if owner == Side::Red { "tile-trap-red" } else { "tile-trap-blue" };
    }
    if let Some(owner) = den_owner(square) {
        return if owner == Side::Red { "tile-den-red" } else { "tile-den-blue" };
    }
    // Checker the land relative to the view so both orientations look alike.
    let cell = if flipped { 62 - square } else { square };
    if (cell / COLS + cell % COLS) % 2 == 0 { "tile-land-a" } else { "tile-land-b" }
}

fn draw_piece(canvas: &mut Canvas, piece: Piece, cx: f32, cy: f32, opacity: f32) {
    let (light, dark) = match piece.owner {
        Side::Red => (RED, RED_DARK),
        Side::Blue => (BLUE, BLUE_DARK),
    };
    canvas.disc(cx + 1.5, cy + 3.0, 28.0, INK, INK, 0.28 * opacity); // shadow
    canvas.disc(cx, cy, 28.0, light, dark, opacity);
    canvas.ring(cx, cy, 27.0, 2.0, [255, 255, 255], 0.85 * opacity);
    canvas.disc(cx, cy - 5.0, 18.5, CREAM, [236, 228, 208], opacity);
    canvas.blit_centered(&format!("animal-{}", piece.kind.name()), cx as i32, cy as i32 - 5, opacity);
    canvas.blit_centered(&format!("label-{}", piece.kind.name()), cx as i32, cy as i32 + 19, opacity);
}

fn ease(progress: u16) -> f32 {
    let t = progress as f32 / 1000.0;
    1.0 - (1.0 - t).powi(3)
}

/// Draw `snapshot` into `canvas`. `progress` < 1000 animates the last move.
pub fn draw(canvas: &mut Canvas, snapshot: &Snapshot, flipped: bool, progress: u16, overlay: Option<&Overlay>) {
    let progress = progress.min(1000);
    for square in 0..SQUARES {
        let (x, y) = cell_origin(square as u8, flipped);
        canvas.blit_named(tile_name(square, flipped), x, y, 1.0);
    }
    canvas.blit_centered("mark", WIDTH / 2, HEIGHT - 7, 0.55);

    let last = snapshot.history.last().copied();
    if let Some(mv) = last {
        let (sx, sy) = cell_origin(mv.src, flipped);
        canvas.fill_rect(sx, sy, SQ, SQ, GOLD, 0.28);
        let (dx, dy) = cell_origin(mv.dst, flipped);
        canvas.fill_rect(dx, dy, SQ, SQ, GOLD, 0.22);
    }

    if let Some(ov) = overlay {
        if let Some(sel) = ov.selected {
            let (x, y) = cell_origin(sel, flipped);
            canvas.ring(x as f32 + 32.0, y as f32 + 32.0, 30.0, 3.5, GOLD, 1.0);
        }
        for &t in &ov.targets {
            let (x, y) = cell_origin(t, flipped);
            canvas.disc(x as f32 + 32.0, y as f32 + 32.0, 8.0, INK, INK, 0.45);
        }
        for &c in &ov.captures {
            let (x, y) = cell_origin(c, flipped);
            canvas.ring(x as f32 + 32.0, y as f32 + 32.0, 29.0, 4.0, [220, 38, 38], 0.9);
        }
    }

    // A capture just happened when the quiet counter reset on this ply.
    let captured_now = last.is_some() && snapshot.no_capture_plies == 0;
    let animating = progress < 1000 && last.is_some();
    for square in 0..SQUARES {
        let Some(piece) = snapshot.board[square] else { continue };
        if animating && last.map(|m| m.dst as usize) == Some(square) {
            continue; // drawn last, in flight
        }
        let (x, y) = cell_origin(square as u8, flipped);
        draw_piece(canvas, piece, x as f32 + 32.0, y as f32 + 32.0, 1.0);
    }

    if let (Some(mv), true) = (last, animating) {
        let (dx, dy) = cell_origin(mv.dst, flipped);
        if captured_now {
            let t = progress as f32 / 1000.0;
            canvas.ring(dx as f32 + 32.0, dy as f32 + 32.0, 14.0 + 22.0 * t, 5.0 * (1.0 - t) + 1.0, GOLD, 1.0 - t);
        }
        // History squares come from the host; never trust them as indices.
        if let Some(piece) = snapshot.board.get(mv.dst as usize).copied().flatten() {
            let (sx, sy) = cell_origin(mv.src, flipped);
            let e = ease(progress);
            let cx = sx as f32 + (dx - sx) as f32 * e + 32.0;
            let cy = sy as f32 + (dy - sy) as f32 * e + 32.0 - 6.0 * (std::f32::consts::PI * e).sin();
            draw_piece(canvas, piece, cx, cy, 1.0);
        }
    }

    if snapshot.status != Phase::Playing {
        canvas.fill_rect(0, 4 * SQ - 24, WIDTH, SQ + 48, INK, 0.72);
        let banner = match (snapshot.status, snapshot.winner) {
            (Phase::Drawn, _) => "banner-draw",
            (_, Some(Side::Red)) => "banner-red",
            (_, Some(Side::Blue)) => "banner-blue",
            _ => "banner-draw",
        };
        canvas.blit_centered(banner, WIDTH / 2, 4 * SQ + 14, 1.0);
        if snapshot.reason != Reason::None {
            canvas.blit_centered(&format!("reason-{}", snapshot.reason.as_str()), WIDTH / 2, 4 * SQ + 52, 1.0);
        }
    }
}

/// A reusable renderer that owns its frame buffer.
#[derive(Default)]
pub struct Renderer {
    canvas: Canvas,
}

impl Renderer {
    pub fn render(&mut self, snapshot: &Snapshot, flipped: bool, progress: u16, overlay: Option<&Overlay>) -> &[u8] {
        draw(&mut self.canvas, snapshot, flipped, progress, overlay);
        &self.canvas.pixels
    }
}

/// Squares a piece on `square` can move to, for the standalone move hints.
pub fn overlay_for(snapshot: &Snapshot, square: u8) -> Overlay {
    let legal = rules::legal_moves(snapshot);
    let mut overlay = Overlay { selected: Some(square), ..Overlay::default() };
    for mv in legal.iter().filter(|m| m.src == square) {
        if snapshot.board[mv.dst as usize].is_some() {
            overlay.captures.push(mv.dst);
        } else {
            overlay.targets.push(mv.dst);
        }
    }
    overlay
}
