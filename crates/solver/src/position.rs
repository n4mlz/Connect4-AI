const COLS: usize = 7;
const ROWS: usize = 6;
const STRIDE: usize = 7;

#[derive(Clone, Copy, Default)]
pub(crate) struct Position {
    pub(crate) current: u64,
    pub(crate) mask: u64,
}

impl Position {
    pub(crate) fn from_history(history: &[u8]) -> Option<Self> {
        let mut position = Self::default();
        for &column in history {
            if column as usize >= COLS || !position.can_play(column) {
                return None;
            }
            position.play(column);
        }
        Some(position)
    }
    pub(crate) fn can_play(&self, column: u8) -> bool {
        self.mask & top_mask(column) == 0
    }
    pub(crate) fn legal_moves(&self) -> u64 {
        (0..COLS as u8)
            .filter(|&column| self.can_play(column))
            .map(|column| self.play_bit(column))
            .fold(0, |moves, bit| moves | bit)
    }
    pub(crate) fn play_bit(&self, column: u8) -> u64 {
        (self.mask + bottom_mask(column)) & column_mask(column)
    }
    pub(crate) fn play(&mut self, column: u8) {
        let bit = self.play_bit(column);
        self.current ^= self.mask;
        self.mask |= bit;
    }
    pub(crate) fn played(&self, bit: u64) -> Self {
        Self {
            current: self.current ^ self.mask,
            mask: self.mask | bit,
        }
    }
    fn previous_player(&self) -> u64 {
        self.mask ^ self.current
    }
    pub(crate) fn has_previous_win(&self) -> bool {
        alignment(self.previous_player())
    }
    pub(crate) fn winning_moves(&self, stones: u64) -> u64 {
        let mut wins = 0;
        let mut remaining = self.legal_moves();
        while remaining != 0 {
            let bit = remaining.isolate_lowest_one();
            if alignment(stones | bit) {
                wins |= bit;
            }
            remaining ^= bit;
        }
        wins
    }
    pub(crate) fn immediate_wins(&self) -> u64 {
        self.winning_moves(self.current)
    }
    pub(crate) fn non_losing_moves(&self) -> u64 {
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
            let bit = remaining.isolate_lowest_one();
            if winning_moves_for(opponent, self.mask | bit) == 0 {
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
    0x3fu64 << ((bit.trailing_zeros() as usize / STRIDE) * STRIDE)
}
pub(crate) fn alignment(stones: u64) -> bool {
    for direction in [1, STRIDE, STRIDE - 1, STRIDE + 1] {
        let pair = stones & (stones >> direction);
        if pair & (pair >> (direction * 2)) != 0 {
            return true;
        }
    }
    false
}
fn winning_moves_for(stones: u64, mask: u64) -> u64 {
    Position {
        current: stones,
        mask,
    }
    .winning_moves(stones)
}
fn mirror_bits(value: u64) -> u64 {
    let mut mirrored = 0;
    for column in 0..COLS {
        let bits = (value >> (column * STRIDE)) & 0x7f;
        mirrored |= bits << ((COLS - 1 - column) * STRIDE);
    }
    mirrored
}
pub(crate) fn position_key(position: Position) -> u64 {
    position.current + position.mask
}
pub(crate) fn canonical_key(position: Position) -> (u64, bool) {
    let mirrored = Position {
        current: mirror_bits(position.current),
        mask: mirror_bits(position.mask),
    };
    let direct_key = position_key(position);
    let mirrored_key = position_key(mirrored);
    if direct_key <= mirrored_key {
        (direct_key, false)
    } else {
        (mirrored_key, true)
    }
}
pub(crate) fn mirror_column(column: i8) -> i8 {
    if column < 0 {
        column
    } else {
        COLS as i8 - 1 - column
    }
}
