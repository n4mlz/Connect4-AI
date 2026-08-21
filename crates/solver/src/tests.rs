    use std::collections::HashMap;

    use super::evaluation::value as evaluation_value;
    use super::position::{alignment, position_key, Position};
    use super::search::Search;
    use super::solver_api::search_best_move_with_stats;
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
    fn non_losing_moves_matches_exhaustive_one_ply_safety() {
        let mut seed = 0x5eed_u64;
        for case in 0..256 {
            let mut position = Position::default();
            for _ in 0..(case % 20) {
                let legal = position.legal_moves();
                if legal == 0 || position.has_previous_win() {
                    break;
                }
                seed = seed.wrapping_mul(6_364_136_223_846_793_005).wrapping_add(1);
                let target = (seed as usize) % legal.count_ones() as usize;
                let mut remaining = legal;
                let mut bit = 0;
                for _ in 0..=target {
                    bit = remaining.isolate_lowest_one();
                    remaining ^= bit;
                }
                position.play((bit.trailing_zeros() as usize / STRIDE) as u8);
            }

            let opponent = position.mask ^ position.current;
            let mut expected = 0;
            let mut legal = position.legal_moves();
            while legal != 0 {
                let bit = legal.isolate_lowest_one();
                let child_mask = position.mask | bit;
                let mut replies = Position {
                    current: opponent,
                    mask: child_mask,
                }
                .legal_moves();
                let mut opponent_can_win = false;
                while replies != 0 {
                    let reply = replies.isolate_lowest_one();
                    if alignment(opponent | reply) {
                        opponent_can_win = true;
                        break;
                    }
                    replies ^= reply;
                }
                if !opponent_can_win {
                    expected |= bit;
                }
                legal ^= bit;
            }
            assert_eq!(position.non_losing_moves(), expected, "case {case}");
        }
    }

    #[test]
    fn move_ordering_returns_only_the_requested_legal_moves() {
        let position = play(&[0, 0, 0, 0, 0, 0, 1]);
        let moves = position.non_losing_moves();
        let search = Search::new(0);
        let (ordered, count) = search.order_moves(position, moves, -1);
        assert_eq!(count, moves.count_ones() as usize);
        assert!(ordered[..count]
            .iter()
            .all(|&column| moves & position.play_bit(column) != 0));
        for (index, &column) in ordered[..count].iter().enumerate() {
            assert!(!ordered[..index].contains(&column));
        }
    }

    #[test]
    fn solver_takes_an_immediate_win_instead_of_searching_other_moves() {
        assert_eq!(best_move(&[0, 6, 0, 6, 0, 5], 20, 8), 0);
    }

    #[test]
    fn solver_blocks_the_only_immediate_loss() {
        assert_eq!(best_move(&[0, 1, 2, 1, 3, 1], 20, 8), 1);
    }

    #[test]
    fn mirrored_positions_return_mirrored_tactical_moves() {
        let mut solver = Solver::default();
        assert_eq!(solver.best_move(&[0, 6, 0, 6, 0, 5], 20, 8), 0);
        assert_eq!(solver.best_move(&[6, 0, 6, 0, 6, 1], 20, 8), 6);
    }

    #[test]
    fn exact_position_key_distinguishes_reachable_positions() {
        let mut keys = HashMap::new();
        collect_position_keys(Position::default(), 0, 6, &mut keys);
        assert!(keys.len() > 10_000);
    }

    #[test]
    fn solver_move_is_optimal_on_near_endgame_positions() {
        let mut seed = 0xdecafbad_u64;
        for case in 0..8 {
            let (position, history) = non_terminal_position(&mut seed, 30);
            if position.non_losing_moves() == 0 {
                continue;
            }
            let mut memo = HashMap::new();
            let expected = exhaustive_outcome(position, &mut memo);
            let move_column = best_move(&history, 0, 12);
            let child = position.played(position.play_bit(move_column as u8));
            assert_eq!(
                -exhaustive_outcome(child, &mut memo),
                expected,
                "case {case}, move {move_column}"
            );
        }
    }

    #[test]
    fn complete_evaluation_sign_matches_exhaustive_outcome() {
        let mut seed = 0x1234_5678_u64;
        for case in 0..8 {
            let (position, history) = non_terminal_position(&mut seed, 30);
            if position.non_losing_moves() == 0 {
                continue;
            }
            let mut memo = HashMap::new();
            let expected = exhaustive_outcome(position, &mut memo) as i32;
            let mut search = Search::new(0);
            let result = search_best_move_with_stats(&mut search, &history, 0, 12);
            assert!(
                result.complete,
                "case {case} was not completely searched (depth {})",
                result.depth
            );
            assert_eq!(result.evaluation.signum(), expected, "case {case}");
        }
    }

    #[test]
    fn complete_mate_distance_is_preserved_after_the_optimal_move() {
        let mut seed = 0x2468_ace0_u64;
        for case in 0..8 {
            let (position, history) = non_terminal_position(&mut seed, 30);
            if position.non_losing_moves() == 0 {
                continue;
            }
            let mut search = Search::new(0);
            let result = search_best_move_with_stats(&mut search, &history, 0, 12);
            assert!(result.complete, "case {case} was not completely searched");
            let child = position.played(position.play_bit(result.column as u8));
            if child.has_previous_win() || child.legal_moves() == 0 {
                continue;
            }
            let mut child_history = history.clone();
            child_history.push(result.column as u8);
            let child_result = search_best_move_with_stats(&mut search, &child_history, 0, 12);
            assert!(
                child_result.complete,
                "child case {case} was not completely searched"
            );
            assert_eq!(
                result.evaluation, -child_result.evaluation,
                "case {case}: optimal move changed the decisive empty-cell count"
            );
        }
    }

    #[test]
    fn complete_evaluation_matches_exhaustive_mate_distance() {
        let mut seed = 0x1357_9bdf_u64;
        for case in 0..8 {
            let (position, history) = non_terminal_position(&mut seed, 30);
            if position.non_losing_moves() == 0 {
                continue;
            }
            let mut memo = HashMap::new();
            let exact_score = exhaustive_score(position, &mut memo);
            let mut search = Search::new(0);
            let result = search_best_move_with_stats(&mut search, &history, 0, 12);
            assert!(result.complete, "case {case} was not completely searched");
            assert_eq!(
                result.evaluation,
                evaluation_value(exact_score, history.len()),
                "case {case}: history={history:?}, solver_score={}, exact_score={exact_score}, depth={}, complete evaluation differs from exhaustive mate distance",
                result.evaluation,
                result.depth
            );
        }
    }

    #[test]
    fn solver_returns_a_legal_move() {
        let column = best_move(&[3, 2, 3, 2], 1, 8);
        assert!((0..7).contains(&column));
    }

    #[test]
    fn evaluation_uses_empty_cells_at_the_decisive_position() {
        assert_eq!(evaluation_value(999, 0), 41);
        assert_eq!(evaluation_value(999, 38), 3);
        assert_eq!(evaluation_value(-998, 39), -1);
        assert_eq!(evaluation_value(0, 20), 0);
    }

    fn exhaustive_outcome(position: Position, memo: &mut HashMap<(u64, u64), i8>) -> i8 {
        if position.has_previous_win() {
            return -1;
        }
        if position.mask.count_ones() as usize == COLS * ROWS {
            return 0;
        }
        let key = (position.current, position.mask);
        if let Some(&outcome) = memo.get(&key) {
            return outcome;
        }
        let mut best = -1;
        let mut moves = position.legal_moves();
        while moves != 0 {
            let bit = moves.isolate_lowest_one();
            best = best.max(-exhaustive_outcome(position.played(bit), memo));
            if best == 1 {
                break;
            }
            moves ^= bit;
        }
        memo.insert(key, best);
        best
    }

    fn exhaustive_score(position: Position, memo: &mut HashMap<(u64, u64), i16>) -> i16 {
        if position.has_previous_win() {
            return -MATE_SCORE;
        }
        if position.mask.count_ones() as usize == COLS * ROWS {
            return 0;
        }
        let key = (position.current, position.mask);
        if let Some(&score) = memo.get(&key) {
            return score;
        }
        let mut best = i16::MIN + 1;
        let mut moves = position.legal_moves();
        while moves != 0 {
            let bit = moves.isolate_lowest_one();
            let child_score = -exhaustive_score(position.played(bit), memo);
            let score = if child_score > 0 {
                child_score - 1
            } else if child_score < 0 {
                child_score + 1
            } else {
                0
            };
            best = best.max(score);
            moves ^= bit;
        }
        memo.insert(key, best);
        best
    }

    fn non_terminal_position(seed: &mut u64, target_moves: usize) -> (Position, Vec<u8>) {
        let mut position = Position::default();
        let mut history = Vec::with_capacity(target_moves);
        for _ in 0..target_moves {
            let mut candidates = [0u8; COLS];
            let mut count = 0;
            for column in 0..COLS as u8 {
                if position.can_play(column)
                    && !position
                        .played(position.play_bit(column))
                        .has_previous_win()
                {
                    candidates[count] = column;
                    count += 1;
                }
            }
            if count == 0 {
                break;
            }
            *seed = seed.wrapping_mul(6_364_136_223_846_793_005).wrapping_add(1);
            let column = candidates[(*seed as usize) % count];
            position.play(column);
            history.push(column);
        }
        assert_eq!(position.mask.count_ones() as usize, target_moves);
        (position, history)
    }

    fn collect_position_keys(
        position: Position,
        depth: usize,
        max_depth: usize,
        keys: &mut HashMap<u64, (u64, u64)>,
    ) {
        let key = position_key(position);
        let value = (position.current, position.mask);
        if let Some(&existing) = keys.get(&key) {
            assert_eq!(existing, value, "position key collision for {key:#x}");
        } else {
            keys.insert(key, value);
        }

        if depth == max_depth || position.has_previous_win() {
            return;
        }

        let mut moves = position.legal_moves();
        while moves != 0 {
            let bit = moves.isolate_lowest_one();
            collect_position_keys(position.played(bit), depth + 1, max_depth, keys);
            moves ^= bit;
        }
    }
