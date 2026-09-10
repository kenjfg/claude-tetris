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
  '#7986cb', // J - indigo
  '#ffb74d', // L - orange
];

const PIECES = [
  null,
  [[0,0,0,0],[1,1,1,1],[0,0,0,0],[0,0,0,0]], // I
  [[2,2],[2,2]],                               // O
  [[0,3,0],[3,3,3],[0,0,0]],                  // T
  [[0,4,4],[4,4,0],[0,0,0]],                  // S
  [[5,5,0],[0,5,5],[0,0,0]],                  // Z
  [[6,0,0],[6,6,6],[0,0,0]],                  // J
  [[0,0,7],[7,7,7],[0,0,0]],                  // L
];

// ---- Temas visuales / skins ----
// Cada skin aporta: paleta 1-7 paralela a COLORS (índice 0 = null),
// color de fondo del tablero/next (bg: null usa el fondo del CSS),
// color de la cuadrícula (grid: null la omite) y un estilo de bloque.
const SKINS = {
  retro: {
    palette: COLORS,
    bg: null,
    grid: '#22222e',
    style: 'flat',
  },
  neon: {
    palette: [
      null,
      '#00eaff', // I
      '#ffe600', // O
      '#ff3cf0', // T
      '#39ff14', // S
      '#ff2d55', // Z
      '#4d5dff', // J
      '#ff9d00', // L
    ],
    bg: '#000000',
    grid: null,
    style: 'glow',
  },
  pastel: {
    palette: [
      null,
      '#9fd6de', // I
      '#f2e0a8', // O
      '#c9b6dc', // T
      '#b4dcb8', // S
      '#e6b4b4', // Z
      '#b6bee0', // J
      '#e8cba6', // L
    ],
    bg: '#f4f1ea',
    grid: '#e4ddce',
    style: 'rounded',
  },
  pixel: {
    palette: [
      null,
      '#37b7c4', // I
      '#e0b23c', // O
      '#9c55c0', // T
      '#57b061', // S
      '#cd4b4b', // Z
      '#4f5ec0', // J
      '#d68a3a', // L
    ],
    bg: '#12121a',
    grid: '#1e1e2a',
    style: 'pixel',
  },
};

const SKIN_KEY = 'tetris.skin';
let skinName = 'retro';

function activeSkin() {
  return SKINS[skinName] || SKINS.retro;
}

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
const themeToggleBtn = document.getElementById('theme-toggle');
const skinSelect = document.getElementById('skin-select');

let board, current, next, score, lines, level, paused, gameOver, lastTime, dropAccum, dropInterval, animId;
let lightMode = localStorage.getItem('tetris-theme') === 'light';

function createBoard() {
  return Array.from({ length: ROWS }, () => new Array(COLS).fill(0));
}

function randomPiece() {
  const type = Math.floor(Math.random() * 7) + 1;
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
      board.splice(r, 1);
      board.unshift(new Array(COLS).fill(0));
      cleared++;
      r++;
    }
  }
  if (cleared) {
    lines += cleared;
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
  merge();
  clearLines();
  spawn();
}

