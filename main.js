// 画面と操作。遊びの中身は game.js にある。
import { newGame, place, canPlace, board, cpuMove } from './game.js';

// localStorage はほかのアプリと共有される（同じ t-of.github.io のため）。
// キーは必ず 'last-three.' で始める。
const STORE = 'last-three.';

function load(key) {
  try {
    const v = localStorage.getItem(STORE + key);
    return v == null ? null : JSON.parse(v);
  } catch { return null; }
}
function save(key, value) {
  try { localStorage.setItem(STORE + key, JSON.stringify(value)); } catch { /* 保存できなくても遊べる */ }
}

WebAppKit.init({ title: 'LAST THREE', text: '○と×を交互に置いて、縦・横・斜めに 3 つ並べたら勝ち。ただし盤に残るのは自分の新しい 3 つだけで、4 つ目を置くと一番古い印が消える。CPU 対戦・ふたり対戦。' });

// localhost でも動かす（audit のオフライン確認のため）。自分のファイルは network-first なので開発の邪魔にならない
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js');
}

// ---- ここからアプリ本体 ----

const $ = (id) => document.getElementById(id);
const reduced = matchMedia('(prefers-reduced-motion: reduce)');
const MARK = ['○', '×'];

// 読めない・範囲外の値ははじめの値に戻す
function loadSettings() {
  const s = load('settings') || {};
  return {
    v: 1,
    mode: s.mode === 'pvp' ? 'pvp' : 'cpu',
    side: s.side === 'second' ? 'second' : 'first',
    sound: typeof s.sound === 'boolean' ? s.sound : true,
    seenHelp: s.seenHelp === true,
  };
}
function loadStats() {
  const c = (load('stats') || {}).cpu || {};
  const n = (x) => (Number.isInteger(x) && x >= 0 ? x : 0);
  return { v: 1, cpu: { win: n(c.win), lose: n(c.lose), draw: n(c.draw) } };
}
let settings = loadSettings();
let stats = loadStats();

