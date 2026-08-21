use wasm_bindgen::prelude::*;

use crate::{evaluation, position::Position, search::Search, COLS, ROWS};
const CENTER_ORDER: [u8; COLS] = [3, 2, 4, 1, 5, 0, 6];

pub(crate) fn search_best_move(
    search: &mut Search,
    history: &[u8],
    time_ms: u32,
    max_depth: u8,
) -> i32 {
    search_best_move_with_stats(search, history, time_ms, max_depth).column
}

#[derive(Clone, Copy)]
pub(crate) struct SearchResult {
    pub(crate) column: i32,
    pub(crate) depth: u8,
    pub(crate) evaluation: i32,
    pub(crate) predicted_empty_cells: i32,
    pub(crate) predicted_sign: i8,
    pub(crate) complete: bool,
}

pub(crate) fn search_best_move_with_stats(
    search: &mut Search,
    history: &[u8],
    time_ms: u32,
    max_depth: u8,
) -> SearchResult {
    let Some(position) = Position::from_history(history) else {
        return SearchResult {
            column: -1,
            depth: 0,
            evaluation: 0,
            predicted_empty_cells: 0,
            predicted_sign: 0,
            complete: false,
        };
    };
    if position.mask.count_ones() as usize >= COLS * ROWS {
        return SearchResult {
            column: -1,
            depth: 0,
            evaluation: 0,
            predicted_empty_cells: 0,
            predicted_sign: 0,
            complete: false,
        };
    }
    let legal = position.legal_moves();
    if legal == 0 {
        return SearchResult {
            column: -1,
            depth: 0,
            evaluation: 0,
            predicted_empty_cells: 0,
            predicted_sign: 0,
            complete: false,
        };
    }
    let mut fallback = 3;
    if !position.can_play(fallback) {
        fallback = CENTER_ORDER
            .into_iter()
            .find(|&column| position.can_play(column))
            .unwrap_or(0);
    }
    search.begin(time_ms);
    let remaining = (COLS * ROWS - position.mask.count_ones() as usize) as u8;
    let target_depth = max_depth.min(remaining).max(1);
    let mut previous_score: Option<i16> = None;
    let mut completed_depth = 0;
    let mut completed_score = 0;
    for depth in 1..=target_depth {
        let result = if let Some(previous) = previous_score {
            let alpha = previous.saturating_sub(64);
            let beta = previous.saturating_add(64);
            let narrow = search.root_window(position, depth, alpha, beta);
            match narrow {
                Some((_, score)) if score > alpha && score < beta => narrow,
                Some(_) => search.root(position, depth),
                None => None,
            }
        } else {
            search.root(position, depth)
        };
        if let Some((column, score)) = result {
            fallback = column;
            previous_score = Some(score);
            completed_depth = depth;
            completed_score = score;
        } else {
            break;
        }
        if search.stopped {
            break;
        }
    }
    let complete = completed_depth >= remaining;
    let evaluation = if complete {
        evaluation::value(completed_score, history.len())
    } else {
        0
    };
    let (predicted_empty_cells, predicted_sign) = if complete {
        (evaluation.abs(), evaluation.signum() as i8)
    } else {
        (0, 0)
    };
    SearchResult {
        column: fallback as i32,
        depth: completed_depth,
        evaluation,
        predicted_empty_cells,
        predicted_sign,
        complete,
    }
}

#[wasm_bindgen]
pub struct Solver {
    search: Search,
}

impl Default for Solver {
    fn default() -> Self {
        Self {
            search: Search::new(0),
        }
    }
}

#[wasm_bindgen]
impl Solver {
    #[wasm_bindgen(constructor)]
    pub fn new() -> Self {
        Self::default()
    }

    pub fn best_move(&mut self, history: &[u8], time_ms: u32, max_depth: u8) -> i32 {
        search_best_move(&mut self.search, history, time_ms, max_depth)
    }

    pub fn best_move_with_stats(
        &mut self,
        history: &[u8],
        time_ms: u32,
        max_depth: u8,
    ) -> Vec<i32> {
        let result = search_best_move_with_stats(&mut self.search, history, time_ms, max_depth);
        vec![
            result.column,
            i32::from(result.depth),
            result.evaluation,
            if result.complete { 1 } else { 0 },
            result.predicted_empty_cells,
            i32::from(result.predicted_sign),
        ]
    }
}

#[wasm_bindgen]
pub fn best_move(history: &[u8], time_ms: u32, max_depth: u8) -> i32 {
    let mut search = Search::new(time_ms);
    search_best_move(&mut search, history, time_ms, max_depth)
}
