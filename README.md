# Connect4 AI

React製のConnect Fourと、Rust/Wasmで動作する強力なAI solverのモノレポです。

## 構成

```text
apps/web/          React + TypeScript + Vite
  src/ai.worker.ts  Web WorkerからWasm solverを実行
crates/solver/     Rust bitboard solver
```

## AIのアルゴリズム

Connect Fourを`7 × 6`の盤面として直接扱うのではなく、各列にsentinel bitを加えた49-bit bitboardとして表現します。Rustでは`u64`を使えるため、着手生成や4連判定を高速なbit演算で処理できます。

探索は以下を組み合わせています。

- Negamax + Alpha-Beta pruning
- 即時勝利、強制ブロック、敗着除外、double threatのpruning
- center-first、threat score、TT best move、history heuristicによるmove ordering
- 固定長配列のTransposition Table（Exact / Lower bound / Upper bound）
- 左右対称局面のcanonicalization
- Iterative deepening
- PVS / NegaScout形式のnull-window search
- Aspiration window
- 勝敗だけでなく、勝利までの距離を考慮したスコア
- Worker内のsolverインスタンスを再利用し、手が進んだ後も固定長Transposition Tableの探索結果を再利用

探索本体はWasm内に閉じ込めています。通常の着手はWeb Workerへの1回の依頼で処理し、先読み時は候補ごとの結果を逐次受け取ります。Web Worker上で実行するため、AIの探索中もUIとアニメーションは停止しません。

人間の手番中も、現在の局面から可能な各着手をバックグラウンドで順番に探索します。候補ごとの応手はキャッシュされ、実際に人間が選んだ列の結果が準備済みなら即座にAIが応答します。未準備の場合も、先読みを中断して短い制限時間の探索へ切り替えます。

## AI対戦モード

画面上で以下を選択できます。

- 対人戦
- AIが先手
- AIが後手

ゲーム状態と着手履歴は`localStorage`に保存されます。AI対戦時のUndoは、直前の人間とAIの1ラウンドを戻します。盤面のリセットや対戦モードの変更も操作履歴に記録されるため、「1手戻る」で変更前の盤面とモードへ戻せます。

探索表はWorkerのsolverインスタンスが保持し続けます。盤面が進んだ場合は、新しい局面をルートにして探索しますが、直前の探索で得た子局面・共通局面の評価をTransposition Tableから再利用します。盤面のリセット後も、同じ局面へ戻った場合は残っている表を活用できます。

## ローカルで動かす

必要なツールは以下です。

- Node.js 22以上
- npm
- Rust stable / Cargo
- `wasm32-unknown-unknown` target
- `wasm-pack`

Rustのツールチェーンが未設定の場合は、先に以下を実行します。

```bash
rustup target add wasm32-unknown-unknown
cargo install wasm-pack --locked
```

リポジトリのルートで依存関係をインストールします。

```bash
npm install
```

開発サーバーを起動します。Wasm solverを生成してから、Viteの開発サーバーが起動します。

```bash
npm run dev
```

ブラウザで http://localhost:5173/ を開いてください。

Rust solverだけを再ビルドしたい場合は、以下を実行します。

```bash
npm run build:wasm
```

## 検証と本番ビルド

主な検証コマンド：

```bash
npm run format:check
npm run lint
npm test
npm run build
```

`npm run build`はRust solverをWasmへ変換してからWebアプリをビルドします。GitHub Actionsでも同じ検証・生成手順を実行し、`apps/web/dist`をGitHub Pagesへデプロイします。

本番ビルドのプレビューは以下で起動できます。

```bash
npm run build
npm run preview
```

`npm run preview`を実行した後、表示されたローカルURLを開いてください。

## 探索時間について

solverは最大42手まで探索できます。Web UIでは、先読みがない局面でも人間の着手後1秒以内に応答しやすいよう、通常探索の制限時間を短く設定しています。そのためUIからの着手は「制限時間内で最も深く探索できた手」です。`apps/web/src/App.tsx`の`timeMs`を`0`にすると時間制限なしの探索になりますが、序盤局面では非常に長くなる場合があります。
