'use strict';

const COLS = 10;
const ROWS = 20;
const BLOCK = 30;

const COLORS = [
  null,
  '#4dd0e1', // I - cyan
  '#ffd54f', // O - yellow
  '#ba68c8', // T - purple
  '#81c784', // S - green
  '#e57373', // Z - red
  '#90caf9', // J - pale blue
  '#ffb74d', // L - orange
  '#b0bec5', // N - tuerca (gris metálico)
  '#ffffff', // 9 - comodín (se pinta con degradado arcoíris)
  '#ff7043', // 10 - bomba
  '#fff176', // 11 - rayo
  '#f06292', // 12 - tinte
  '#9575cd', // 13 - gravedad
  '#4fc3f7', // 14 - congelar
];

// Piezas especiales: bloque 1×1 cuyo índice (10–14) es también su tipo
const WILD = 9;
const SPECIAL = { BOMB: 10, RAY: 11, TINT: 12, GRAVITY: 13, FREEZE: 14 };
const SPECIAL_ICONS = { 10: '💣', 11: '⚡', 12: '🎨', 13: '🌀', 14: '❄️' };
const SPECIAL_NAMES = { 10: '¡BOMBA!', 11: '¡RAYO!', 12: '¡TINTE!', 13: '¡GRAVEDAD!', 14: '¡CONGELAR!' };
const SPECIAL_EVERY = 5;   // líneas entre piezas especiales
const FREEZE_MS = 5000;
const WILD_BONUS = 50;     // puntos extra por comodín en una línea limpiada
const EFFECT_MSG_MS = 1200;

const PIECES = [
  null,
  [[0,0,0,0],[1,1,1,1],[0,0,0,0],[0,0,0,0]], // I
  [[2,2],[2,2]],                               // O
  [[0,3,0],[3,3,3],[0,0,0]],                  // T
  [[0,4,4],[4,4,0],[0,0,0]],                  // S
  [[5,5,0],[0,5,5],[0,0,0]],                  // Z
  [[6,0,0],[6,6,6],[0,0,0]],                  // J
  [[0,0,7],[7,7,7],[0,0,0]],                  // L
  [[8,8,8],[8,0,8],[8,8,8]],                  // N (tuerca)
];

const LINE_SCORES = [0, 100, 300, 500, 800];

const canvas = document.getElementById('board');
const ctx = canvas.getContext('2d');
const nextCanvas = document.getElementById('next-canvas');
const nextCtx = nextCanvas.getContext('2d');
const scoreEl = document.getElementById('score');
const linesEl = document.getElementById('lines');
const levelEl = document.getElementById('level');
const overlay = document.getElementById('overlay');
const overlayTitle = document.getElementById('overlay-title');
const overlayScore = document.getElementById('overlay-score');
const restartBtn = document.getElementById('restart-btn');
const themeBtn = document.getElementById('theme-toggle');

let theme = 'dark';
let gridColor = '#22222e';

let board, current, next, score, lines, level, paused, gameOver, lastTime, dropAccum, dropInterval, animId;
let pendingSpecial, nextSpecialAt, freezeLeft;
let combo, b2b, lastMoveRotate, popups, shake, flash;
let muted = false;
let audioCtx = null;

// Combo, T-spin, B2B y Perfect Clear
const TSPIN_SCORES = [400, 800, 1200, 1600];
const CLEAR_NAMES = ['', 'SINGLE', 'DOUBLE', 'TRIPLE', 'TETRIS'];
const MAX_COMBO = 10;
const B2B_MULT = 1.5;
const PERFECT_CLEAR_BONUS = 3000;
const POPUP_MS = 1400;

function ensureAudio() {
  if (!audioCtx) {
    try { audioCtx = new (window.AudioContext || window.webkitAudioContext)(); } catch { return; }
  }
  if (audioCtx.state === 'suspended') audioCtx.resume();
}

function tone(freq, dur, type = 'square', delay = 0, vol = 0.06) {
  if (muted || !audioCtx) return;
  const t = audioCtx.currentTime + delay;
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(vol, t);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(gain).connect(audioCtx.destination);
  osc.start(t);
  osc.stop(t + dur);
}