function spawn() {
  current = next;
  next = randomPiece();
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

// Rectángulo con esquinas redondeadas (sin depender de ctx.roundRect).
function roundRectPath(context, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  context.beginPath();
  context.moveTo(x + rr, y);
  context.arcTo(x + w, y, x + w, y + h, rr);
  context.arcTo(x + w, y + h, x, y + h, rr);
  context.arcTo(x, y + h, x, y, rr);
  context.arcTo(x, y, x + w, y, rr);
  context.closePath();
}

function drawBlock(context, x, y, colorIndex, size, alpha) {
  if (!colorIndex) return;
  const skin = activeSkin();
  const color = skin.palette[colorIndex];
  const px = x * size + 1;
  const py = y * size + 1;
  const s = size - 2;
  context.globalAlpha = alpha ?? 1;

  if (skin.style === 'glow') {
    // Neon: resplandor por bloque; hay que restaurar shadowBlur despues
    context.shadowBlur = 14;
    context.shadowColor = color;
    context.fillStyle = color;
    context.fillRect(px, py, s, s);
    context.shadowBlur = 0;
    context.shadowColor = 'transparent';
    context.fillStyle = 'rgba(255,255,255,0.18)';
    context.fillRect(px, py, s, 4);
  } else if (skin.style === 'rounded') {
    // Pastel: bloques con esquinas redondeadas simuladas
    context.fillStyle = color;
    roundRectPath(context, px, py, s, s, Math.max(3, size * 0.22));
    context.fill();
    context.fillStyle = 'rgba(255,255,255,0.28)';
    roundRectPath(context, px, py, s, Math.max(4, s * 0.34), Math.max(3, size * 0.22));
    context.fill();
  } else if (skin.style === 'pixel') {
    // Pixel art: color base mas una pequena textura/dither
    context.fillStyle = color;
    context.fillRect(px, py, s, s);
    const u = s / 4;
    context.fillStyle = 'rgba(255,255,255,0.22)';
    context.fillRect(px, py, u, u);
    context.fillRect(px + 2 * u, py + u, u, u);
    context.fillStyle = 'rgba(0,0,0,0.30)';
    context.fillRect(px + 3 * u, py + 3 * u, u, u);
    context.fillRect(px + u, py + 2 * u, u, u);
    context.fillRect(px + 2 * u, py + 3 * u, u, u);
  } else {
    // Retro (flat): comportamiento original
    context.fillStyle = color;
    context.fillRect(px, py, s, s);
    context.fillStyle = 'rgba(255,255,255,0.12)';
    context.fillRect(px, py, s, 4);
  }

  context.globalAlpha = 1;
}

function drawGrid() {
  const skin = activeSkin();
  if (skin.grid === null) return; // skin sin cuadrícula
  ctx.strokeStyle = skinName === 'retro' && lightMode ? '#dcdeee' : skin.grid;
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
  const bg = activeSkin().bg;
  if (bg) {
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  } else {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
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
}

function drawNext() {
  const NB = 30;
  const bg = activeSkin().bg;
  if (bg) {
    nextCtx.fillStyle = bg;
    nextCtx.fillRect(0, 0, nextCanvas.width, nextCanvas.height);
  } else {
    nextCtx.clearRect(0, 0, nextCanvas.width, nextCanvas.height);
  }
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
  dropAccum += dt;
  if (dropAccum >= dropInterval) {
    dropAccum = 0;
    if (!collide(current.shape, current.x, current.y + 1)) {
      current.y++;
    } else {
      lockPiece();
    }
  }
  draw();
  animId = requestAnimationFrame(loop);
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
  lastTime = performance.now();
  next = randomPiece();
  spawn();
  updateHUD();
  overlay.classList.add('hidden');
  cancelAnimationFrame(animId);
  animId = requestAnimationFrame(loop);
}

document.addEventListener('keydown', e => {
  // No capturar el teclado cuando se está usando un control del panel (p. ej. el selector de tema)
  if (e.target instanceof HTMLSelectElement) return;
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

function applyTheme() {
  document.body.classList.toggle('light-mode', lightMode);
  themeToggleBtn.textContent = lightMode ? '🌙' : '☀️';
  themeToggleBtn.setAttribute('aria-label', lightMode ? 'Cambiar a modo oscuro' : 'Cambiar a modo claro');
}

function toggleTheme() {
  lightMode = !lightMode;
  localStorage.setItem('tetris-theme', lightMode ? 'light' : 'dark');
  applyTheme();
  if (current) draw();
}

// ---- Skins: preferencia persistente (fuera de init) ----
function applySkin(repaint) {
  document.body.setAttribute('data-skin', skinName);
  if (skinSelect) skinSelect.value = skinName;
  if (repaint && current) {
    draw();
    drawNext();
  }
}

function setSkin(name) {
  if (!SKINS[name]) return;
  skinName = name;
  try {
    localStorage.setItem(SKIN_KEY, name);
  } catch (e) {
    // almacenamiento no disponible: se aplica solo en esta sesión
  }
  applySkin(true);
}

function loadSkin() {
  let stored = null;
  try {
    stored = localStorage.getItem(SKIN_KEY);
  } catch (e) {
    stored = null;
  }
  skinName = stored && SKINS[stored] ? stored : 'retro';
  applySkin(false);
}

if (skinSelect) {
  skinSelect.addEventListener('change', () => setSkin(skinSelect.value));
}

themeToggleBtn.addEventListener('click', toggleTheme);
restartBtn.addEventListener('click', init);

loadSkin();
applyTheme();
init();
