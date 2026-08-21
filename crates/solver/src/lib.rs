mod evaluation;
mod position;
mod search;
mod solver_api;
mod transposition_table;

pub use solver_api::{best_move, Solver};

const COLS: usize = 7;
const ROWS: usize = 6;
const STRIDE: usize = 7;
const MATE_SCORE: i16 = 1_000;

#[cfg(test)]
mod tests {
    include!("tests.rs");
}