function playClearSound(cleared, tspin, perfect) {
  const base = 440 * Math.pow(2, combo / 6); // sube de tono con el combo
  if (perfect) {
    [1, 1.25, 1.5, 2, 2.5].forEach((m, i) => tone(base * m, 0.25, 'triangle', i * 0.09, 0.08));
  } else if (tspin) {
    tone(base * 1.5, 0.12, 'sawtooth');
    tone(base * 2, 0.2, 'sawtooth', 0.1);
  } else if (cleared === 4) {
    [1, 1.25, 1.5, 2].forEach((m, i) => tone(base * m, 0.14, 'square', i * 0.07));
  } else {
    tone(base, 0.15);
  }
}

function showPopup(text, color = '#fff') {
  popups.push({ text, color, life: POPUP_MS, max: POPUP_MS });
  if (popups.length > 4) popups.shift();
}

function setCombo(n) {
  combo = n;
  const el = document.getElementById('combo');
  el.textContent = n >= 2 ? `x${n}` : '—';
  if (n >= 2) {
    el.classList.remove('pulse');
    void el.offsetWidth; // reinicia la animación
    el.classList.add('pulse');
  }
}

function occupied(x, y) {
  return x < 0 || x >= COLS || y >= ROWS || (y >= 0 && board[y][x] !== 0);
}

// Regla de 3 esquinas: la T (3×3) con última acción = rotación y ≥3 diagonales ocupadas
function isTSpin() {
  if (current.type !== 3 || !lastMoveRotate) return false;
  const cx = current.x + 1, cy = current.y + 1;
  const corners = [[-1, -1], [1, -1], [-1, 1], [1, 1]];
  return corners.filter(([dx, dy]) => occupied(cx + dx, cy + dy)).length >= 3;
}

function scoreClear(cleared, tspin) {
  if (!cleared) {
    setCombo(0);
    if (tspin) {
      score += TSPIN_SCORES[0] * level;
      showPopup('T-SPIN', '#ba68c8');
      playClearSound(0, true, false);
      updateHUD();
    }
    return;
  }

  setCombo(Math.min(combo + 1, MAX_COMBO));
  const hard = tspin || cleared === 4;
  const b2bBonus = hard && b2b;
  b2b = hard;

  const base = tspin ? TSPIN_SCORES[cleared] : LINE_SCORES[cleared];
  score += Math.round(base * (b2bBonus ? B2B_MULT : 1)) * combo * level;

  const perfect = board.every(row => row.every(v => v === 0));
  if (perfect) score += PERFECT_CLEAR_BONUS * level;

  const name = (tspin ? 'T-SPIN ' : '') + CLEAR_NAMES[cleared];
  showPopup((b2bBonus ? 'B2B ' : '') + name, hard ? '#ffd54f' : '#fff');
  if (combo >= 2) showPopup(`COMBO x${combo}`, '#4fc3f7');
  if (perfect) showPopup('PERFECT CLEAR!', '#69f0ae');

  shake = Math.min(400, 100 + 40 * combo + (hard ? 120 : 0));
  if (perfect || b2bBonus) flash = 250;
  playClearSound(cleared, tspin, perfect);
  updateHUD();
}

function createBoard() {
  return Array.from({ length: ROWS }, () => new Array(COLS).fill(0));
}

function randomSpecial() {
  const type = SPECIAL.BOMB + Math.floor(Math.random() * 5);
  return { type, shape: [[type]], x: Math.floor(COLS / 2), y: 0, special: true };
}

