const TT_BITS: usize = 20;
const TT_SIZE: usize = 1 << TT_BITS;

#[derive(Clone, Copy, PartialEq, Eq)]
#[repr(u8)]
pub(crate) enum Bound {
    Exact = 0,
    Lower = 1,
    Upper = 2,
}

#[derive(Clone, Copy)]
pub(crate) struct Entry {
    pub(crate) key: u64,
    pub(crate) score: i16,
    pub(crate) depth: u8,
    pub(crate) best_move: i8,
    pub(crate) bound: Bound,
    pub(crate) generation: u8,
    pub(crate) valid: bool,
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
            valid: false,
        }
    }
}

pub(crate) struct TranspositionTable {
    entries: Vec<Entry>,
    pub(crate) generation: u8,
}

impl TranspositionTable {
    pub(crate) fn new() -> Self {
        Self {
            entries: vec![Entry::default(); TT_SIZE],
            generation: 1,
        }
    }
    pub(crate) fn next_generation(&mut self) {
        self.generation = self.generation.wrapping_add(1).max(1);
    }
    fn index(key: u64) -> usize {
        let hash = key.wrapping_mul(0x9e37_79b9_7f4a_7c15) ^ key.rotate_left(17);
        (hash as usize) & (TT_SIZE - 1)
    }
    pub(crate) fn get(&self, key: u64) -> Entry {
        self.entries[Self::index(key)]
    }
    pub(crate) fn store(&mut self, key: u64, entry: Entry) {
        let index = Self::index(key);
        let old = self.entries[index];
        if !old.valid || entry.depth >= old.depth || old.generation != self.generation {
            self.entries[index] = entry;
        }
    }
}
