use wasm_bindgen::prelude::*;

const COLS: usize = 7;
const ROWS: usize = 6;
const STRIDE: usize = 7;
const MATE_SCORE: i16 = 1_000;
const CENTER_ORDER: [u8; COLS] = [3, 2, 4, 1, 5, 0, 6];
const TT_BITS: usize = 18;
const TT_SIZE: usize = 1 << TT_BITS;

#[derive(Clone, Copy, Default)]
struct Position {
    current: u64,
    mask: u64,
}

impl Position {
    fn from_history(history: &[u8]) -> Option<Self> {
        let mut position = Self::default();
        for &column in history {
            if column as usize >= COLS || !position.can_play(column) {
                return None;
            }
            position.play(column);
        }
        Some(position)
    }

    fn can_play(&self, column: u8) -> bool {
        self.mask & top_mask(column) == 0
    }

    fn legal_moves(&self) -> u64 {
        let mut moves = 0;
        for column in 0..COLS as u8 {
            if self.can_play(column) {
                moves |= self.play_bit(column);
            }
        }
        moves
    }

    fn play_bit(&self, column: u8) -> u64 {
        (self.mask + bottom_mask(column)) & column_mask(column)
    }

    fn play(&mut self, column: u8) {
        let bit = self.play_bit(column);
        self.current ^= self.mask;
        self.mask |= bit;
    }

    fn played(&self, bit: u64) -> Self {
        Self {
            current: self.current ^ self.mask,
            mask: self.mask | bit,
        }
    }

    fn previous_player(&self) -> u64 {
        self.mask ^ self.current
    }

    fn has_previous_win(&self) -> bool {
        alignment(self.previous_player())
    }

    fn winning_moves(&self, stones: u64) -> u64 {
        let legal = self.legal_moves();
        let mut wins = 0;
        let mut remaining = legal;
        while remaining != 0 {
            let bit = remaining & remaining.wrapping_neg();
            if alignment(stones | bit) {
                wins |= bit;
            }
            remaining ^= bit;
        }
        wins
    }

    fn immediate_wins(&self) -> u64 {
        self.winning_moves(self.current)
    }

    fn non_losing_moves(&self) -> u64 {
        let legal = self.legal_moves();
        let opponent = self.mask ^ self.current;
        let opponent_wins = self.winning_moves(opponent);
        if opponent_wins.count_ones() > 1 {
            return 0;
        }
        if opponent_wins != 0 {
            return legal & column_mask_from_bit(opponent_wins);
        }

        let mut safe = 0;
        let mut remaining = legal;
        while remaining != 0 {
            let bit = remaining & remaining.wrapping_neg();
            let child_mask = self.mask | bit;
            if winning_moves_for(opponent, child_mask) == 0 {
                safe |= bit;
            }
            remaining ^= bit;
        }
        safe
    }
}

fn bottom_mask(column: u8) -> u64 {
    1u64 << (column as usize * STRIDE)
}

fn top_mask(column: u8) -> u64 {
    1u64 << (column as usize * STRIDE + ROWS - 1)
}

fn column_mask(column: u8) -> u64 {
    0x3fu64 << (column as usize * STRIDE)
}

fn column_mask_from_bit(bit: u64) -> u64 {
    let column = (bit.trailing_zeros() as usize) / STRIDE;
    0x3fu64 << (column * STRIDE)
}

fn alignment(stones: u64) -> bool {
    for direction in [1usize, STRIDE, STRIDE - 1, STRIDE + 1] {
        let pair = stones & (stones >> direction);
        if pair & (pair >> (direction * 2)) != 0 {
            return true;
        }
    }
    false
}

fn winning_moves_for(stones: u64, mask: u64) -> u64 {
    let position = Position {
        current: stones,
        mask,
    };
    position.winning_moves(stones)
}

fn mirror_bits(value: u64) -> u64 {
    let mut mirrored = 0;
    for column in 0..COLS {
        let column_bits = (value >> (column * STRIDE)) & 0x7f;
        mirrored |= column_bits << ((COLS - 1 - column) * STRIDE);
    }
    mirrored
}

fn canonical_key(position: Position) -> u64 {
    let direct =
        position.current.wrapping_mul(0x9e37_79b9_7f4a_7c15) ^ position.mask.rotate_left(17);
    let mirrored_current = mirror_bits(position.current);
    let mirrored_mask = mirror_bits(position.mask);
    let mirrored =
        mirrored_current.wrapping_mul(0x9e37_79b9_7f4a_7c15) ^ mirrored_mask.rotate_left(17);
    direct.min(mirrored)
}

#[derive(Clone, Copy, PartialEq, Eq)]
#[repr(u8)]
enum Bound {
    Exact = 0,
    Lower = 1,
    Upper = 2,
}

#[derive(Clone, Copy)]
struct Entry {
    key: u64,
    score: i16,
    depth: u8,
    best_move: i8,
    bound: Bound,
    generation: u8,
}