function applySpecial() {
  const r = current.y, c = current.x, type = current.type;
  let destroyed = 0;
  const clearCell = (y, x) => {
    if (y < 0 || y >= ROWS || x < 0 || x >= COLS || !board[y][x]) return;
    board[y][x] = 0;
    destroyed++;
  };

  if (type === SPECIAL.BOMB) {
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) clearCell(r + dy, c + dx);
  } else if (type === SPECIAL.RAY) {
    for (let x = 0; x < COLS; x++) clearCell(r, x);
    for (let y = 0; y < ROWS; y++) clearCell(y, c);
  } else if (type === SPECIAL.TINT) {
    let target = r + 1 < ROWS ? board[r + 1][c] : 0;
    if (target < 1 || target > 8) {
      const counts = new Array(9).fill(0);
      for (const row of board) for (const v of row) if (v >= 1 && v <= 8) counts[v]++;
      const max = Math.max(...counts);
      target = max > 0 ? counts.indexOf(max) : 0;
    }
    if (target) {
      for (let y = 0; y < ROWS; y++)
        for (let x = 0; x < COLS; x++)
          if (board[y][x] === target) board[y][x] = WILD;
    }
  } else if (type === SPECIAL.GRAVITY) {
    for (let x = 0; x < COLS; x++) {
      const col = [];
      for (let y = 0; y < ROWS; y++) if (board[y][x]) col.push(board[y][x]);
      for (let y = ROWS - 1; y >= 0; y--) board[y][x] = col.length ? col.pop() : 0;
    }
  } else if (type === SPECIAL.FREEZE) {
    freezeLeft = FREEZE_MS;
  }

  score += destroyed * 10 * level;
  showPopup(SPECIAL_NAMES[type], '#ffb74d');
  tone(660, 0.1, 'triangle');
  tone(880, 0.12, 'triangle', 0.08);
  updateHUD();
}

function randomPiece() {
  const type = Math.floor(Math.random() * (PIECES.length - 1)) + 1;
  const shape = PIECES[type].map(row => [...row]);
  return { type, shape, x: Math.floor(COLS / 2) - Math.floor(shape[0].length / 2), y: 0 };
}

function collide(shape, ox, oy) {
  for (let r = 0; r < shape.length; r++) {
    for (let c = 0; c < shape[r].length; c++) {
      if (!shape[r][c]) continue;
      const nx = ox + c;
      const ny = oy + r;
      if (nx < 0 || nx >= COLS || ny >= ROWS) return true;
      if (ny >= 0 && board[ny][nx]) return true;
    }
  }
  return false;
}

function rotateCW(shape) {
  const rows = shape.length, cols = shape[0].length;
  const result = Array.from({ length: cols }, () => new Array(rows).fill(0));
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++)
      result[c][rows - 1 - r] = shape[r][c];
  return result;
}

function tryRotate() {
  const rotated = rotateCW(current.shape);
  const kicks = [0, -1, 1, -2, 2];
  for (const kick of kicks) {
    if (!collide(rotated, current.x + kick, current.y)) {
      current.shape = rotated;
      current.x += kick;
      lastMoveRotate = true;
      return;
    }
  }
}

function merge() {
  for (let r = 0; r < current.shape.length; r++)
    for (let c = 0; c < current.shape[r].length; c++)
      if (current.shape[r][c])
        board[current.y + r][current.x + c] = current.shape[r][c];
}

function clearLines() {
  let cleared = 0;
  for (let r = ROWS - 1; r >= 0; r--) {
    if (board[r].every(v => v !== 0)) {
      const wilds = board[r].filter(v => v === WILD).length;
      score += wilds * WILD_BONUS * level;
      board.splice(r, 1);
      board.unshift(new Array(COLS).fill(0));
      cleared++;
      r++;
    }
  }
  if (cleared) {
    lines += cleared;
    while (lines >= nextSpecialAt) {
      pendingSpecial = true;
      nextSpecialAt += SPECIAL_EVERY;
    }
    level = Math.floor(lines / 10) + 1;
    dropInterval = Math.max(100, 1000 - (level - 1) * 90);
    updateHUD();
  }
  return cleared;
}

function ghostY() {
  let gy = current.y;
  while (!collide(current.shape, current.x, gy + 1)) gy++;
  return gy;
}

function hardDrop() {
  const gy = ghostY();
  score += (gy - current.y) * 2;
  current.y = gy;
  lockPiece();
}

function softDrop() {
  if (!collide(current.shape, current.x, current.y + 1)) {
    current.y++;
    lastMoveRotate = false;
    score += 1;
    updateHUD();
  } else {
    lockPiece();
  }
}

function lockPiece() {
  const tspin = !current.special && isTSpin();
  if (current.special) applySpecial();
  else merge();
  const cleared = clearLines();
  scoreClear(cleared, tspin);
  lastMoveRotate = false;
  spawn();
}