// ---- 効果音（Web Audio で作る。音声ファイルは使わない） ----
// iPhone のマナーモードでも鳴らす（Safari 16.4 以降）。
// 'playback' にすると音楽アプリの曲が止まるので、アプリの音がオンのときだけにする。
function setAudioSession(soundOn) {
  try { if (navigator.audioSession) navigator.audioSession.type = soundOn ? 'playback' : 'auto'; } catch { /* 対応していない */ }
}
const Sound = {
  ctx: null, out: null,
  // 最初に触ったときに呼ぶ（ブラウザは触る前の音を止める）
  ensure() {
    if (!settings.sound) return null;
    if (!this.ctx || this.ctx.state === 'suspended') setAudioSession(true);
    if (!this.ctx) {
      try { this.ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch { return null; }
      this.out = this.ctx.createGain();
      this.out.gain.value = 0.6;   // 全体を控えめに
      this.out.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
    return this.ctx;
  },
  tone(freq, dur, { type = 'sine', gain = 0.08, at = 0, bend = 1 } = {}) {
    const c = this.ensure();
    if (!c) return;
    const t = c.currentTime + at;
    const o = c.createOscillator(), v = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (bend !== 1) o.frequency.exponentialRampToValueAtTime(freq * bend, t + dur);
    v.gain.setValueAtTime(0.0001, t);
    v.gain.exponentialRampToValueAtTime(gain, t + 0.006);
    v.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(v).connect(this.out);
    o.start(t); o.stop(t + dur + 0.05);
  },
  click() { this.tone(1400, 0.03, { gain: 0.04 }); },
  put(p) { this.tone(p === 0 ? 660 : 520, 0.14, { gain: 0.1, bend: 0.94 }); },
  gone() { this.tone(1500, 0.16, { gain: 0.035, at: 0.08, bend: 0.4 }); },
  bad() { this.tone(120, 0.09, { type: 'triangle', gain: 0.08 }); },
  win() { [523, 659, 784].forEach((f, i) => this.tone(f, 0.22, { type: 'triangle', gain: 0.07, at: i * 0.09 })); },
  lose() { [440, 330].forEach((f, i) => this.tone(f, 0.25, { type: 'triangle', gain: 0.07, at: i * 0.14 })); },
  draw() { [494, 494].forEach((f, i) => this.tone(f, 0.18, { type: 'triangle', gain: 0.06, at: i * 0.16 })); },
};
setAudioSession(settings.sound);
document.addEventListener('pointerdown', () => Sound.ensure(), { capture: true });
// ボタンを押したら「コッ」（盤のマスは置く音を鳴らすので除く）
document.addEventListener('click', (e) => { if (e.target.closest('button:not(.cell)')) Sound.click(); });

const soundButton = document.querySelector('[data-sound]');
function renderSound() {
  soundButton.setAttribute('aria-pressed', settings.sound);
  soundButton.querySelector('span').textContent = settings.sound ? '音 オン' : '音 オフ';
}
soundButton.addEventListener('click', () => {
  settings = { ...settings, sound: !settings.sound };
  save('settings', settings);
  setAudioSession(settings.sound);
  renderSound();
});
renderSound();

// ---- 盤（対局とタイトルの見本で同じものを使う） ----
const SVG = 'http://www.w3.org/2000/svg';
const center = (i) => [(i % 3) * 100 / 3 + 50 / 3, Math.floor(i / 3) * 100 / 3 + 50 / 3];

function makeBoard(el, tag) {
  // 線は手で引いたように少しだけ曲げる
  el.innerHTML = `<svg class="board__lines" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
      <path d="M33.6 3Q32.8 50 33.2 97M66.8 3.5Q67.4 50 66.5 96.5M3 33.4Q50 32.6 97 33.1M3.5 66.6Q50 67.3 96.5 66.9"/>
    </svg>
    <svg class="board__win" viewBox="0 0 100 100" aria-hidden="true"><line/></svg>`;
  const cells = [];
  for (let i = 0; i < 9; i++) {
    const c = document.createElement(tag);
    c.className = 'cell';
    c.style.gridArea = `${Math.floor(i / 3) + 1} / ${(i % 3) + 1}`;
    el.append(c);
    cells.push(c);
  }
  return { el, cells, win: el.querySelector('.board__win line') };
}

function markEl(p) {
  const m = document.createElementNS(SVG, 'svg');
  m.setAttribute('viewBox', '0 0 100 100');
  m.setAttribute('class', `mark ${p ? 'x' : 'o'}`);
  m.dataset.p = p;
  m.innerHTML = `<rect class="ring" x="7" y="7" width="86" height="86" rx="18"/>
    <g class="glyph">${p ? '<path d="M29 29 71 71M71 29 29 71"/>' : '<circle cx="50" cy="50" r="24"/>'}</g>`;
  return m;
}

function leave(m) {
  m.classList.add('leaving');
  if (reduced.matches) m.remove();
  else setTimeout(() => m.remove(), 250);
}

// 盤を s に合わせる。印の古さ: 一番新しい / 真ん中（mid）/ 次に消える（fade）
function paint(view, s) {
  const b = board(s);
  view.cells.forEach((c, i) => {
    const p = b[i];
    let m = c.querySelector('.mark:not(.leaving)');
    if (m && +m.dataset.p !== p) { leave(m); m = null; }
    if (p < 0) { c.removeAttribute('data-age'); return; }
    if (!m) { m = markEl(p); c.append(m); }
    const list = s.marks[p], idx = list.indexOf(i);
    let age = list.length === 3 && idx === 0 ? 'fade' : idx === list.length - 1 ? 'new' : 'mid';
    if (s.over && age === 'fade') age = 'mid';   // 終わったら、次に消える印はない
    if (s.line && s.line.includes(i)) age = 'new';
    m.classList.toggle('mid', age === 'mid');
    m.classList.toggle('fade', age === 'fade');
    c.dataset.age = age;
  });
  if (s.line) {
    const [a, z] = [center(s.line[0]), center(s.line[2])];
    const dx = (z[0] - a[0]) * 0.18, dy = (z[1] - a[1]) * 0.18;
    view.win.setAttribute('x1', a[0] - dx); view.win.setAttribute('y1', a[1] - dy);
    view.win.setAttribute('x2', z[0] + dx); view.win.setAttribute('y2', z[1] + dy);
    view.el.dataset.win = s.winner ? 'x' : 'o';
  } else {
    view.el.removeAttribute('data-win');
  }
}

function clearBoard(view) {
  view.cells.forEach((c) => { c.replaceChildren(); c.removeAttribute('data-age'); c.className = 'cell'; });
  view.el.removeAttribute('data-win');
}

// ---- 対局 ----
const view = makeBoard($('board'), 'button');
view.cells.forEach((c, i) => {
  c.setAttribute('aria-label', `${Math.floor(i / 3) + 1} 段目 ${(i % 3) + 1} 列目`);
  c.addEventListener('click', () => tap(i));
});

let g = null;        // 対局
let mode = 'cpu';    // 'cpu' / 'pvp'
let human = 0;       // CPU 戦で人が持つ側（0 = ○ 先手、1 = × 後手）
let busy = false;    // CPU の番・結果を出す前

const cpuTurn = () => mode === 'cpu' && g.turn !== human;

// 時間をおいて呼ぶ。そのあいだに対局をやめていたら何もしない
function later(fn, ms) {
  const game = g;
  setTimeout(() => { if (g === game) fn(); }, ms);
}

function tap(i) {
  if (!g || g.over || busy || cpuTurn()) return;
  if (!canPlace(g, i)) {
    Sound.bad();
    const c = view.cells[i];
    c.classList.remove('shake');
    void c.offsetWidth;   // 続けて押しても揺らし直す
    c.classList.add('shake');
    return;
  }
  put(i);
}

function put(i) {
  const p = g.turn;
  const removed = place(g, i);
  Sound.put(p);
  if (removed >= 0) Sound.gone();
  if (g.over) { busy = true; render(); later(finish, 600); return; }
  if (cpuTurn()) cpuPlay(400 + Math.random() * 200);
  else render();
}

function cpuPlay(wait) {
  busy = true;
  render();
  later(() => {
    const m = cpuMove(g);
    view.cells[m].classList.add('aim');   // 置くマスを一瞬光らせる
    later(() => { view.cells[m].classList.remove('aim'); busy = false; put(m); }, 220);
  }, wait);
}

function render() {
  paint(view, g);
  const who = (p) => (mode === 'cpu' ? (p === human ? 'あなた' : 'CPU') : p === 0 ? '先手' : '後手');
  if (g.over) $('turn').textContent = g.draw ? '引き分け' : `${MARK[g.winner]} が 3 つ並んだ`;
  else if (mode === 'pvp') $('turn').textContent = `${MARK[g.turn]} の番`;
  else $('turn').textContent = cpuTurn() ? 'CPU が考え中…' : 'あなたの番';
  $('ply').textContent = `${g.ply} 手`;
  for (const p of [0, 1]) {
    const n = g.marks[p].length;
    const dots = [0, 1, 2].map((k) => `<i class="${k < n ? 'on' : ''}${n === 3 && k === 0 && !g.over ? ' fade' : ''}"></i>`).join('');
    const h = $(`hand${p}`);
    h.className = `hand hand--${p ? 'x' : 'o'}${!g.over && g.turn === p ? ' is-turn' : ''}`;
    h.innerHTML = `<b>${MARK[p]}</b><span>${who(p)}</span><span class="dots" aria-label="盤に ${n} つ">${dots}</span>`;
  }
  view.cells.forEach((c, i) => { c.disabled = g.over; c.classList.toggle('open', canPlace(g, i)); });
}

// ---- 画面 ----
function show(screen) {
  $('title').hidden = screen !== 'title';
  $('game').hidden = screen !== 'game';
  $('result').hidden = true;
  if (screen === 'title') demo.start(); else demo.stop();
}

function renderTitle() {
  document.querySelectorAll('[data-side]').forEach((b) => b.setAttribute('aria-pressed', b.dataset.side === settings.side));
  const { win, lose, draw } = stats.cpu;
  $('stats').textContent = win + lose + draw
    ? `CPU 戦　勝ち ${win} ・ 負け ${lose} ・ 引き分け ${draw}`
    : 'CPU 戦の記録はまだありません';
}

function start() {
  mode = settings.mode;
  human = settings.side === 'second' ? 1 : 0;
  g = newGame();
  busy = false;
  clearBoard(view);
  show('game');
  if (cpuTurn()) cpuPlay(600);   // CPU が先手なら、盤を見せてから置く
  else render();
}

function finish() {
  let head, cls;
  if (g.draw) { head = '引き分け（同じ形が 3 回）'; cls = 'draw'; Sound.draw(); }
  else if (mode === 'pvp') { head = `${MARK[g.winner]} の勝ち`; cls = g.winner ? 'x' : 'o'; Sound.win(); }
  else if (g.winner === human) { head = 'あなたの勝ち'; cls = 'win'; Sound.win(); }
  else { head = '負け'; cls = 'lose'; Sound.lose(); }
  if (mode === 'cpu') {
    const r = g.draw ? 'draw' : g.winner === human ? 'win' : 'lose';
    stats = { v: 1, cpu: { ...stats.cpu, [r]: stats.cpu[r] + 1 } };
    save('stats', stats);
  }
  $('result-head').textContent = head;
  $('result-head').className = `result__head ${cls}`;
  $('result-ply').textContent = `${g.ply} 手`;
  $('result').hidden = false;
  // 最後に置いた勢いで［もう一回］を押さないように、少しのあいだ押せなくする
  const buttons = $('result').querySelectorAll('button');
  buttons.forEach((b) => { b.disabled = true; });
  later(() => buttons.forEach((b) => { b.disabled = false; }), 400);
}

function shareText() {
  if (mode === 'pvp') return g.draw ? `LAST THREE で ${g.ply} 手の引き分け` : `LAST THREE で ${MARK[g.winner]} が ${g.ply} 手で勝ち`;
  if (g.draw) return `LAST THREE で CPU と ${g.ply} 手の引き分け`;
  return g.winner === human ? `LAST THREE で CPU に ${g.ply} 手で勝った！` : `LAST THREE で CPU に ${g.ply} 手で負けた。次こそ`;
}

const help = $('help');
let afterHelp = null;
function openHelp(then = null) { afterHelp = then; help.showModal(); }
help.addEventListener('close', () => { const f = afterHelp; afterHelp = null; if (f) f(); });
$('help-close').addEventListener('click', () => help.close());

function play(m) {
  settings = { ...settings, mode: m };
  if (settings.seenHelp) { save('settings', settings); return start(); }
  settings = { ...settings, seenHelp: true };
  save('settings', settings);
  openHelp(start);
}
$('play-cpu').addEventListener('click', () => play('cpu'));
$('play-pvp').addEventListener('click', () => play('pvp'));
document.querySelectorAll('[data-side]').forEach((b) => b.addEventListener('click', () => {
  settings = { ...settings, side: b.dataset.side };
  save('settings', settings);
  renderTitle();
}));
$('howto').addEventListener('click', () => openHelp());
function toTitle() { g = null; renderTitle(); show('title'); }
$('quit').addEventListener('click', () => {
  if (g.over || g.ply === 0 || confirm('対局をやめて、タイトルへ戻りますか？')) toTitle();
});
$('again').addEventListener('click', start);
$('share-result').addEventListener('click', () => WebAppKit.share({ text: shareText() }));
$('to-title').addEventListener('click', toTitle);

// PC 用: 1〜9 のキーで置く（テンキーの並び。7 が左上、3 が右下）
document.addEventListener('keydown', (e) => {
  if (!g || help.open || !/^[1-9]$/.test(e.key)) return;
  const k = +e.key - 1;
  tap((2 - Math.floor(k / 3)) * 3 + (k % 3));
});

// ---- タイトルの見本: 置いては一番古い印が消える、をくり返す ----
const demo = {
  view: makeBoard($('demo'), 'div'),
  moves: [0, 2, 1, 3, 6, 5, 8, 7, 0, 2],   // 7 手目から古い印が消える。どちらも 3 つ並ばない
  timer: 0,
  start() {
    this.stop();
    clearBoard(this.view);
    const s = newGame();
    if (reduced.matches) {   // 動かさずに、消える前の絵だけ見せる
      this.moves.slice(0, 6).forEach((i) => place(s, i));
      paint(this.view, s);
      return;
    }
    let n = 0;
    const tick = () => {
      if (n === this.moves.length) { this.timer = setTimeout(() => this.start(), 1400); return; }
      place(s, this.moves[n++]);
      paint(this.view, s);
      this.timer = setTimeout(tick, 850);
    };
    this.timer = setTimeout(tick, 500);
  },
  stop() { clearTimeout(this.timer); },
};
reduced.addEventListener('change', () => { if (!$('title').hidden) demo.start(); });

renderTitle();
demo.start();
