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
let pendingSpecial, nextSpecialAt, freezeLeft, effectMsg, effectMsgLeft;

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
  effectMsg = SPECIAL_NAMES[type];
  effectMsgLeft = EFFECT_MSG_MS;
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
    score += (LINE_SCORES[cleared] || 0) * level;
    level = Math.floor(lines / 10) + 1;
    dropInterval = Math.max(100, 1000 - (level - 1) * 90);
    updateHUD();
  }
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
    score += 1;
    updateHUD();
  } else {
    lockPiece();
  }
}

function lockPiece() {
  if (current.special) applySpecial();
  else merge();
  clearLines();
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
  if (effectMsgLeft > 0) {
    ctx.globalAlpha = Math.min(1, effectMsgLeft / 400);
    ctx.fillStyle = '#fff';
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 4;
    ctx.font = 'bold 32px sans-serif';
    ctx.strokeText(effectMsg, canvas.width / 2, canvas.height / 2);
    ctx.fillText(effectMsg, canvas.width / 2, canvas.height / 2);
    ctx.globalAlpha = 1;
    ctx.lineWidth = 0.5;
  }
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
  if (effectMsgLeft > 0) effectMsgLeft -= dt;
  if (freezeLeft > 0) freezeLeft = Math.max(0, freezeLeft - dt);
  else dropAccum += dt; // congelado: la gravedad no avanza
  if (dropAccum >= dropInterval) {
    dropAccum = 0;
    if (!collide(current.shape, current.x, current.y + 1)) {
      current.y++;
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
  effectMsg = '';
  effectMsgLeft = 0;
  lastTime = performance.now();
  next = randomPiece();
  spawn();
  updateHUD();
  overlay.classList.add('hidden');
  cancelAnimationFrame(animId);
  animId = requestAnimationFrame(loop);
}

document.addEventListener('keydown', e => {
  if (e.code === 'KeyP') { togglePause(); return; }
  if (paused || gameOver) return;
  switch (e.code) {
    case 'ArrowLeft':
      if (!collide(current.shape, current.x - 1, current.y)) current.x--;
      break;
    case 'ArrowRight':
      if (!collide(current.shape, current.x + 1, current.y)) current.x++;
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