function spawn() {
  current = next;
  next = pendingSpecial ? randomSpecial() : randomPiece();
  pendingSpecial = false;
  if (collide(current.shape, current.x, current.y)) {
    endGame();
  }
  drawNext();
}

function updateHUD() {
  scoreEl.textContent = score.toLocaleString();
  linesEl.textContent = lines;
  levelEl.textContent = level;
}

function drawBlock(context, x, y, colorIndex, size, alpha) {
  if (!colorIndex) return;
  const color = COLORS[colorIndex];
  context.globalAlpha = alpha ?? 1;
  if (colorIndex === WILD) {
    const g = context.createLinearGradient(x * size, y * size, (x + 1) * size, (y + 1) * size);
    ['#ff5252', '#ffd740', '#69f0ae', '#40c4ff', '#e040fb'].forEach((c, i, a) => g.addColorStop(i / (a.length - 1), c));
    context.fillStyle = g;
  } else {
    context.fillStyle = color;
  }
  context.fillRect(x * size + 1, y * size + 1, size - 2, size - 2);
  // highlight
  context.fillStyle = 'rgba(255,255,255,0.12)';
  context.fillRect(x * size + 1, y * size + 1, size - 2, 4);
  if (SPECIAL_ICONS[colorIndex]) {
    context.font = `${Math.floor(size * 0.65)}px sans-serif`;
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillStyle = '#000';
    context.fillText(SPECIAL_ICONS[colorIndex], x * size + size / 2, y * size + size / 2 + 1);
  }
  context.globalAlpha = 1;
}

function drawGrid() {
  ctx.strokeStyle = gridColor;
  ctx.lineWidth = 0.5;
  for (let c = 1; c < COLS; c++) {
    ctx.beginPath();
    ctx.moveTo(c * BLOCK, 0);
    ctx.lineTo(c * BLOCK, ROWS * BLOCK);
    ctx.stroke();
  }
  for (let r = 1; r < ROWS; r++) {
    ctx.beginPath();
    ctx.moveTo(0, r * BLOCK);
    ctx.lineTo(COLS * BLOCK, r * BLOCK);
    ctx.stroke();
  }
}

function draw() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.save();
  if (shake > 0) {
    const mag = Math.min(6, 2 + shake / 80);
    ctx.translate((Math.random() - 0.5) * 2 * mag, (Math.random() - 0.5) * 2 * mag);
  }
  drawGrid();

  // board
  for (let r = 0; r < ROWS; r++)
    for (let c = 0; c < COLS; c++)
      drawBlock(ctx, c, r, board[r][c], BLOCK);

  // ghost
  const gy = ghostY();
  for (let r = 0; r < current.shape.length; r++)
    for (let c = 0; c < current.shape[r].length; c++)
      if (current.shape[r][c])
        drawBlock(ctx, current.x + c, gy + r, current.shape[r][c], BLOCK, 0.2);

  // current piece
  for (let r = 0; r < current.shape.length; r++)
    for (let c = 0; c < current.shape[r].length; c++)
      drawBlock(ctx, current.x + c, current.y + r, current.shape[r][c], BLOCK);

  // overlays de efectos
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  if (freezeLeft > 0) {
    ctx.fillStyle = 'rgba(79,195,247,0.18)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#4fc3f7';
    ctx.font = 'bold 18px sans-serif';
    ctx.fillText(`❄ ${(freezeLeft / 1000).toFixed(1)}s`, canvas.width / 2, 18);
  }
  if (flash > 0) {
    ctx.fillStyle = `rgba(255,255,255,${0.5 * Math.min(1, flash / 250)})`;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  ctx.strokeStyle = '#000';
  ctx.lineWidth = 4;
  ctx.font = 'bold 26px sans-serif';
  popups.forEach((p, i) => {
    const y = canvas.height / 2 - 20 - i * 36 - (1 - p.life / p.max) * 30;
    ctx.globalAlpha = Math.min(1, p.life / 400);
    ctx.fillStyle = p.color;
    ctx.strokeText(p.text, canvas.width / 2, y);
    ctx.fillText(p.text, canvas.width / 2, y);
  });
  ctx.globalAlpha = 1;
  ctx.lineWidth = 0.5;
  ctx.restore();
}

