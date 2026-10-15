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

// Modo desafío: cada nivel tiene un objetivo (lines / surviveMs) y reglas propias
const CHALLENGES = [
  { name: '40 líneas en 2:00', desc: 'Limpia 40 líneas en 2:00', lines: 40, timeLimit: 120000 },
  { name: 'Supervivencia', desc: 'Sobrevive 1:30 (basura cada 10s)', surviveMs: 90000, garbageEvery: 10000 },
  { name: 'Bloques fijos', desc: 'Limpia 15 líneas', lines: 15, prefill: 8 },
  { name: 'Piezas invisibles', desc: 'Limpia 8 líneas', lines: 8, hideOnLand: true },
  { name: 'Rotación inversa', desc: 'Limpia 25 líneas (rotación invertida desde nivel 7)', lines: 25, startLevel: 6, reverseAt: 7 },
];

// Habilidades cargables: la barra se llena al limpiar líneas
const ENERGY_MAX = 100;
const ENERGY_PER_LINE = [0, 20, 45, 70, 100]; // por nº de líneas de un mismo clear
const PREVIEW_MS = 30000;
const SLOW_MS = 10000;
const SLOW_FACTOR = 0.4;
const QUEUE_SIZE = 5;
const ABILITIES = [
  { icon: '👁️', name: 'Ver siguientes 5 piezas' },
  { icon: '🔄', name: 'Intercambiar pieza actual' },
  { icon: '🐢', name: 'Ralentizar tiempo 10s' },
  { icon: '↩️', name: 'Deshacer última colocación' },
];
const PIECE_NAMES = ['', 'I', 'O', 'T', 'S', 'Z', 'J', 'L', 'Tuerca'];

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
const modeSel = document.getElementById('mode');
const previewCanvas = document.getElementById('preview-canvas');
const previewCtx = previewCanvas.getContext('2d');
const holdCanvas = document.getElementById('hold-canvas');
const holdCtx = holdCanvas.getContext('2d');
const energyEl = document.getElementById('energy');
const energyFill = document.getElementById('energy-fill');
const abilityEl = document.getElementById('ability-menu');
const abilityTitle = document.getElementById('ability-title');
const abilityList = document.getElementById('ability-list');
const abilityHint = document.getElementById('ability-hint');
CHALLENGES.forEach((ch, i) => modeSel.add(new Option(`Desafío ${i + 1}: ${ch.name}`, String(i))));

let theme = 'dark';
let gridColor = '#22222e';

let board, current, score, lines, level, paused, gameOver, lastTime, dropAccum, dropInterval, animId;
let challenge, elapsed, garbageAccum, hid;
let energy, queue, previewLeft, slowLeft, undoSnap, held, holdUsed, abilityMenu;
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

function garbageRow() {
  const row = new Array(COLS).fill(8);
  row[Math.floor(Math.random() * COLS)] = 0;
  return row;
}

function prefillBoard(rows) {
  for (let r = ROWS - rows; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) board[r][c] = Math.random() < 0.7 ? 1 + Math.floor(Math.random() * 7) : 0;
    board[r][Math.floor(Math.random() * COLS)] = 0; // nunca una línea completa
  }
}

function addGarbage() {
  const overflow = board[0].some(v => v !== 0);
  undoSnap = null; // el tablero cambió: no se puede deshacer
  board.shift(); hid.shift();
  board.push(garbageRow());
  hid.push(new Array(COLS).fill(false));
  showPopup('¡BASURA!', '#e57373');
  tone(150, 0.2, 'sawtooth');
  if (overflow) { endGame(); return; }
  while (current.y >= 0 && collide(current.shape, current.x, current.y)) current.y--;
  if (current.y < 0) endGame();
}

function winChallenge() {
  gameOver = true;
  cancelAnimationFrame(animId);
  overlayTitle.textContent = '¡DESAFÍO SUPERADO!';
  overlayScore.textContent = `Puntuación: ${score.toLocaleString()}`;
  overlay.classList.remove('hidden');
  [1, 1.25, 1.5, 2].forEach((m, i) => tone(523 * m, 0.2, 'triangle', i * 0.1, 0.08));
}