impl Default for Entry {
    fn default() -> Self {
        Self {
            key: 0,
            score: 0,
            depth: 0,
            best_move: -1,
            bound: Bound::Upper,
            generation: 0,
        }
    }
}

struct TranspositionTable {
    entries: Vec<Entry>,
    generation: u8,
}

impl TranspositionTable {
    fn new() -> Self {
        Self {
            entries: vec![Entry::default(); TT_SIZE],
            generation: 1,
        }
    }

    fn next_generation(&mut self) {
        self.generation = self.generation.wrapping_add(1).max(1);
    }

    fn index(key: u64) -> usize {
        (key as usize) & (TT_SIZE - 1)
    }

    fn get(&self, key: u64) -> Entry {
        self.entries[Self::index(key)]
    }

    fn store(&mut self, key: u64, entry: Entry) {
        let index = Self::index(key);
        let old = self.entries[index];
        if old.key == 0 || entry.depth >= old.depth || old.generation != self.generation {
            self.entries[index] = entry;
        }
    }
}

struct Search {
    table: TranspositionTable,
    history: [i32; COLS],
    started_ms: f64,
    limit_ms: Option<f64>,
    nodes: u64,
    stopped: bool,
}

impl Search {
    fn new(time_ms: u32) -> Self {
        Self {
            table: TranspositionTable::new(),
            history: [0; COLS],
            started_ms: now_ms(),
            limit_ms: (time_ms > 0).then_some(time_ms as f64),
            nodes: 0,
            stopped: false,
        }
    }

    fn begin(&mut self, time_ms: u32) {
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

        let key = canonical_key(position);
        let original_alpha = alpha;
        let cached = self.table.get(key);
        let tt_move = cached.best_move;
        if cached.key == key && cached.depth >= depth {
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

        let ordered = self.order_moves(position, moves, tt_move);
        let mut best = i16::MIN + 1;
        let mut best_move = -1;
        let mut first = true;
        for column in ordered {
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
            key,
            Entry {
                key,
                score: to_table_score(best, ply),
                depth,
                best_move,
                bound,
                generation: self.table.generation,
            },
        );
        Some(best)
    }

    fn order_moves(&self, position: Position, moves: u64, tt_move: i8) -> [u8; COLS] {
        let mut ordered = [0; COLS];
        let mut scores = [i32::MIN; COLS];
        let mut count = 0;
        let mut remaining = moves;
        while remaining != 0 {
            let bit = remaining & remaining.wrapping_neg();
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
        ordered
    }

    fn root(&mut self, position: Position, depth: u8) -> Option<(u8, i16)> {
        self.root_window(position, depth, i16::MIN + 1, i16::MAX)
    }

    fn root_window(
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
        let cached = self.table.get(canonical_key(position));
        let ordered = self.order_moves(position, moves, cached.best_move);
        let mut best = i16::MIN + 1;
        let mut best_column = ordered[0];
        let mut first = true;
        for column in ordered {
            if !position.can_play(column) || position.play_bit(column) & moves == 0 {
                continue;
            }
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

fn search_best_move(search: &mut Search, history: &[u8], time_ms: u32, max_depth: u8) -> i32 {
    let Some(position) = Position::from_history(history) else {
        return -1;
    };
    if position.mask.count_ones() as usize >= COLS * ROWS {
        return -1;
    }
    let legal = position.legal_moves();
    if legal == 0 {
        return -1;
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
        } else {
            break;
        }
        if search.stopped {
            break;
        }
    }
    fallback as i32
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
}

#[wasm_bindgen]
pub fn best_move(history: &[u8], time_ms: u32, max_depth: u8) -> i32 {
    let mut search = Search::new(time_ms);
    search_best_move(&mut search, history, time_ms, max_depth)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn play(history: &[u8]) -> Position {
        Position::from_history(history).unwrap()
    }

    #[test]
    fn bitboard_detects_all_win_directions() {
        assert!(alignment((1 << 0) | (1 << 7) | (1 << 14) | (1 << 21)));
        assert!(alignment((1 << 0) | (1 << 1) | (1 << 2) | (1 << 3)));
        assert!(alignment((1 << 0) | (1 << 8) | (1 << 16) | (1 << 24)));
        assert!(alignment((1 << 3) | (1 << 9) | (1 << 15) | (1 << 21)));
    }

    #[test]
    fn rejects_immediate_losing_moves() {
        let position = play(&[0, 1, 2, 1, 3, 1]);
        let safe = position.non_losing_moves();
        assert_eq!(safe.count_ones(), 1);
        assert_eq!((safe.trailing_zeros() as usize) / STRIDE, 1);
    }

    #[test]
    fn solver_returns_a_legal_move() {
        let column = best_move(&[3, 2, 3, 2], 1, 8);
        assert!((0..7).contains(&column));
    }
}
