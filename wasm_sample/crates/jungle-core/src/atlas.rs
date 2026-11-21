//! The embedded sprite atlas (see scripts/build-atlas.mjs): premultiplied RGBA sprites,
//! raw-deflated, inflated once on first use.

use std::sync::OnceLock;

static PACKED: &[u8] = include_bytes!("../assets/atlas.bin");
static ATLAS: OnceLock<Atlas> = OnceLock::new();

pub struct Sprite {
    pub width: usize,
    pub height: usize,
    offset: usize,
}

pub struct Atlas {
    pixels: Vec<u8>,
    sprites: Vec<(String, Sprite)>,
}

impl Atlas {
    pub fn get() -> &'static Atlas {
        ATLAS.get_or_init(|| Atlas::parse(&miniz_oxide::inflate::decompress_to_vec(PACKED).expect("embedded atlas is valid")))
    }

    fn parse(raw: &[u8]) -> Atlas {
        assert_eq!(&raw[0..4], b"JATL", "atlas magic");
        let count = u16::from_le_bytes([raw[6], raw[7]]) as usize;
        let mut pos = 8;
        let mut sprites = Vec::with_capacity(count);
        for _ in 0..count {
            let len = raw[pos] as usize;
            let name = String::from_utf8_lossy(&raw[pos + 1..pos + 1 + len]).into_owned();
            pos += 1 + len;
            let width = u16::from_le_bytes([raw[pos], raw[pos + 1]]) as usize;
            let height = u16::from_le_bytes([raw[pos + 2], raw[pos + 3]]) as usize;
            let offset = u32::from_le_bytes([raw[pos + 4], raw[pos + 5], raw[pos + 6], raw[pos + 7]]) as usize;
            pos += 8;
            sprites.push((name, Sprite { width, height, offset }));
        }
        Atlas { pixels: raw[pos..].to_vec(), sprites }
    }

    pub fn sprite(&self, name: &str) -> Option<&Sprite> {
        self.sprites.iter().find(|(n, _)| n == name).map(|(_, s)| s)
    }

    pub fn pixels(&self, sprite: &Sprite) -> &[u8] {
        &self.pixels[sprite.offset..sprite.offset + sprite.width * sprite.height * 4]
    }
}
