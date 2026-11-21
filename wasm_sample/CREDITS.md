# Credits and licences

| Asset | Source | Licence | Where it is used |
|---|---|---|---|
| Animal artwork (rat, cat, dog, wolf, leopard, tiger, lion, elephant) | [Twemoji 15.1.0](https://github.com/jdecked/twemoji) — © Twitter, Inc and other contributors | [CC-BY 4.0](https://creativecommons.org/licenses/by/4.0/) | Rasterized at build time into the sprite atlas embedded in both the standalone game and `jungle-opus55-1.0.0.wasm`. Unmodified apart from scaling. |
| IBM Plex Sans Bold | [IBM/plex v6.4.0](https://github.com/IBM/plex) | [SIL Open Font License 1.1](https://openfontlicense.org/) | Used at build time only, to rasterize the English piece labels and result banners into the atlas. The font file itself is not shipped. |
| Board tiles (land, river, traps, dens) | Original, drawn in `scripts/build-atlas.mjs` | Same as this project | Atlas |
| Sound effects | Original, synthesized at run time with Web Audio (`web/src/audio.ts`) | Same as this project | Standalone game |

Pinned download URLs and SHA-256 hashes of the third-party files are in
[`assets/SOURCES.json`](assets/SOURCES.json); `node scripts/fetch-assets.mjs` verifies them.

The attribution above is also shown in the game's footer, in the release manifest's catalog entry in
the Jungle Arena, and in the Arena's README.
