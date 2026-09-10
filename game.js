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
const startOverlay = document.getElementById('start-overlay');
const startRecords = document.getElementById('start-records');
const overlayRecords = document.getElementById('overlay-records');
const nameEntry = document.getElementById('name-entry');
const nameInput = document.getElementById('name-input');
const saveScoreBtn = document.getElementById('save-score-btn');
const playBtn = document.getElementById('play-btn');

let board, current, next, score, lines, level, paused, gameOver, lastTime, dropAccum, dropInterval, animId, combo, maxCombo;
let started = false;
let pendingRun = null;
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
    // Racha de combos: sube con cada bloqueo que limpia >=1 linea
    combo += 1;
    if (combo > maxCombo) maxCombo = combo;
    updateHUD();
  } else {
    // Bloqueo sin lineas: se corta la racha
    combo = 0;
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

/* ---- Tabla de records local (localStorage) ---- */
const RECORDS_KEY = 'tetris.records';
const MAX_RECORDS = 5;

// Devuelve siempre una estructura valida aunque el almacenamiento falle o este vacio
function loadRecords() {
  const empty = { top: [], bestCombo: 0, maxLines: 0 };
  try {
    const raw = localStorage.getItem(RECORDS_KEY);
    if (!raw) return empty;
    const data = JSON.parse(raw);
    const top = Array.isArray(data.top)
      ? data.top
          .filter(e => e && typeof e.score === 'number' && isFinite(e.score))
          .map(e => ({ name: String(e.name || 'Anónimo').slice(0, 12), score: Math.floor(e.score) }))
          .sort((a, b) => b.score - a.score)
          .slice(0, MAX_RECORDS)
      : [];
    return {
      top,
      bestCombo: typeof data.bestCombo === 'number' && data.bestCombo > 0 ? Math.floor(data.bestCombo) : 0,
      maxLines: typeof data.maxLines === 'number' && data.maxLines > 0 ? Math.floor(data.maxLines) : 0,
    };
  } catch (e) {
    return empty;
  }
}

function saveRecords(data) {
  try {
    localStorage.setItem(RECORDS_KEY, JSON.stringify(data));
  } catch (e) {
    /* almacenamiento no disponible: se ignora */
  }
}

function clearRecords() {
  try {
    localStorage.removeItem(RECORDS_KEY);
  } catch (e) {
    /* almacenamiento no disponible: se ignora */
  }
}

// true si la puntuacion entra en el top 5 actual
function qualifiesForTop(sc, top) {
  if (!sc || sc <= 0) return false;
  if (top.length < MAX_RECORDS) return true;
  return sc > top[top.length - 1].score;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

// Pinta la tabla de records dentro del contenedor indicado.
// runInfo: { highlightIndex } para resaltar la fila de la partida actual,
//          { missedPosition } para mostrar "quedaste en la posicion N".
function renderRecords(container, runInfo) {
  if (!container) return;
  const rec = loadRecords();
  let html = '<span class="label">RECORDS</span>';
  if (rec.top.length === 0) {
    html += '<p class="records-empty">Aún no hay records</p>';
  } else {
    html += '<ol class="records-list">';
    rec.top.forEach((e, i) => {
      const hl = runInfo && runInfo.highlightIndex === i ? ' highlight' : '';
      html += `<li class="record-row${hl}">` +
        `<span class="record-name">${escapeHtml(e.name)}</span>` +
        `<span class="record-score">${e.score.toLocaleString()}</span></li>`;
    });
    html += '</ol>';
  }
  if (runInfo && runInfo.missedPosition) {
    // Solo se guardan 5 records, asi que fuera del top la posicion exacta es >= 6
    html += `<p class="records-hint">Quedaste en la posición ${runInfo.missedPosition} o inferior</p>`;
  }
  html += '<div class="records-stats">' +
    `<span>Mejor combo: ${rec.bestCombo}</span>` +
    `<span>Líneas máximas: ${rec.maxLines}</span>` +
    '</div>';
  container.innerHTML = html;
}

// Inserta la puntuacion de la partida actual en el top y vuelve a pintar
function saveScore() {
  if (!pendingRun || !pendingRun.qualifies) return;
  const rec = loadRecords();
  const name = (nameInput.value.trim() || 'Anónimo').slice(0, 12);
  const entry = { name, score: pendingRun.score };
  rec.top.push(entry);
  rec.top.sort((a, b) => b.score - a.score);
  rec.top = rec.top.slice(0, MAX_RECORDS);
  saveRecords(rec);
  pendingRun.qualifies = false; // evita guardar dos veces
  nameEntry.classList.add('hidden');
  renderRecords(overlayRecords, { highlightIndex: rec.top.findIndex(e => e === entry) });
}

function resetRecordsAndRender() {
  clearRecords();
  renderRecords(startRecords, null);
  if (!overlay.classList.contains('hidden')) renderRecords(overlayRecords, null);
}

function drawBlock(context, x, y, colorIndex, size, alpha) {
  if (!colorIndex) return;
  const color = COLORS[colorIndex];
  context.globalAlpha = alpha ?? 1;
  context.fillStyle = color;
  context.fillRect(x * size + 1, y * size + 1, size - 2, size - 2);
  // highlight
  context.fillStyle = 'rgba(255,255,255,0.12)';
  context.fillRect(x * size + 1, y * size + 1, size - 2, 4);
  context.globalAlpha = 1;
}

function drawGrid() {
  ctx.strokeStyle = lightMode ? '#dcdeee' : '#22222e';
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
  if (gameOver) return; // idempotente: solo procesa el primer fin de partida
  gameOver = true;
  cancelAnimationFrame(animId);
  overlayTitle.textContent = 'GAME OVER';
  overlayScore.textContent = `Puntuación: ${score.toLocaleString()}`;

  // Actualiza mejor combo y lineas maximas de todos los tiempos
  const rec = loadRecords();
  let changed = false;
  if (maxCombo > rec.bestCombo) { rec.bestCombo = maxCombo; changed = true; }
  if (lines > rec.maxLines) { rec.maxLines = lines; changed = true; }
  if (changed) saveRecords(rec);

  pendingRun = { score, qualifies: qualifiesForTop(score, rec.top) };
  if (pendingRun.qualifies) {
    nameInput.value = '';
    nameEntry.classList.remove('hidden');
    renderRecords(overlayRecords, null);
    setTimeout(() => { try { nameInput.focus(); } catch (e) { /* ignora */ } }, 0);
  } else {
    nameEntry.classList.add('hidden');
    const missed = (score > 0 && rec.top.length >= MAX_RECORDS) ? MAX_RECORDS + 1 : 0;
    renderRecords(overlayRecords, { missedPosition: missed });
  }
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
  if (paused || gameOver) return; // no re-encolar frames tras pausa o fin de partida
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
  combo = 0;
  maxCombo = 0;
  started = true;
  pendingRun = null;
  lastTime = performance.now();
  next = randomPiece();
  spawn();
  updateHUD();
  nameEntry.classList.add('hidden');
  overlayRecords.innerHTML = '';
  overlay.classList.add('hidden');
  startOverlay.classList.add('hidden');
  cancelAnimationFrame(animId);
  animId = requestAnimationFrame(loop);
}

document.addEventListener('keydown', e => {
  if (!started) return;
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

themeToggleBtn.addEventListener('click', toggleTheme);
restartBtn.addEventListener('click', init);

playBtn.addEventListener('click', init);
saveScoreBtn.addEventListener('click', saveScore);
nameInput.addEventListener('keydown', e => {
  e.stopPropagation();
  if (e.code === 'Enter') { e.preventDefault(); saveScore(); }
});
document.querySelectorAll('.reset-records-btn').forEach(btn => {
  btn.addEventListener('click', resetRecordsAndRender);
});

applyTheme();
// Al cargar se muestra la pantalla de inicio con la tabla de records; init() arranca la partida
renderRecords(startRecords, null);
