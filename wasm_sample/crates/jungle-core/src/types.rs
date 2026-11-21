//! Game types mirroring `jungle:arena/game@1.0.0`, independent of any binding layer.

pub const COLS: usize = 7;
pub const ROWS: usize = 9;
pub const SQUARES: usize = COLS * ROWS;

pub const RULES_ID: &str = "desktop-jungle-v1";
pub const RULES_DIGEST: &str = "a0936f1eee833dd11107ed581dc7c5c2f72f0612d9fc7055c93a1d2fbb0c3d63";

#[derive(Clone, Copy, PartialEq, Eq, Debug, Hash)]
pub enum Side {
    Red,
    Blue,
}

impl Side {
    pub const BOTH: [Side; 2] = [Side::Red, Side::Blue];

    pub fn opponent(self) -> Side {
        match self {
            Side::Red => Side::Blue,
            Side::Blue => Side::Red,
        }
    }

    pub fn index(self) -> usize {
        self as usize
    }

    pub fn name(self) -> &'static str {
        match self {
            Side::Red => "red",
            Side::Blue => "blue",
        }
    }
}

#[derive(Clone, Copy, PartialEq, Eq, Debug, PartialOrd, Ord, Hash)]
pub enum Animal {
    Rat,
    Cat,
    Dog,
    Wolf,
    Leopard,
    Tiger,
    Lion,
    Elephant,
}

impl Animal {
    /// Profile order `animalsLowToHigh`.
    pub const ALL: [Animal; 8] = [
        Animal::Rat,
        Animal::Cat,
        Animal::Dog,
        Animal::Wolf,
        Animal::Leopard,
        Animal::Tiger,
        Animal::Lion,
        Animal::Elephant,
    ];

    /// Rank 1 (rat) to 8 (elephant).
    pub fn rank(self) -> u8 {
        self as u8 + 1
    }

    pub fn from_index(index: usize) -> Option<Animal> {
        Animal::ALL.get(index).copied()
    }

    pub fn name(self) -> &'static str {
        ["rat", "cat", "dog", "wolf", "leopard", "tiger", "lion", "elephant"][self as usize]
    }

    pub fn from_name(name: &str) -> Option<Animal> {
        Animal::ALL.iter().copied().find(|a| a.name() == name)
    }
}

#[derive(Clone, Copy, PartialEq, Eq, Debug, Hash)]
pub struct Piece {
    pub owner: Side,
    pub kind: Animal,
}

#[derive(Clone, Copy, PartialEq, Eq, Debug, PartialOrd, Ord, Hash)]
pub struct Move {
    pub src: u8,
    pub dst: u8,
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Phase {
    Playing,
    Won,
    Drawn,
    Forfeited,
}

/// Wire reason strings; `None` is the empty string used while playing.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Reason {
    None,
    Den,
    Elimination,
    Immobilization,
    NoCapture,
    Timeout,
    Trap,
    InvalidMove,
}

impl Reason {
    pub fn as_str(self) -> &'static str {
        match self {
            Reason::None => "",
            Reason::Den => "den",
            Reason::Elimination => "elimination",
            Reason::Immobilization => "immobilization",
            Reason::NoCapture => "no-capture",
            Reason::Timeout => "timeout",
            Reason::Trap => "trap",
            Reason::InvalidMove => "invalid-move",
        }
    }

    /// Unknown strings map to `None`: the renderer then simply omits a reason line.
    pub fn parse(text: &str) -> Reason {
        match text {
            "den" => Reason::Den,
            "elimination" => Reason::Elimination,
            "immobilization" => Reason::Immobilization,
            "no-capture" => Reason::NoCapture,
            "timeout" => Reason::Timeout,
            "trap" => Reason::Trap,
            "invalid-move" => Reason::InvalidMove,
            _ => Reason::None,
        }
    }
}

pub type Board = [Option<Piece>; SQUARES];

#[derive(Clone, PartialEq, Eq, Debug)]
pub struct Snapshot {
    pub rev: u32,
    pub board: Board,
    pub first_side: Side,
    pub to_play: Side,
    pub history: Vec<Move>,
    pub no_capture_plies: u32,
    pub status: Phase,
    pub winner: Option<Side>,
    pub reason: Reason,
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Level {
    Easy,
    Medium,
    Hard,
}