function drawNext() {
  const NB = 30;
  nextCtx.clearRect(0, 0, nextCanvas.width, nextCanvas.height);
  const shape = next.shape;
  const offX = Math.floor((4 - shape[0].length) / 2);
  const offY = Math.floor((4 - shape.length) / 2);
  for (let r = 0; r < shape.length; r++)
    for (let c = 0; c < shape[r].length; c++)
      drawBlock(nextCtx, offX + c, offY + r, shape[r][c], NB);
}

function endGame() {
  gameOver = true;
  cancelAnimationFrame(animId);
  overlayTitle.textContent = 'GAME OVER';
  overlayScore.textContent = `Puntuación: ${score.toLocaleString()}`;
  overlay.classList.remove('hidden');
}

function togglePause() {
  if (gameOver) return;
  paused = !paused;
  if (!paused) {
    lastTime = performance.now();
    loop(lastTime);
  } else {
    cancelAnimationFrame(animId);
    overlayTitle.textContent = 'PAUSA';
    overlayScore.textContent = '';
    overlay.classList.remove('hidden');
  }
}

function loop(ts) {
  const dt = ts - lastTime;
  lastTime = ts;
  popups.forEach(p => { p.life -= dt; });
  popups = popups.filter(p => p.life > 0);
  if (shake > 0) shake -= dt;
  if (flash > 0) flash -= dt;
  if (freezeLeft > 0) freezeLeft = Math.max(0, freezeLeft - dt);
  else dropAccum += dt; // congelado: la gravedad no avanza
  if (dropAccum >= dropInterval) {
    dropAccum = 0;
    if (!collide(current.shape, current.x, current.y + 1)) {
      current.y++;
      lastMoveRotate = false;
    } else {
      lockPiece();
    }
  }
  draw();
  if (gameOver) return; // endGame() durante este tick: cancelAnimationFrame no cancela el frame en curso
  animId = requestAnimationFrame(loop);
}

function applyTheme(name) {
  theme = name;
  document.documentElement.dataset.theme = theme;
  gridColor = getComputedStyle(document.documentElement).getPropertyValue('--grid').trim();
  const light = theme === 'light';
  themeBtn.textContent = light ? '🌙 Modo oscuro' : '☀️ Modo claro';
  themeBtn.setAttribute('aria-pressed', String(light));
  themeBtn.setAttribute('aria-label', light ? 'Cambiar a modo oscuro' : 'Cambiar a modo claro');
  // En pausa o game over el loop está cancelado: repintar manualmente
  if (current) { draw(); drawNext(); }
}

function init() {
  board = createBoard();
  score = 0;
  lines = 0;
  level = 1;
  paused = false;
  gameOver = false;
  dropInterval = 1000;
  dropAccum = 0;
  pendingSpecial = false;
  nextSpecialAt = SPECIAL_EVERY;
  freezeLeft = 0;
  b2b = false;
  lastMoveRotate = false;
  popups = [];
  shake = 0;
  flash = 0;
  setCombo(0);
  lastTime = performance.now();
  next = randomPiece();
  spawn();
  updateHUD();
  overlay.classList.add('hidden');
  cancelAnimationFrame(animId);
  animId = requestAnimationFrame(loop);
}

document.addEventListener('keydown', e => {
  ensureAudio();
  if (e.code === 'KeyM') { muted = !muted; return; }
  if (e.code === 'KeyP') { togglePause(); return; }
  if (paused || gameOver) return;
  switch (e.code) {
    case 'ArrowLeft':
      if (!collide(current.shape, current.x - 1, current.y)) { current.x--; lastMoveRotate = false; }
      break;
    case 'ArrowRight':
      if (!collide(current.shape, current.x + 1, current.y)) { current.x++; lastMoveRotate = false; }
      break;
    case 'ArrowDown':
      softDrop();
      break;
    case 'ArrowUp':
    case 'KeyX':
      tryRotate();
      break;
    case 'Space':
      e.preventDefault();
      hardDrop();
      break;
  }
  updateHUD();
});

restartBtn.addEventListener('click', init);
themeBtn.addEventListener('click', () => {
  applyTheme(theme === 'dark' ? 'light' : 'dark');
  themeBtn.blur(); // evita que Espacio vuelva a activar el botón
});

applyTheme('dark');
init();
