const COLS: usize = 7;
const ROWS: usize = 6;
const MATE_SCORE: i16 = 1_000;

pub(crate) fn value(score: i16, played_plies: usize) -> i32 {
    if score == 0 {
        return 0;
    }
    let distance = i32::from(MATE_SCORE - score.abs());
    let empty_cells = (COLS * ROWS) as i32 - played_plies as i32 - distance;
    let value = empty_cells.max(0);
    if score > 0 {
        value
    } else {
        -value
    }
}
