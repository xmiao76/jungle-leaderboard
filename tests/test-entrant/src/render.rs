//! Software rasterizer for the 448×576 RGBA8 frame the contract requires.

use crate::font::{glyph, text_width, ADVANCE, GLYPH_W};

pub const SQ: i32 = 64;
pub const COLS: i32 = 7;
pub const ROWS: i32 = 9;
pub const WIDTH: i32 = SQ * COLS;
pub const HEIGHT: i32 = SQ * ROWS;

pub type Rgba = [u8; 4];

pub struct Canvas {
    pub pixels: Vec<u8>,
}

impl Canvas {
    pub fn new(fill: Rgba) -> Self {
        let mut pixels = Vec::with_capacity((WIDTH * HEIGHT * 4) as usize);
        for _ in 0..WIDTH * HEIGHT {
            pixels.extend_from_slice(&fill);
        }
        Self { pixels }
    }

    fn blend(&mut self, x: i32, y: i32, c: Rgba) {
        if x < 0 || y < 0 || x >= WIDTH || y >= HEIGHT {
            return;
        }
        let i = ((y * WIDTH + x) * 4) as usize;
        let a = c[3] as u32;
        for k in 0..3 {
            let dst = self.pixels[i + k] as u32;
            self.pixels[i + k] = ((c[k] as u32 * a + dst * (255 - a)) / 255) as u8;
        }
        self.pixels[i + 3] = 255;
    }

    pub fn fill_rect(&mut self, x: i32, y: i32, w: i32, h: i32, c: Rgba) {
        for yy in y.max(0)..(y + h).min(HEIGHT) {
            for xx in x.max(0)..(x + w).min(WIDTH) {
                self.blend(xx, yy, c);
            }
        }
    }

    pub fn outline(&mut self, x: i32, y: i32, w: i32, h: i32, t: i32, c: Rgba) {
        self.fill_rect(x, y, w, t, c);
        self.fill_rect(x, y + h - t, w, t, c);
        self.fill_rect(x, y + t, t, h - 2 * t, c);
        self.fill_rect(x + w - t, y + t, t, h - 2 * t, c);
    }

    pub fn disc(&mut self, cx: i32, cy: i32, r: i32, c: Rgba) {
        let r2 = r * r;
        for dy in -r..=r {
            for dx in -r..=r {
                if dx * dx + dy * dy <= r2 {
                    self.blend(cx + dx, cy + dy, c);
                }
            }
        }
    }

    pub fn text(&mut self, x: i32, y: i32, scale: i32, text: &str, c: Rgba) {
        let mut pen = x;
        for ch in text.chars() {
            let rows = glyph(ch);
            for (row, bits) in rows.iter().enumerate() {
                for col in 0..GLYPH_W {
                    if bits & (1 << (GLYPH_W - 1 - col)) != 0 {
                        self.fill_rect(pen + col * scale, y + row as i32 * scale, scale, scale, c);
                    }
                }
            }
            pen += ADVANCE * scale;
        }
    }

    pub fn text_centered(&mut self, cx: i32, y: i32, scale: i32, text: &str, c: Rgba) {
        self.text(cx - text_width(text, scale) / 2, y, scale, text, c);
    }

}