function updateObjective() {
  const el = document.getElementById('objective');
  if (!challenge) { el.textContent = 'Modo clásico'; return; }
  const fmt = ms => { const t = Math.ceil(Math.max(0, ms) / 1000); return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`; };
  let txt = challenge.desc;
  if (challenge.lines) txt += `\n${Math.min(lines, challenge.lines)}/${challenge.lines} líneas`;
  if (challenge.timeLimit) txt += ` · ⏱ ${fmt(challenge.timeLimit - elapsed)}`;
  if (challenge.surviveMs) txt += `\n⏱ ${fmt(challenge.surviveMs - elapsed)}`;
  if (challenge.reverseAt && level >= challenge.reverseAt) txt += '\n🔄 ROTACIÓN INVERSA';
  el.textContent = txt;
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

function makePiece(type) {
  const shape = PIECES[type].map(row => [...row]);
  return { type, shape, x: Math.floor(COLS / 2) - Math.floor(shape[0].length / 2), y: 0 };
}

function randomPiece() {
  return makePiece(Math.floor(Math.random() * (PIECES.length - 1)) + 1);
}

// Tipos >= 10 son especiales (1×1); el resto sale de PIECES
function pieceOfType(type) {
  return type >= SPECIAL.BOMB
    ? { type, shape: [[type]], x: Math.floor(COLS / 2), y: 0, special: true }
    : makePiece(type);
}

function clonePiece(p) {
  return { ...p, shape: p.shape.map(row => [...row]) };
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

function rotateCCW(shape) {
  return rotateCW(rotateCW(rotateCW(shape)));
}

function tryRotate() {
  const reverse = challenge && challenge.reverseAt && level >= challenge.reverseAt;
  const rotated = reverse ? rotateCCW(current.shape) : rotateCW(current.shape);
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
      if (current.shape[r][c]) {
        board[current.y + r][current.x + c] = current.shape[r][c];
        hid[current.y + r][current.x + c] = !!(challenge && challenge.hideOnLand);
      }
}

function clearLines() {
  let cleared = 0;
  for (let r = ROWS - 1; r >= 0; r--) {
    if (board[r].every(v => v !== 0)) {
      const wilds = board[r].filter(v => v === WILD).length;
      score += wilds * WILD_BONUS * level;
      board.splice(r, 1);
      board.unshift(new Array(COLS).fill(0));
      hid.splice(r, 1);
      hid.unshift(new Array(COLS).fill(false));
      cleared++;
      r++;
    }
  }
  if (cleared) {
    lines += cleared;
    while (lines >= nextSpecialAt) {
      if (!challenge) pendingSpecial = true; // sin especiales en desafíos
      nextSpecialAt += SPECIAL_EVERY;
    }
    level = runBaseLevel + Math.floor(lines / 10);
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
  undoSnap = {
    board: board.map(row => [...row]),
    hid: hid.map(row => [...row]),
    score, lines, level, dropInterval, combo, b2b, nextSpecialAt, pendingSpecial, holdUsed,
    piece: clonePiece(current),
    queue: queue.map(clonePiece),
  };
  const tspin = !current.special && isTSpin();
  if (current.special) applySpecial();
  else merge();
  const cleared = clearLines();
  scoreClear(cleared, tspin);
  if (cleared) addEnergy(ENERGY_PER_LINE[Math.min(cleared, 4)]);
  lastMoveRotate = false;
  if (challenge?.lines && lines >= challenge.lines) { winChallenge(); return; }
  holdUsed = false;
  spawn();
  drawHold();
}

function spawn() {
  current = queue.shift();
  queue.push(pendingSpecial ? randomSpecial() : randomPiece());
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
  energyFill.style.width = `${energy}%`;
  energyEl.classList.toggle('full', energy >= ENERGY_MAX);
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
      if (!hid[r][c]) drawBlock(ctx, c, r, board[r][c], BLOCK);

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
  if (slowLeft > 0) {
    ctx.fillStyle = 'rgba(149,117,205,0.15)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#b39ddb';
    ctx.font = 'bold 18px sans-serif';
    ctx.fillText(`🐢 ${(slowLeft / 1000).toFixed(1)}s`, canvas.width / 2, freezeLeft > 0 ? 42 : 18);
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
  drawShapeIn(nextCtx, queue[0].shape, 0, NB);
  drawPreview();
}

// Dibuja una forma centrada en la celda de 4×4 número `slot` de un canvas horizontal
function drawShapeIn(context, shape, slot, size) {
  const offX = slot * 4 + Math.floor((4 - shape[0].length) / 2);
  const offY = Math.floor((4 - shape.length) / 2);
  for (let r = 0; r < shape.length; r++)
    for (let c = 0; c < shape[r].length; c++)
      drawBlock(context, offX + c, offY + r, shape[r][c], size);
}

function drawPreview() {
  previewCanvas.classList.toggle('hidden', previewLeft <= 0);
  previewCtx.clearRect(0, 0, previewCanvas.width, previewCanvas.height);
  if (previewLeft <= 0) return;
  queue.slice(0, QUEUE_SIZE).forEach((p, i) => drawShapeIn(previewCtx, p.shape, i, 8));
}

function drawHold() {
  holdCanvas.classList.toggle('locked', !!holdUsed);
  holdCtx.clearRect(0, 0, holdCanvas.width, holdCanvas.height);
  if (held !== null) drawShapeIn(holdCtx, pieceOfType(held).shape, 0, 30);
}

// ---- Habilidades ----
function addEnergy(n) {
  const wasFull = energy >= ENERGY_MAX;
  energy = Math.min(ENERGY_MAX, energy + n);
  if (!wasFull && energy >= ENERGY_MAX) showPopup('¡ENERGÍA LLENA! (E)', '#69f0ae');
  updateHUD();
}

function setHint(text) {
  abilityHint.textContent = text;
}

function renderAbilityMenu() {
  abilityList.replaceChildren();
  const swap = abilityMenu === 'swap';
  abilityTitle.textContent = swap ? 'ELEGIR PIEZA' : 'HABILIDAD';
  setHint(swap ? 'Teclas 1–8 · Esc volver' : `Teclas 1–${ABILITIES.length} · Esc cancelar`);
  const items = swap
    ? PIECE_NAMES.slice(1).map(name => ({ name }))
    : ABILITIES.map((a, i) => ({ ...a, disabled: i === 3 && !undoSnap }));
  items.forEach((it, i) => {
    const li = document.createElement('li');
    li.textContent = `${i + 1}. ${it.icon ? it.icon + ' ' : ''}${it.name}`;
    if (it.disabled) li.classList.add('disabled');
    li.addEventListener('click', () => chooseAbility(i));
    abilityList.appendChild(li);
  });
}

function openAbilityMenu() {
  abilityMenu = 'main';
  cancelAnimationFrame(animId);
  renderAbilityMenu();
  abilityEl.classList.remove('hidden');
}

function closeAbilityMenu() {
  abilityMenu = null;
  abilityEl.classList.add('hidden');
  lastTime = performance.now();
  loop(lastTime);
}

function finishAbility(label) {
  energy = 0;
  updateHUD();
  showPopup(label, '#69f0ae');
  tone(523, 0.1, 'triangle');
  tone(784, 0.15, 'triangle', 0.08);
  closeAbilityMenu();
}

function chooseAbility(i) {
  if (abilityMenu === 'main' && i < ABILITIES.length) useAbility(i);
  else if (abilityMenu === 'swap' && i < PIECE_NAMES.length - 1) {
    if (swapPiece(i + 1)) finishAbility('INTERCAMBIO');
    else setHint('No cabe esa pieza aquí');
  }
}

function useAbility(i) {
  switch (i) {
    case 0:
      previewLeft = PREVIEW_MS;
      drawPreview();
      break;
    case 1:
      abilityMenu = 'swap';
      renderAbilityMenu();
      return;
    case 2:
      slowLeft = SLOW_MS;
      break;
    case 3:
      if (!undoPlacement()) { setHint('Nada que deshacer'); return; }
      break;
  }
  finishAbility(ABILITIES[i].name.toUpperCase());
}

function swapPiece(type) {
  const p = makePiece(type);
  for (const kick of [0, -1, 1, -2, 2]) {
    if (!collide(p.shape, current.x + kick, current.y)) {
      p.x = current.x + kick;
      p.y = current.y;
      current = p;
      lastMoveRotate = false;
      return true;
    }
  }
  if (collide(p.shape, p.x, 0)) return false;
  current = p;
  lastMoveRotate = false;
  return true;
}

function undoPlacement() {
  const s = undoSnap;
  if (!s) return false;
  board = s.board;
  hid = s.hid;
  score = s.score; lines = s.lines; level = s.level; dropInterval = s.dropInterval;
  b2b = s.b2b; nextSpecialAt = s.nextSpecialAt; pendingSpecial = s.pendingSpecial;
  holdUsed = s.holdUsed;
  setCombo(s.combo);
  queue = s.queue;
  current = pieceOfType(s.piece.type); // vuelve a la posición de spawn
  dropAccum = 0;
  lastMoveRotate = false;
  undoSnap = null;
  drawNext();
  drawHold();
  updateHUD();
  updateObjective();
  return true;
}

function holdPiece() {
  if (holdUsed) { tone(120, 0.08); return; } // ya usado en esta pieza
  const type = current.type;
  undoSnap = null; // la cola cambia: deshacer duplicaría piezas
  if (held === null) {
    held = type;
    spawn();
  } else {
    current = pieceOfType(held);
    held = type;
    if (collide(current.shape, current.x, current.y)) endGame();
  }
  holdUsed = true; // se libera en lockPiece(), no en spawn() (que holdPiece también llama)
  lastMoveRotate = false;
  tone(330, 0.08, 'triangle');
  drawHold();
}

function endGame() {
  if (gameOver) return;
  gameOver = true;
  cancelAnimationFrame(animId);
  overlayTitle.textContent = 'GAME OVER';
  overlayScore.textContent = `Puntuación: ${score.toLocaleString()}`;
  overlay.classList.remove('hidden');
}

// ---- Menú de pausa ----
const pauseMenuEl = document.getElementById('pause-menu');
const pauseControlsEl = document.getElementById('pause-controls');
const pauseItems = [...pauseMenuEl.querySelectorAll('button, select')];
const startLevelSel = document.getElementById('start-level');
let startLevel = 1;
let runBaseLevel = 1; // nivel base de la partida en curso (fijado en init)
const gameKeysDown = new Set(); // teclas pulsadas dentro del juego (para ignorar repeticiones de teclas mantenidas al reanudar)

try {
  const saved = Number(localStorage.getItem('tetris-start-level'));
  if (saved >= 1 && saved <= 10) startLevel = Math.floor(saved);
} catch (_) { /* almacenamiento no disponible */ }
startLevelSel.value = String(startLevel);

function hidePauseMenu() {
  pauseMenuEl.classList.add('hidden');
  pauseControlsEl.classList.add('hidden');
  if (document.activeElement && pauseMenuEl.contains(document.activeElement)) document.activeElement.blur();
}

function togglePause() {
  if (gameOver || abilityMenu) return;
  paused = !paused;
  if (!paused) {
    hidePauseMenu();
    gameKeysDown.clear();
    lastTime = performance.now();
    loop(lastTime);
  } else {
    cancelAnimationFrame(animId);
    gameKeysDown.clear();
    pauseMenuEl.classList.remove('hidden');
    pauseItems[0].focus();
  }
}

document.getElementById('resume-btn').addEventListener('click', () => { if (paused) togglePause(); });
document.getElementById('pause-restart-btn').addEventListener('click', init);
document.getElementById('controls-btn').addEventListener('click', e => {
  const open = pauseControlsEl.classList.toggle('hidden') === false;
  e.currentTarget.setAttribute('aria-expanded', String(open));
});
startLevelSel.addEventListener('change', () => {
  startLevel = Number(startLevelSel.value);
  try { localStorage.setItem('tetris-start-level', String(startLevel)); } catch (_) { /* ignorar */ }
});

// Navegación con teclado dentro del menú; devuelve true si consumió la tecla
function pauseMenuKey(e) {
  if (e.code === 'ArrowUp' || e.code === 'ArrowDown') {
    if (document.activeElement === startLevelSel) return true; // el select usa las flechas
    e.preventDefault();
    if (e.repeat) return true;
    const i = pauseItems.indexOf(document.activeElement);
    const d = e.code === 'ArrowDown' ? 1 : -1;
    pauseItems[i < 0 ? (d > 0 ? 0 : pauseItems.length - 1) : (i + d + pauseItems.length) % pauseItems.length].focus();
  } else if (e.code === 'Space' && document.activeElement?.tagName === 'BUTTON') {
    e.preventDefault(); // Espacio no activa botones; se usa Enter
  }
  return true;
}

function loop(ts) {
  const dt = ts - lastTime;
  lastTime = ts;
  popups.forEach(p => { p.life -= dt; });
  popups = popups.filter(p => p.life > 0);
  if (challenge) {
    elapsed += dt;
    if (challenge.garbageEvery) {
      garbageAccum += dt;
      if (garbageAccum >= challenge.garbageEvery) { garbageAccum = 0; addGarbage(); }
    }
    if (!gameOver && challenge.timeLimit && elapsed >= challenge.timeLimit) {
      endGame();
      overlayTitle.textContent = '¡TIEMPO AGOTADO!';
    } else if (!gameOver && challenge.surviveMs && elapsed >= challenge.surviveMs) {
      winChallenge();
    }
    updateObjective();
    if (gameOver) { draw(); return; }
  }
  if (shake > 0) shake -= dt;
  if (flash > 0) flash -= dt;
  if (freezeLeft > 0) freezeLeft = Math.max(0, freezeLeft - dt);
  else dropAccum += dt * (slowLeft > 0 ? SLOW_FACTOR : 1); // congelado: la gravedad no avanza
  if (slowLeft > 0) slowLeft = Math.max(0, slowLeft - dt);
  if (previewLeft > 0) {
    previewLeft = Math.max(0, previewLeft - dt);
    if (previewLeft === 0) drawPreview();
  }
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
  if (current) { draw(); drawNext(); drawHold(); }
}

function init() {
  const mode = modeSel.value;
  challenge = mode === 'classic' ? null : CHALLENGES[Number(mode)];
  elapsed = 0;
  garbageAccum = 0;
  board = createBoard();
  hid = createBoard().map(row => row.map(() => false));
  if (challenge?.prefill) prefillBoard(challenge.prefill);
  score = 0;
  lines = 0;
  runBaseLevel = challenge?.startLevel ?? startLevel;
  level = runBaseLevel;
  paused = false;
  hidePauseMenu();
  gameOver = false;
  dropInterval = Math.max(100, 1000 - (level - 1) * 90);
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
  energy = 0;
  previewLeft = 0;
  slowLeft = 0;
  undoSnap = null;
  held = null;
  holdUsed = false;
  abilityMenu = null;
  abilityEl.classList.add('hidden');
  queue = Array.from({ length: QUEUE_SIZE + 1 }, randomPiece); // +1: spawn() consume la primera
  spawn();
  drawHold();
  updateHUD();
  updateObjective();
  overlay.classList.add('hidden');
  cancelAnimationFrame(animId);
  animId = requestAnimationFrame(loop);
}

document.addEventListener('keydown', e => {
  ensureAudio();
  if (e.code === 'KeyM') { muted = !muted; return; }
  if (e.code === 'KeyP') { togglePause(); return; }
  if (paused && !gameOver && !abilityMenu && e.code !== 'Escape') { pauseMenuKey(e); return; }
  if (abilityMenu) {
    if (e.code === 'Escape') {
      if (abilityMenu === 'swap') { abilityMenu = 'main'; renderAbilityMenu(); }
      else closeAbilityMenu();
    } else {
      const m = /^Digit([1-9])$/.exec(e.code);
      if (m) chooseAbility(Number(m[1]) - 1);
    }
    return;
  }
  if (e.code === 'Escape') { togglePause(); return; }
  if (paused || gameOver) return;
  // Ignorar teclas mantenidas desde la pausa y las primeras pulsaciones tras reanudar
  if (e.repeat && !gameKeysDown.has(e.code)) return;
  gameKeysDown.add(e.code);
  if (e.code === 'KeyE') {
    if (energy >= ENERGY_MAX) openAbilityMenu();
    return;
  }
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
    case 'KeyC':
    case 'ShiftLeft':
    case 'ShiftRight':
      if (!e.repeat) holdPiece();
      break;
  }
  updateHUD();
});

document.addEventListener('keyup', e => {
  gameKeysDown.delete(e.code);
  if (paused && e.code === 'Space' && document.activeElement?.tagName === 'BUTTON') e.preventDefault(); // Espacio no activa botones
});
window.addEventListener('blur', () => gameKeysDown.clear());
restartBtn.addEventListener('click', init);
modeSel.addEventListener('change', () => { init(); modeSel.blur(); });
themeBtn.addEventListener('click', () => {
  applyTheme(theme === 'dark' ? 'light' : 'dark');
  themeBtn.blur(); // evita que Espacio vuelva a activar el botón
});

applyTheme('dark');
init();
