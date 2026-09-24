// 遊びの中身のテスト。node test.mjs で走る（フレームワークなし）。
import assert from 'node:assert/strict';
import { newGame, place, canPlace, fading, board, cpuMove } from './game.js';

const test = (name, fn) => { fn(); console.log('✓', name); };
const play = (cells) => { const s = newGame(); for (const i of cells) place(s, i); return s; };

test('○ が 0・1・2 に置いて勝つ（消える前の普通の勝ち）', () => {
  const s = play([0, 3, 1, 4, 2]);
  assert.ok(s.over);
  assert.equal(s.winner, 0);
  assert.deepEqual(s.line, [0, 1, 2]);
  assert.equal(s.ply, 5);
});

test('4 つ目を置くと一番古い印が消える', () => {
  const s = play([0, 4, 1, 5, 6, 7]);    // ○ 0 1 6、× 4 5 7
  assert.equal(fading(s, 0), 0);
  assert.equal(place(s, 8), 0);          // ○ 8 → 0 が消える
  assert.deepEqual(s.marks[0], [1, 6, 8]);
  assert.equal(board(s)[0], -1);
  assert.equal(fading(s, 0), 1);
});

test('消えた印は数えない（0・1 と 2 で並んでも、0 が消えれば勝ちにならない）', () => {
  const s = play([0, 4, 1, 5, 6, 7]);    // ○ 0 1 6
  place(s, 8);                           // ○ 1 6 8
  place(s, 3);                           // × 5 7 3（4 が消える）
  place(s, 2);                           // ○ 6 8 2（1 が消える）。0・1・2 は並ばない
  assert.ok(!s.over);
});

test('残った 3 つで勝つ', () => {
  // ○ 0 1 6 → 7（0 消え: 1 6 7）→ 8（1 消え: 6 7 8）で下の段
  const s = play([0, 4, 1, 5, 6, 2, 7, 3]);
  assert.ok(!s.over);
  place(s, 8);
  assert.ok(s.over);
  assert.equal(s.winner, 0);
  assert.deepEqual(s.line, [6, 7, 8]);
});

test('自分の次に消える印のマスには置けない', () => {
  const s = play([0, 4, 1, 5, 6, 7]);    // ○ の番、次に消えるのは 0
  assert.equal(fading(s, 0), 0);
  assert.ok(!canPlace(s, 0));
  assert.ok(!canPlace(s, 4));            // 相手の印
  assert.throws(() => place(s, 0));
});

test('同じ局面の 3 回目で引き分け', () => {
  // ○ 0 1 6、× 2 3 5（空きは 4・7・8）から
  const s = play([0, 2, 1, 3, 6, 5]);
  const loop = [8, 7, 0, 2, 1, 3, 6, 5];
  // ○ 8（0 消え）× 7（2 消え）○ 0（1 消え）× 2（3 消え）○ 1（6 消え）× 3（5 消え）
  // ○ 6（8 消え）× 5（7 消え）→ ○ 0 1 6 / × 2 3 5 に戻る（8 手で 1 周）
  let n = 0;
  while (!s.over && n < 40) { place(s, loop[n % loop.length]); n++; }
  assert.ok(s.draw, '引き分けになる');
  assert.equal(s.winner, -1);
  assert.equal(n, 16);                   // 1 周 8 手、2 周で 3 回目
});

test('CPU は勝てる手があれば勝ち、負けそうなら防ぐ', () => {
  const win = play([0, 3, 1, 4]);        // ○ の番、2 で勝ち
  assert.equal(cpuMove(win), 2);
  const block = play([0, 3, 1]);         // × の番、2 をふさがないと負け
  assert.equal(cpuMove(block), 2);
});

test('CPU どうしで最後まで打てる（置けない手を選ばない）', () => {
  for (let g = 0; g < 20; g++) {
    const s = newGame();
    while (!s.over && s.ply < 300) place(s, cpuMove(s));
    assert.ok(s.over);
  }
});
