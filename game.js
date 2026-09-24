// LAST THREE の遊びの中身（置く・古い印が消える・勝ち・引き分け・CPU）。
// DOM には触らない。ブラウザでは main.js から、テストでは node test.mjs から読む。

export const KEEP = 3;          // ひとりが盤に残せる印の数
export const REPEAT = 3;        // 同じ局面がこの回数出たら引き分け
export const CPU_DEPTH = 4;     // CPU「ふつう」が読む手数
export const LINES = [
  [0, 1, 2], [3, 4, 5], [6, 7, 8],
  [0, 3, 6], [1, 4, 7], [2, 5, 8],
  [0, 4, 8], [2, 4, 6],
];

// marks[p] は p（0 = ○、1 = ×）の印を置いた順に並べたもの（長さ 0〜3）
export function newGame() {
  const s = { marks: [[], []], turn: 0, ply: 0, seen: new Map(), over: false, winner: -1, line: null, draw: false };
  s.seen.set(key(s), 1);
  return s;
}

// 局面: ○ の並び・× の並び・手番（古さの順も含めて同じなら同じ局面）
export const key = (s) => `${s.marks[0].join('')}|${s.marks[1].join('')}|${s.turn}`;

export function board(s) {
  const b = new Array(9).fill(-1);
  s.marks.forEach((m, p) => m.forEach((i) => { b[i] = p; }));
  return b;
}

// p が次に置いたら消える印のマス（なければ -1）
export const fading = (s, p) => (s.marks[p].length === KEEP ? s.marks[p][0] : -1);

export const canPlace = (s, i) => !s.over && i >= 0 && i < 9 && !s.marks[0].includes(i) && !s.marks[1].includes(i);

export const lineOf = (m) => LINES.find((l) => l.every((i) => m.includes(i))) || null;

// 置く。消えた印のマス（なければ -1）を返す
export function place(s, i) {
  if (!canPlace(s, i)) throw new Error(`置けないマス: ${i}`);
  const m = s.marks[s.turn];
  m.push(i);
  const removed = m.length > KEEP ? m.shift() : -1;
  s.ply++;
  const line = lineOf(m);   // 消したあとで見る
  if (line) { s.over = true; s.winner = s.turn; s.line = line; return removed; }
  s.turn = 1 - s.turn;
  const k = key(s), n = (s.seen.get(k) || 0) + 1;
  s.seen.set(k, n);
  if (n >= REPEAT) { s.over = true; s.draw = true; }
  return removed;
}

// ---- CPU（minimax + αβ 枝刈り） ----
// ponytail: 読みの中では同じ局面の数え上げをしない（引き分けは盤の外で判定）。強い CPU を作るときは solve.mjs の全部読みを使う

const clone = (s) => ({ marks: [s.marks[0].slice(), s.marks[1].slice()], turn: s.turn });

function step(t, i) {
  const m = t.marks[t.turn];
  m.push(i);
  if (m.length > KEEP) m.shift();
  const won = !!lineOf(m);
  t.turn = 1 - t.turn;
  return won;
}

// 「p の印 2 つ＋空き 1 つ」の列の数。次に消える印は数えない
function threats(t, p) {
  const b = new Array(9).fill(-1);
  t.marks.forEach((m, q) => m.forEach((i) => { b[i] = q; }));
  const f = t.marks[p].length === KEEP ? t.marks[p][0] : -1;
  let n = 0;
  for (const l of LINES) {
    let own = 0, empty = 0;
    for (const i of l) { if (b[i] === -1) empty++; else if (b[i] === p && i !== f) own++; }
    if (own === 2 && empty === 1) n++;
  }
  return n;
}

// me から見た点。t.turn の番
function search(t, me, depth, ply, alpha, beta) {
  if (depth === 0) return threats(t, me) - threats(t, 1 - me);
  const mover = t.turn;
  let best = mover === me ? -Infinity : Infinity;
  for (let i = 0; i < 9; i++) {
    if (t.marks[0].includes(i) || t.marks[1].includes(i)) continue;
    const u = clone(t);
    const v = step(u, i)
      ? (mover === me ? 1000 - ply : -1000 + ply)
      : search(u, me, depth - 1, ply + 1, alpha, beta);
    if (mover === me) { if (v > best) best = v; if (best > alpha) alpha = best; }
    else { if (v < best) best = v; if (best < beta) beta = best; }
    if (alpha >= beta) break;
  }
  return best;
}

// 今の手番の最善手。同じ点の手はランダムに選ぶ
export function cpuMove(s, depth = CPU_DEPTH, rand = Math.random) {
  const me = s.turn;
  let best = -Infinity, picks = [];
  for (let i = 0; i < 9; i++) {
    if (!canPlace(s, i)) continue;
    const u = clone(s);
    const v = step(u, i) ? 1000 - 1 : search(u, me, depth - 1, 2, -Infinity, Infinity);
    if (v > best) { best = v; picks = [i]; } else if (v === best) picks.push(i);
  }
  return picks[Math.floor(rand() * picks.length)];
}
