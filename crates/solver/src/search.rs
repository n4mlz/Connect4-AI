use crate::position::{canonical_key, mirror_column, Position};
use crate::transposition_table::{Bound, Entry, TranspositionTable};
use crate::{COLS, MATE_SCORE, ROWS, STRIDE};

pub(crate) struct Search {
    table: TranspositionTable,
    history: [i32; COLS],
    started_ms: f64,
    limit_ms: Option<f64>,
    nodes: u64,
    pub(crate) stopped: bool,
}

impl Search {
    pub(crate) fn new(time_ms: u32) -> Self {
        Self {
            table: TranspositionTable::new(),
            history: [0; COLS],
            started_ms: now_ms(),
            limit_ms: (time_ms > 0).then_some(time_ms as f64),
            nodes: 0,
            stopped: false,
        }
    }

    pub(crate) fn begin(&mut self, time_ms: u32) {
        self.started_ms = now_ms();
        self.limit_ms = (time_ms > 0).then_some(time_ms as f64);
        self.nodes = 0;
        self.stopped = false;
        self.table.next_generation();
    }

    fn timed_out(&mut self) -> bool {
        self.nodes += 1;
        if self.nodes & 0xfff == 0 {
            if let Some(limit) = self.limit_ms {
                if now_ms() - self.started_ms >= limit {
                    self.stopped = true;
                }
            }
        }
        self.stopped
    }

    fn negamax(
        &mut self,
        position: Position,
        mut alpha: i16,
        beta: i16,
        depth: u8,
        ply: i16,
    ) -> Option<i16> {
        if self.timed_out() {
            return None;
        }
        if position.has_previous_win() {
            return Some(-(MATE_SCORE - ply));
        }
        if position.mask.count_ones() as usize == COLS * ROWS {
            return Some(0);
        }
        if depth == 0 {
            return Some(0);
        }

        let (canonical, is_mirrored) = canonical_key(position);
        let original_alpha = alpha;
        let cached = self.table.get(canonical);
        let cache_hit = cached.valid && cached.key == canonical;
        let tt_move = if cache_hit {
            if is_mirrored {
                mirror_column(cached.best_move)
            } else {
                cached.best_move
            }
        } else {
            -1
        };
        if cache_hit && cached.depth >= depth {
            let score = from_table_score(cached.score, ply);
            match cached.bound {
                Bound::Exact => return Some(score),
                Bound::Lower => {
                    alpha = alpha.max(score);
                    if alpha >= beta {
                        return Some(score);
                    }
                }
                Bound::Upper if score <= alpha => return Some(score),
                Bound::Upper => {}
            }
        }

        let winning = position.immediate_wins();
        if winning != 0 {
            return Some(MATE_SCORE - (ply + 1));
        }
        let moves = position.non_losing_moves();
        if moves == 0 {
            return Some(-(MATE_SCORE - (ply + 2)));
        }

        let (ordered, count) = self.order_moves(position, moves, tt_move);
        let mut best = i16::MIN + 1;
        let mut best_move = -1;
        let mut first = true;
        for &column in ordered.iter().take(count) {
            let child = position.played(position.play_bit(column));
            let score = if first {
                -self.negamax(child, -beta, -alpha, depth - 1, ply + 1)?
            } else {
                let probe = -self.negamax(child, -alpha - 1, -alpha, depth - 1, ply + 1)?;
                if probe > alpha && probe < beta {
                    -self.negamax(child, -beta, -alpha, depth - 1, ply + 1)?
                } else {
                    probe
                }
            };
            first = false;
            if score > best {
                best = score;
                best_move = column as i8;
            }
            alpha = alpha.max(score);
            if alpha >= beta {
                self.history[column as usize] =
                    (self.history[column as usize] + depth as i32 * depth as i32).min(1_000_000);
                break;
            }
        }

        let bound = if best <= original_alpha {
            Bound::Upper
        } else if best >= beta {
            Bound::Lower
        } else {
            Bound::Exact
        };
        self.table.store(
            canonical,
            Entry {
                key: canonical,
                score: to_table_score(best, ply),
                depth,
                best_move: if is_mirrored {
                    mirror_column(best_move)
                } else {
                    best_move
                },
                bound,
                generation: self.table.generation,
                valid: true,
            },
        );
        Some(best)
    }

