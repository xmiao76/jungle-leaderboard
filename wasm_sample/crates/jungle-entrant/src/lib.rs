//! Arena entrant `jungle-opus55-1.0.0.wasm`: the jungle-core engine and renderer behind
//! `jungle:arena/competitor@1.0.0`. Per-instance state lives in this instance's memory;
//! the Arena instantiates the binary once per seat.

use std::cell::RefCell;

use jungle_core::render::{Renderer, HEIGHT, WIDTH};
use jungle_core::search::{choose_index, SearchParams};
use jungle_core::{identity, Animal, Level, Move, Phase, Piece, Reason, Side, Snapshot, RULES_DIGEST, RULES_ID, SQUARES};

#[cfg(not(feature = "test-exports"))]
wit_bindgen::generate!({ world: "competitor", path: "../../wit" });

#[cfg(feature = "test-exports")]
wit_bindgen::generate!({
    inline: r#"
        package test:rules;
        interface rules {
            use jungle:arena/game@1.0.0.{snapshot, ply-move};
            legal-moves: func(state: snapshot) -> list<ply-move>;
            apply: func(state: snapshot, mv: ply-move) -> option<snapshot>;
        }
        world competitor-test {
            import jungle:arena/display@1.0.0;
            export jungle:arena/game@1.0.0;
            export rules;
        }
    "#,
    path: "../../wit",
    world: "test:rules/competitor-test",
    generate_all,
});

use exports::jungle::arena::game as wit;
use jungle::arena::display;

struct State {
    level: Level,
    seed: u32,
    renderer: Renderer,
}

thread_local! {
    static STATE: RefCell<State> = RefCell::new(State { level: Level::Medium, seed: 0, renderer: Renderer::default() });
}

fn side(s: wit::Side) -> Side {
    match s {
        wit::Side::Red => Side::Red,
        wit::Side::Blue => Side::Blue,
    }
}

fn wit_side(s: Side) -> wit::Side {
    match s {
        Side::Red => wit::Side::Red,
        Side::Blue => wit::Side::Blue,
    }
}

fn to_core(s: &wit::Snapshot) -> Snapshot {
    let mut board = [None; SQUARES];
    for (i, cell) in s.board.iter().take(SQUARES).enumerate() {
        board[i] = cell.map(|p| Piece { owner: side(p.owner), kind: Animal::ALL[p.kind as usize] });
    }
    Snapshot {
        rev: s.rev,
        board,
        first_side: side(s.first_side),
        to_play: side(s.to_play),
        history: s.history.iter().map(|m| Move { src: m.src, dst: m.dst }).collect(),
        no_capture_plies: s.no_capture_plies,
        status: match s.status {
            wit::Phase::Playing => Phase::Playing,
            wit::Phase::Won => Phase::Won,
            wit::Phase::Drawn => Phase::Drawn,
            wit::Phase::Forfeited => Phase::Forfeited,
        },
        winner: s.winner.map(side),
        reason: Reason::parse(&s.reason),
    }
}

#[cfg_attr(not(feature = "test-exports"), allow(dead_code))]
fn to_wit(s: &Snapshot) -> wit::Snapshot {
    wit::Snapshot {
        rev: s.rev,
        board: s
            .board
            .iter()
            .map(|p| p.map(|p| wit::Piece { owner: wit_side(p.owner), kind: animal(p.kind) }))
            .collect(),
        first_side: wit_side(s.first_side),
        to_play: wit_side(s.to_play),
        history: s.history.iter().map(|m| wit::PlyMove { src: m.src, dst: m.dst }).collect(),
        no_capture_plies: s.no_capture_plies,
        status: match s.status {
            Phase::Playing => wit::Phase::Playing,
            Phase::Won => wit::Phase::Won,
            Phase::Drawn => wit::Phase::Drawn,
            Phase::Forfeited => wit::Phase::Forfeited,
        },
        winner: s.winner.map(wit_side),
        reason: s.reason.as_str().to_string(),
    }
}

#[cfg_attr(not(feature = "test-exports"), allow(dead_code))]
fn animal(a: Animal) -> wit::Animal {
    [
        wit::Animal::Rat,
        wit::Animal::Cat,
        wit::Animal::Dog,
        wit::Animal::Wolf,
        wit::Animal::Leopard,
        wit::Animal::Tiger,
        wit::Animal::Lion,
        wit::Animal::Elephant,
    ][a as usize]
}

struct Entrant;

impl wit::Guest for Entrant {
    fn info() -> wit::Metadata {
        wit::Metadata {
            title: identity::TITLE.into(),
            game_version: identity::GAME_VERSION.into(),
            model: identity::MODEL.into(),
            code_agent: identity::CODE_AGENT.into(),
            engine_version: identity::ENGINE_VERSION.into(),
            runtime: identity::RUNTIME.into(),
            rules_id: RULES_ID.into(),
            rules_digest: RULES_DIGEST.into(),
        }
    }

    fn init(config: wit::Settings) {
        STATE.with_borrow_mut(|s| {
            s.level = match config.difficulty {
                wit::Level::Easy => Level::Easy,
                wit::Level::Medium => Level::Medium,
                wit::Level::Hard => Level::Hard,
            };
            s.seed = config.seed;
        });
    }

    fn choose_move(state: wit::Snapshot, legal: Vec<wit::PlyMove>, node_budget: u32) -> u32 {
        let snapshot = to_core(&state);
        let legal: Vec<Move> = legal.iter().map(|m| Move { src: m.src, dst: m.dst }).collect();
        let (level, seed) = STATE.with_borrow(|s| (s.level, s.seed));
        choose_index(&snapshot, &legal, SearchParams { node_budget, seed, level })
    }

    fn render(state: wit::Snapshot, flipped: bool, progress: u16) {
        let snapshot = to_core(&state);
        STATE.with_borrow_mut(|s| {
            let frame = s.renderer.render(&snapshot, flipped, progress, None);
            display::present(WIDTH as u16, HEIGHT as u16, frame);
        });
    }
}

#[cfg(feature = "test-exports")]
impl exports::test::rules::rules::Guest for Entrant {
    fn legal_moves(state: wit::Snapshot) -> Vec<wit::PlyMove> {
        jungle_core::rules::legal_moves(&to_core(&state)).iter().map(|m| wit::PlyMove { src: m.src, dst: m.dst }).collect()
    }

    fn apply(state: wit::Snapshot, mv: wit::PlyMove) -> Option<wit::Snapshot> {
        jungle_core::rules::apply_move(&to_core(&state), Move { src: mv.src, dst: mv.dst }).ok().map(|s| to_wit(&s))
    }
}

export!(Entrant);