    pub(crate) fn order_moves(
        &self,
        position: Position,
        moves: u64,
        tt_move: i8,
    ) -> ([u8; COLS], usize) {
        let mut ordered = [0; COLS];
        let mut scores = [i32::MIN; COLS];
        let mut count = 0;
        let mut remaining = moves;
        while remaining != 0 {
            let bit = remaining.isolate_lowest_one();
            let column = (bit.trailing_zeros() as usize / STRIDE) as u8;
            let child = position.played(bit);
            let threats = child.winning_moves(child.mask ^ child.current).count_ones() as i32;
            let center = (COLS as i32 - (column as i32 - 3).abs()) * 10;
            let tt_bonus = if column as i8 == tt_move { 100_000 } else { 0 };
            scores[count] = tt_bonus + threats * 1_000 + self.history[column as usize] + center;
            ordered[count] = column;
            count += 1;
            remaining ^= bit;
        }
        for index in 1..count {
            let mut current = index;
            while current > 0 && scores[current] > scores[current - 1] {
                scores.swap(current, current - 1);
                ordered.swap(current, current - 1);
                current -= 1;
            }
        }
        (ordered, count)
    }

    pub(crate) fn root(&mut self, position: Position, depth: u8) -> Option<(u8, i16)> {
        self.root_window(position, depth, i16::MIN + 1, i16::MAX)
    }

    pub(crate) fn root_window(
        &mut self,
        position: Position,
        depth: u8,
        mut alpha: i16,
        beta: i16,
    ) -> Option<(u8, i16)> {
        let winning = position.immediate_wins();
        let moves = if winning != 0 {
            winning
        } else {
            position.non_losing_moves()
        };
        if moves == 0 {
            return None;
        }
        let (canonical, is_mirrored) = canonical_key(position);
        let cached = self.table.get(canonical);
        let cache_hit = cached.valid && cached.key == canonical;
        let tt_move = if cache_hit {
            if is_mirrored {
                mirror_column(cached.best_move)
            } else {
                cached.best_move
            }
        } else {
            -1
        };
        let (ordered, count) = self.order_moves(position, moves, tt_move);
        let mut best = i16::MIN + 1;
        let mut best_column = ordered[0];
        let mut first = true;
        for &column in ordered.iter().take(count) {
            let child = position.played(position.play_bit(column));
            let score = if first {
                -self.negamax(child, -beta, -alpha, depth.saturating_sub(1), 1)?
            } else {
                let probe = -self.negamax(child, -alpha - 1, -alpha, depth.saturating_sub(1), 1)?;
                if probe > alpha && probe < beta {
                    -self.negamax(child, -beta, -alpha, depth.saturating_sub(1), 1)?
                } else {
                    probe
                }
            };
            first = false;
            if score > best {
                best = score;
                best_column = column;
            }
            alpha = alpha.max(score);
            if alpha >= beta {
                break;
            }
        }
        Some((best_column, best))
    }
}

#[cfg(target_arch = "wasm32")]
fn now_ms() -> f64 {
    js_sys::Date::now()
}

#[cfg(not(target_arch = "wasm32"))]
fn now_ms() -> f64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0.0, |duration| duration.as_secs_f64() * 1_000.0)
}

fn to_table_score(score: i16, ply: i16) -> i16 {
    if score > 0 {
        score + ply
    } else if score < 0 {
        score - ply
    } else {
        score
    }
}

fn from_table_score(score: i16, ply: i16) -> i16 {
    if score > 0 {
        score - ply
    } else if score < 0 {
        score + ply
    } else {
        score
    }
}
