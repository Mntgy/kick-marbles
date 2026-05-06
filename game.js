const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");

function resizeCanvas() {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
}
resizeCanvas();
window.addEventListener("resize", resizeCanvas);

const LEVEL_HEIGHT = 20000; // extended for 3+ min races
let cameraY = 0;

let players = [];
let raceStarted = false;
let winner = null;
let leaderboard = [];
let raceFinished = false;
let finalRankings = [];

// ─── Spectate mode ────────────────────────────────────────────────────────────
let spectateIndex = -1; // -1 = auto-follow leader
let spectateTarget = null; // player being spectated

// ─── Leaderboard expand/collapse ─────────────────────────────────────────────
let hudExpanded = false;
let hudScrollOffset = 0; // index of first visible row when expanded

// ─── Commentary feed ─────────────────────────────────────────────────────────
let commentaryFeed = []; // { text, color, born }
const COMMENTARY_MAX = 5;
const COMMENTARY_TTL = 4000; // ms

function addCommentary(text, color = 'white') {
  commentaryFeed.push({ text, color, born: Date.now() });
  if (commentaryFeed.length > COMMENTARY_MAX) commentaryFeed.shift();
}

// Track rank changes for overtake commentary
let prevRanks = {};

// Obstacle arrays
let pegs = [];
let obstacles = [];       // moving bars
let spinners = [];        // cross spinners
let bouncePads = [];
let portals = [];
let slowZones = [];
let killZones = [];
let gravityWells = [];    // NEW: suck players sideways
let narrowGates = [];     // NEW: tight gaps between walls
let zigzagWalls = [];     // NEW: angled static walls
let bumpers = [];         // circular bumpers that strongly repel

// ─── MAP SELECTION ────────────────────────────────────────────────────────────
// 'default' = original neon map | 'bahamas' = Bikini Bottom / big nose map
let currentMap = 'default';

// ─── BAHAMAS MAP OBSTACLES ────────────────────────────────────────────────────
let noseBumpers = [];     // active nose obstacles — sniff + sneeze cycle
let sneezeZones = [];     // sneeze blasts — horizontal push zones
let nostrilPortals = [];  // portals shaped like nostrils
let boogerSlimes = [];    // slow + sticky blob zones

// ── NEW Bahamas-exclusive obstacles ──────────────────────────────────────────
let tideWaves = [];       // { y, phase, speed, dir, strength, w } — sweeping horizontal walls
let crabClaws = [];       // { x, y, openAngle, phase, speed, armLen, gap } — pincer traps
let bubbleLifts = [];     // { x, y, w, h, strength } — rising bubble columns that push up
let anchorChains = [];    // { x, y, len, angle, speed, links } — swinging pendulum chains

// Nose state machine: 'idle' → 'sniffing' → 'charging' → 'sneezing' → 'idle'
// Each nose has its own timer so they're out of phase
const NOSE_CYCLE_MS = 4000;  // full cycle length
const NOSE_SNIFF_START  = 0;        // 0%   start sucking in
const NOSE_SNIFF_END    = 0.35;     // 35%  stop sucking
const NOSE_CHARGE_END   = 0.55;     // 55%  windup / quiver
const NOSE_SNEEZE_END   = 0.70;     // 70%  BLAST
const NOSE_IDLE_END     = 1.00;     // 100% rest

// Bikini Bottom background elements (drawn once per frame, parallax)
const BB_ELEMENTS = []; // { type, x, y, scale, wobble }
function initBikiniBottom() {
  BB_ELEMENTS.length = 0;
  const W = canvas.width;
  const types = ['pineapple','rock','coral','bubble','fish','star','seaweed'];
  for (let i = 0; i < 60; i++) {
    BB_ELEMENTS.push({
      type: types[Math.floor(Math.random() * types.length)],
      x: Math.random() * W,
      y: 100 + Math.random() * 19800,
      scale: 0.5 + Math.random() * 1.2,
      wobble: Math.random() * Math.PI * 2,
      wobbleSpeed: 0.01 + Math.random() * 0.02,
      layer: Math.random() < 0.5 ? 0.3 : 0.6, // parallax depth
    });
  }
}
// Call on load (canvas may not be sized yet; we'll also call in generateLevel)
initBikiniBottom();

// ─── Map selector ─────────────────────────────────────────────────────────────
function selectMap(mapId) {
  currentMap = mapId;
  document.querySelectorAll('.btn-map').forEach(b => b.classList.remove('active'));
  const btn = document.getElementById('map-btn-' + mapId);
  if (btn) btn.classList.add('active');
  // Update title
  const title = document.getElementById('ui-title');
  if (title) title.textContent = mapId === 'bahamas' ? '🏝️ BAHAMAS RACE' : '🎱 KICK MARBLES';
  // Update legend
  const legend = document.getElementById('legend');
  if (legend) {
    if (mapId === 'bahamas') {
      legend.innerHTML = `
        <span style="color:#aabbcc">● Peg</span>
        <span style="color:#e03030">■ Bar</span>
        <span style="color:cyan">✛ Spinner</span>
        <span style="color:#44ff88">■ Platform</span>
        <span style="color:#ff6600">● Bumper</span>
        <span style="color:#cc4488">● Nostril IN</span>
        <span style="color:#44cc44">● Nostril OUT</span>
        <span style="color:#3366ff">■ Slow</span>
        <span style="color:red">■ ☠ Kill</span>
        <span style="color:#ffaa88">👃 Nose Bump</span>
        <span style="color:#aaff44">■ 🤧 Sneeze</span>
        <span style="color:#88ff88">🟢 Booger</span>
        <span style="color:#44aaff">🌊 Tide Wave</span>
        <span style="color:#ff6622">🦀 Crab Claw</span>
        <span style="color:#aaddff">🫧 Bubble Lift</span>
        <span style="color:#8899aa">⚓ Chain</span>`;
    } else {
      legend.innerHTML = `
        <span style="color:#aabbcc">● Peg</span>
        <span style="color:#e03030">■ Bar</span>
        <span style="color:cyan">✛ Spinner</span>
        <span style="color:#44ff88">■ Platform</span>
        <span style="color:#ff6600">● Bumper</span>
        <span style="color:#6644ff">● Portal IN</span>
        <span style="color:#ff8844">● Portal OUT</span>
        <span style="color:#3366ff">■ Slow</span>
        <span style="color:red">■ ☠ Kill</span>`;
    }
  }
}

// ─── Buffs / Pickups ──────────────────────────────────────────────────────────
let buffs = [];  // { x, y, type, radius, born, pulsePhase }
const BUFF_TYPES = [
  { type: 'speed',    color: '#00ff9d', glow: '#00ff9d', label: '⚡ SPEED',    icon: '⚡' },
  { type: 'slow',     color: '#3366ff', glow: '#3366ff', label: '🧊 SLOW',     icon: '🧊' },
  { type: 'gravity',  color: '#ff44cc', glow: '#ff44cc', label: '🌀 MAGNET',   icon: '🌀' },
  { type: 'ghost',    color: '#ffffff', glow: '#aaaaff', label: '👻 GHOST',    icon: '👻' },
  { type: 'boost',    color: '#ffd700', glow: '#ffd700', label: '🚀 BOOST',    icon: '🚀' },
  { type: 'shrink',   color: '#ff8844', glow: '#ff8844', label: '🔻 SHRINK',   icon: '🔻' },
];
const BUFF_RADIUS   = 14;
const BUFF_LIFETIME = 12000; // ms before it despawns unpicked
const BUFF_DURATION = 5000;  // ms active on player
const BUFF_SPAWN_INTERVAL = 180; // frames between spawns

// ─── Add player ───────────────────────────────────────────────────────────────
function addPlayer(name) {
  if (raceStarted) return;
  if (players.find(p => p.name === name)) return;

  const slot = players.length;
  const spacing = canvas.width / 10;
  const startX = 40 + (slot % 9) * spacing;

  players.push({
    name,
    x: 80 + (slot % 9) * (canvas.width / 10) + (Math.random() - 0.5) * 10,
    y: 20,
    vx: (Math.random() - 0.5) * 2,
    vy: 0,
    radius: 10,
    color: `hsl(${Math.random() * 360}, 70%, 60%)`,
    teleportCooldown: 0,
    finished: false,
    trail: [],
    stuckTimer: 0,
    lastX: 0,
    lastY: 0,
    prevX: 0,
    prevY: 0,
    stuckDist: 0,
    rank: 0,
    finishTime: null,
    activeBuff: null,   // { type, expires }
    buffTimer: 0,
    magnetTargets: []   // for gravity/magnet buff
  });

  updatePlayerList();
}

// ─── Level generation ─────────────────────────────────────────────────────────
// The level is split into 7 themed zones, each ~1400px tall:
//   Zone 1 (0–1400):     Peg Forest — dense staggered pegs
//   Zone 2 (1400–2800):  Bumper Pit — large circular bumpers + fast bars
//   Zone 3 (2800–4200):  Narrow Gates — tight choke-point corridors
//   Zone 4 (4200–5600):  Spinner Hell — wall-to-wall spinning blades
//   Zone 5 (5600–7000):  Gravity Swamp — slow zones + gravity wells
//   Zone 6 (7000–8400):  Kill Zone Gauntlet — many kill zones + portals that send back FAR
//   Zone 7 (8400–10000): Final Descent — fast bars + zigzag walls + dense pegs

function generateLevel() {
  // Dispatch to the correct map generator
  if (currentMap === 'bahamas') {
    generateBahamasLevel();
  } else {
    generateDefaultLevel();
  }
}

// ─── DEFAULT MAP ──────────────────────────────────────────────────────────────
function generateDefaultLevel() {
  pegs = [];
  obstacles = [];
  spinners = [];
  bouncePads = [];
  portals = [];
  slowZones = [];
  killZones = [];
  gravityWells = [];
  narrowGates = [];
  zigzagWalls = [];
  bumpers = [];
  buffs = [];
  noseBumpers = [];
  sneezeZones = [];
  nostrilPortals = [];
  boogerSlimes = [];

  // ══════════════════════════════════════════════════════════
  // ZONE 1: Peg Forest (y: 80 – 1400)
  // Dense alternating pegs, a few slow bars, 2 bounce pads
  // ══════════════════════════════════════════════════════════
  for (let y = 80; y < 1400; y += 75) {
    const offset = (Math.floor(y / 75) % 2 === 0) ? 0 : 50;
    for (let x = 40 + offset; x < canvas.width - 30; x += 100) {
      pegs.push({ x: x + (Math.random() - 0.5) * 12, y });
    }
  }
  // Slow moving bars in zone 1
  for (let i = 0; i < 6; i++) {
    obstacles.push({ x: Math.random() * (canvas.width - 200), y: 200 + i * 200, w: 140, h: 12, dir: i % 2 === 0 ? 1 : -1, speed: 1.2 + Math.random() });
  }
  bouncePads.push({ x: canvas.width * 0.15, y: 700, w: 100, h: 10 });
  bouncePads.push({ x: canvas.width * 0.55, y: 1100, w: 100, h: 10 });

  // ══════════════════════════════════════════════════════════
  // ZONE 2: Bumper Pit (y: 1400 – 2800)
  // Large bouncy bumpers + faster bars
  // ══════════════════════════════════════════════════════════
  const W = canvas.width;
  const bumperPositions = [
    [W*0.15, 1500], [W*0.42, 1600], [W*0.68, 1520],
    [W*0.26, 1750], [W*0.57, 1800], [W*0.10, 1950],
    [W*0.73, 2000], [W*0.36, 2100], [W*0.15, 2250],
    [W*0.62, 2300], [W*0.42, 2450], [W*0.21, 2550],
    [W*0.68, 2600], [W*0.10, 2700], [W*0.47, 2720],
  ];
  bumperPositions.forEach(([x, y]) => {
    bumpers.push({ x, y, radius: 22 + Math.random() * 14 });
  });
  // Fast bars
  for (let i = 0; i < 8; i++) {
    obstacles.push({ x: Math.random() * (canvas.width - 220), y: 1450 + i * 170, w: 160, h: 14, dir: i % 2 === 0 ? 1 : -1, speed: 2.5 + Math.random() * 1.5 });
  }
  bouncePads.push({ x: canvas.width * 0.35, y: 2100, w: 120, h: 10 });

  // ══════════════════════════════════════════════════════════
  // ZONE 3: Platform Cascade (y: 2800 – 4200)
  // Short horizontal platforms staggered so marbles bounce
  // down from one to the next — no trapping possible.
  // ══════════════════════════════════════════════════════════
  const platW = Math.round(canvas.width * 0.22);
  const platRows = 14;
  const platSpacingY = 100;
  for (let i = 0; i < platRows; i++) {
    const y = 2860 + i * platSpacingY;
    // Two platforms per row, offset so there's always a gap to fall through
    const col = i % 3; // 0=left, 1=center, 2=right
    const offsets = [
      canvas.width * 0.05,
      canvas.width * 0.38,
      canvas.width * 0.68
    ];
    // Primary platform
    narrowGates.push({ y, gapX: offsets[col], gapWidth: platW, isPlatform: true });
    // Second platform on opposite side (skip sometimes for variety)
    if (i % 4 !== 0) {
      const col2 = (col + 2) % 3;
      narrowGates.push({ y: y + 30, gapX: offsets[col2], gapWidth: platW, isPlatform: true });
    }
  }
  // Scattered pegs between platforms
  for (let y = 2900; y < 4200; y += 130) {
    for (let x = 80; x < canvas.width - 80; x += 200) {
      pegs.push({ x: x + (Math.random()-0.5)*30, y: y + (Math.random()-0.5)*20 });
    }
  }
  bouncePads.push({ x: canvas.width * 0.4, y: 3600, w: 140, h: 10 });
  bouncePads.push({ x: canvas.width * 0.15, y: 4000, w: 140, h: 10 });

  // ══════════════════════════════════════════════════════════
  // ZONE 4: Spinner Hell (y: 4200 – 5600)
  // Wall-to-wall spinners, very fast, close together
  // ══════════════════════════════════════════════════════════
  // Zone 4 spinners — procedurally spread across full canvas width
  const spinnerCols = 5; // columns across the width
  const spinnerRows = [4300, 4500, 4700, 4900, 5100, 5300, 5500];
  spinnerRows.forEach((sy, ri) => {
    const cols = ri % 2 === 0 ? spinnerCols : spinnerCols - 1;
    for (let c = 0; c < cols; c++) {
      const frac = ri % 2 === 0
        ? (c + 0.5) / cols
        : (c + 1) / cols;
      spinners.push({
        x: canvas.width * frac,
        y: sy,
        angle: Math.random() * Math.PI * 2,
        speed: 0.07 + Math.random() * 0.07,
        size: 55
      });
    }
  });
  // A few moving bars weaving through
  for (let i = 0; i < 5; i++) {
    obstacles.push({ x: Math.random() * (canvas.width - 180), y: 4250 + i * 270, w: 130, h: 12, dir: i % 2 === 0 ? 1 : -1, speed: 2 + Math.random() });
  }

  // ══════════════════════════════════════════════════════════
  // ZONE 5: Gravity Swamp (y: 5600 – 7000)
  // Large slow zones + gravity wells that pull players sideways
  // ══════════════════════════════════════════════════════════
  const swampSlows = [
    [W*0.04, 5650, W*0.22, 80], [W*0.32, 5750, W*0.22, 80], [W*0.62, 5700, W*0.20, 80],
    [W*0.08, 5950, W*0.26, 80], [W*0.45, 6050, W*0.22, 80],
    [W*0.04, 6250, W*0.20, 80], [W*0.36, 6300, W*0.24, 80], [W*0.68, 6200, W*0.18, 80],
    [W*0.12, 6550, W*0.22, 80], [W*0.47, 6600, W*0.22, 80],
    [W*0.06, 6800, W*0.30, 80], [W*0.55, 6850, W*0.28, 80],
  ];
  swampSlows.forEach(([x, y, w, h]) => slowZones.push({ x, y, w, h }));

  // Gravity wells spread across full width
  const wellPositions = [
    [W*0.05, 5800], [W*0.92, 6000], [W*0.05, 6200], [W*0.92, 6400],
    [W*0.50, 6700], [W*0.05, 6900], [W*0.92, 6950]
  ];
  wellPositions.forEach(([x, y]) => gravityWells.push({ x, y, strength: 0.4 }));

  // Pegs scattered through swamp
  for (let y = 5650; y < 7000; y += 90) {
    for (let x = 60; x < canvas.width - 60; x += 110) {
      pegs.push({ x: x + (Math.random() - 0.5) * 20, y });
    }
  }

  // ══════════════════════════════════════════════════════════
  // ZONE 6: Kill Zone Gauntlet (y: 7000 – 8400)
  // Dense kill zones + portals that send you back 800–1200px
  // ══════════════════════════════════════════════════════════
  const killData = [
    [W*0.10, 7100], [W*0.36, 7200], [W*0.60, 7150],
    [W*0.21, 7400], [W*0.52, 7450], [W*0.07, 7500],
    [W*0.31, 7650], [W*0.64, 7700], [W*0.15, 7800],
    [W*0.44, 7950], [W*0.69, 8000], [W*0.05, 8050],
    [W*0.27, 8200], [W*0.57, 8250], [W*0.76, 8300],
  ];
  killData.forEach(([x, y]) => {
    killZones.push({ x, y, w: 130, h: 20, safeY: Math.max(20, y - 900) });
  });

  // Portals — spread across full width
  for (let i = 0; i < 8; i++) {
    const py = 7100 + i * 165;
    portals.push({
      x1: 40 + Math.random() * (canvas.width - 80),
      y1: py,
      x2: 40 + Math.random() * (canvas.width - 80),
      y2: Math.max(20, py - 800 - Math.random() * 400)
    });
  }

  // Fast moving bars in gauntlet
  for (let i = 0; i < 8; i++) {
    obstacles.push({ x: Math.random() * (canvas.width - 230), y: 7050 + i * 175, w: 170, h: 14, dir: i % 2 === 0 ? 1 : -1, speed: 3 + Math.random() * 2 });
  }

  // ══════════════════════════════════════════════════════════
  // ZONE 7: Final Descent (y: 8400 – 10000)
  // Zigzag ramps + sparse pegs (no pegs near ramps) + fast bars
  // ══════════════════════════════════════════════════════════
  // Build zigzag ramps first so we can clear pegs near them
  const zone7Ramps = [];
  for (let i = 0; i < 10; i++) {
    const y = 8480 + i * 155;
    const fromLeft = i % 2 === 0;
    const ramp = {
      x1: fromLeft ? 0 : canvas.width,
      y1: y,
      x2: fromLeft ? canvas.width * 0.52 : canvas.width * 0.48,
      y2: y + 90
    };
    zone7Ramps.push(ramp);
    zigzagWalls.push(ramp);
  }

  // Sparse pegs — skip any peg within 55px of a ramp segment
  for (let y = 8400; y < 10000; y += 90) {
    const offset = (Math.floor(y / 90) % 2 === 0) ? 0 : 55;
    for (let x = 40 + offset; x < canvas.width - 40; x += 110) {
      const px = x + (Math.random() - 0.5) * 10;
      const py = y + (Math.random() - 0.5) * 10;
      // Check distance to every ramp segment
      let tooClose = false;
      for (const w of zone7Ramps) {
        const sdx = w.x2 - w.x1, sdy = w.y2 - w.y1;
        const len2 = sdx*sdx + sdy*sdy;
        const t = Math.max(0, Math.min(1, ((px-w.x1)*sdx + (py-w.y1)*sdy) / len2));
        const cx = w.x1 + t*sdx, cy = w.y1 + t*sdy;
        if (Math.hypot(px-cx, py-cy) < 55) { tooClose = true; break; }
      }
      if (!tooClose) pegs.push({ x: px, y: py });
    }
  }
  // Very fast bars in final zone
  for (let i = 0; i < 10; i++) {
    obstacles.push({ x: Math.random() * (canvas.width - 240), y: 8450 + i * 155, w: 180, h: 14, dir: i % 2 === 0 ? 1 : -1, speed: 3.5 + Math.random() * 2 });
  }
  bouncePads.push({ x: canvas.width * 0.35, y: 9200, w: 120, h: 10 });
  bouncePads.push({ x: canvas.width * 0.12, y: 9600, w: 100, h: 10 });
  bouncePads.push({ x: canvas.width * 0.65, y: 9800, w: 100, h: 10 });

  // ══════════════════════════════════════════════════════════
  // ZONE 8: Mirror Madness (y: 10000 – 11400)
  // Alternating angled ramps — left-side then right-side,
  // never meeting in the middle so marble always has a gap.
  // ══════════════════════════════════════════════════════════
  for (let i = 0; i < 10; i++) {
    const y = 10060 + i * 140;
    if (i % 2 === 0) {
      // Left ramp only — ends at 55% width, big gap on right
      zigzagWalls.push({ x1: 0, y1: y, x2: canvas.width*0.55, y2: y+80 });
    } else {
      // Right ramp only — ends at 45% width, big gap on left
      zigzagWalls.push({ x1: canvas.width, y1: y, x2: canvas.width*0.45, y2: y+80 });
    }
  }
  // Bumpers scattered (not blocking centre gap)
  for (let i = 0; i < 8; i++) {
    const side = i % 2 === 0 ? 0.15 : 0.82;
    bumpers.push({ x: canvas.width*side, y: 10150 + i*155, radius: 22 });
  }
  // Sparse pegs
  for (let y = 10050; y < 11400; y += 140) {
    for (let x = 80; x < canvas.width-80; x += 180) {
      pegs.push({ x: x+(Math.random()-0.5)*20, y: y+(Math.random()-0.5)*20 });
    }
  }
  bouncePads.push({ x: canvas.width*0.3, y: 10900, w: 140, h: 10 });
  bouncePads.push({ x: canvas.width*0.6, y: 11200, w: 140, h: 10 });

  // ══════════════════════════════════════════════════════════
  // ZONE 9: Pinball Palace (y: 11400 – 12800)
  // Dense bumpers arranged in diamond patterns + fast spinning
  // blades everywhere — high chaos, high energy.
  // ══════════════════════════════════════════════════════════
  const diamondCentres = [
    [canvas.width*0.2, 11600], [canvas.width*0.5, 11500], [canvas.width*0.8, 11700],
    [canvas.width*0.35,11900], [canvas.width*0.65,11950],
    [canvas.width*0.15,12100], [canvas.width*0.5, 12200], [canvas.width*0.85,12150],
  ];
  diamondCentres.forEach(([cx,cy]) => {
    [[0,-50],[50,0],[0,50],[-50,0]].forEach(([ox,oy]) => {
      bumpers.push({ x:cx+ox, y:cy+oy, radius:16 });
    });
  });
  // Fast spinners between diamonds
  for (let i = 0; i < 14; i++) {
    spinners.push({
      x: 80 + Math.random()*(canvas.width-160),
      y: 11450 + i*95,
      angle: Math.random()*Math.PI*2,
      speed: 0.09 + Math.random()*0.06,
      size: 50
    });
  }
  for (let i = 0; i < 6; i++) {
    obstacles.push({ x: Math.random()*(canvas.width-200), y: 11500+i*220, w: 180, h: 13, dir: i%2===0?1:-1, speed: 3+Math.random()*2 });
  }
  bouncePads.push({ x: canvas.width*0.45, y: 12500, w: 150, h: 10 });

  // ══════════════════════════════════════════════════════════
  // ZONE 10: Wormhole Alley (y: 12800 – 14200)
  // Dense portal network — nearly every portal sends you
  // forward OR backward at random. Slow zones clog the gaps.
  // ══════════════════════════════════════════════════════════
  for (let i = 0; i < 16; i++) {
    const py = 12850 + i*85;
    const forward = Math.random() > 0.4; // 60% chance portal sends you forward
    portals.push({
      x1: 40 + Math.random()*(canvas.width-80),
      y1: py,
      x2: 40 + Math.random()*(canvas.width-80),
      y2: forward
        ? Math.min(LEVEL_HEIGHT-100, py + 300 + Math.random()*600)  // forward
        : Math.max(20, py - 400 - Math.random()*500)                  // back
    });
  }
  // Wide slow zones
  [[0,12900,canvas.width*0.4,70],[canvas.width*0.55,13100,canvas.width*0.4,70],
   [0,13400,canvas.width*0.35,70],[canvas.width*0.6,13600,canvas.width*0.35,70]].forEach(([x,y,w,h])=>{
    slowZones.push({x,y,w,h});
  });
  for (let y=12850;y<14200;y+=100) {
    for (let x=70;x<canvas.width-70;x+=140) {
      pegs.push({x:x+(Math.random()-0.5)*18,y:y+(Math.random()-0.5)*18});
    }
  }
  for (let i=0;i<6;i++) {
    obstacles.push({x:Math.random()*(canvas.width-200),y:12900+i*230,w:160,h:13,dir:i%2===0?1:-1,speed:2.5+Math.random()*1.5});
  }

  // ══════════════════════════════════════════════════════════
  // ZONE 11: Avalanche (y: 14200 – 16000)
  // Cascading platform waterfall — platforms get shorter and
  // faster as you descend. Kill zones at the sides.
  // ══════════════════════════════════════════════════════════
  for (let i = 0; i < 20; i++) {
    const y = 14280 + i*88;
    const w = Math.max(60, canvas.width*0.18 - i*3); // shrinking platforms
    const col = i%4;
    const xPos = [canvas.width*0.05, canvas.width*0.28, canvas.width*0.52, canvas.width*0.74][col];
    narrowGates.push({ y, gapX: xPos, gapWidth: w, isPlatform: true });
    // Second platform offset
    if (i%3!==0) {
      const col2=(col+2)%4;
      const xPos2=[canvas.width*0.05,canvas.width*0.28,canvas.width*0.52,canvas.width*0.74][col2];
      narrowGates.push({ y:y+35, gapX:xPos2, gapWidth:w*0.8, isPlatform:true });
    }
  }
  // Kill zones at left/right edges
  for (let i=0;i<10;i++) {
    killZones.push({x:0, y:14350+i*160, w:40, h:25, safeY:Math.max(20,14350+i*160-600)});
    killZones.push({x:canvas.width-40, y:14420+i*160, w:40, h:25, safeY:Math.max(20,14420+i*160-600)});
  }
  bouncePads.push({x:canvas.width*0.4,y:15200,w:150,h:10});
  bouncePads.push({x:canvas.width*0.2,y:15700,w:120,h:10});
  bouncePads.push({x:canvas.width*0.65,y:15900,w:120,h:10});

  // ══════════════════════════════════════════════════════════
  // ZONE 12: The Gauntlet (y: 16000 – 18000)
  // Every obstacle type combined at maximum intensity.
  // ══════════════════════════════════════════════════════════
  // Gravity wells pulling to corners
  [[30,16200],[canvas.width-30,16400],[30,16800],[canvas.width-30,17000],
   [canvas.width/2,17200],[30,17500],[canvas.width-30,17700]].forEach(([x,y])=>{
    gravityWells.push({x,y,strength:0.55});
  });
  // Fast obstacles
  for (let i=0;i<12;i++) {
    obstacles.push({x:Math.random()*(canvas.width-220),y:16050+i*165,w:200,h:14,dir:i%2===0?1:-1,speed:4+Math.random()*2.5});
  }
  // Spinners
  for (let i=0;i<18;i++) {
    spinners.push({
      x:60+Math.random()*(canvas.width-120),
      y:16100+i*105,
      angle:Math.random()*Math.PI*2,
      speed:0.10+Math.random()*0.08,
      size:58
    });
  }
  // Kill zones scattered
  for (let i=0;i<8;i++) {
    killZones.push({x:80+Math.random()*(canvas.width-250),y:16150+i*230,w:150,h:20,safeY:Math.max(20,16000-300)});
  }
  // Pegs
  for (let y=16050;y<18000;y+=120) {
    for (let x=80;x<canvas.width-80;x+=160) {
      pegs.push({x:x+(Math.random()-0.5)*20,y:y+(Math.random()-0.5)*20});
    }
  }
  bouncePads.push({x:canvas.width*0.3,y:17000,w:160,h:10});
  bouncePads.push({x:canvas.width*0.6,y:17600,w:160,h:10});

  // ══════════════════════════════════════════════════════════
  // ZONE 13: Final Mile (y: 18000 – 20000)
  // One last brutal descent — diagonal ramps + max-speed bars
  // + dense bumpers. Finish line at 20000.
  // ══════════════════════════════════════════════════════════
  const finalRamps = [];
  for (let i=0;i<14;i++) {
    const y=18050+i*140;
    const fromLeft=i%2===0;
    const ramp={
      x1:fromLeft?0:canvas.width, y1:y,
      x2:fromLeft?canvas.width*0.52:canvas.width*0.48, y2:y+100
    };
    finalRamps.push(ramp);
    zigzagWalls.push(ramp);
  }
  // Zone 13 replacements: alternating spinners + gravity wells
  // Spinners placed in the clear gap opposite each ramp's open side
  for (let i = 0; i < 14; i++) {
    const fromLeft = i % 2 === 0;
    // Place spinner on the open/gap side of the ramp, well away from the wall
    const sx = fromLeft ? canvas.width * 0.72 : canvas.width * 0.28;
    const sy = 18100 + i * 140 + 50;
    spinners.push({ x: sx, y: sy, angle: Math.random() * Math.PI * 2, speed: 0.09 + Math.random() * 0.05, size: 45 });
  }
  // Gravity wells pinned to the edges (they pull sideways, never block the centre lane)
  for (let i = 0; i < 7; i++) {
    const side = i % 2 === 0 ? 28 : canvas.width - 28;
    gravityWells.push({ x: side, y: 18150 + i * 270, strength: 0.45 });
  }
  // Max speed bars
  for (let i=0;i<14;i++) {
    obstacles.push({x:Math.random()*(canvas.width-220),y:18060+i*140,w:200,h:14,dir:i%2===0?1:-1,speed:5+Math.random()*3});
  }
  // Sparse pegs avoiding ramps
  for (let y=18050;y<20000;y+=100) {
    const offset=(Math.floor(y/100)%2===0)?0:70;
    for (let x=50+offset;x<canvas.width-50;x+=130) {
      const px=x+(Math.random()-0.5)*12, py=y+(Math.random()-0.5)*12;
      let tooClose=false;
      for (const w of finalRamps) {
        const sdx=w.x2-w.x1,sdy=w.y2-w.y1,len2=sdx*sdx+sdy*sdy;
        const t=Math.max(0,Math.min(1,((px-w.x1)*sdx+(py-w.y1)*sdy)/len2));
        if (Math.hypot(px-w.x1-t*sdx,py-w.y1-t*sdy)<55){tooClose=true;break;}
      }
      if (!tooClose) pegs.push({x:px,y:py});
    }
  }
  bouncePads.push({x:canvas.width*0.4,y:19000,w:160,h:10});
  bouncePads.push({x:canvas.width*0.2,y:19500,w:140,h:10});
  bouncePads.push({x:canvas.width*0.65,y:19800,w:140,h:10});

} // end generateDefaultLevel

// --- BAHAMAS MAP ---
function generateBahamasLevel() {
  pegs = []; obstacles = []; spinners = []; bouncePads = [];
  portals = []; slowZones = []; killZones = []; gravityWells = [];
  narrowGates = []; zigzagWalls = []; bumpers = []; buffs = [];
  noseBumpers = []; sneezeZones = []; nostrilPortals = []; boogerSlimes = [];
  tideWaves = []; crabClaws = []; bubbleLifts = []; anchorChains = [];
  initBikiniBottom();
  const W = canvas.width;

  // ZONE 1: Bubble Beach (y:80-1400) - bubble pegs, coral platforms, sneeze blasts
  for (let y=80; y<1400; y+=80) {
    const off=(Math.floor(y/80)%2===0)?0:55;
    for (let x=40+off; x<W-30; x+=110) pegs.push({x:x+(Math.random()-0.5)*14,y});
  }
  [[W*0.1,400,W*0.28],[W*0.55,550,W*0.22],[W*0.2,800,W*0.25],[W*0.6,950,W*0.2],[W*0.3,1200,W*0.3]].forEach(([gx,gy,gw])=>{
    narrowGates.push({y:gy,gapX:gx,gapWidth:gw,isPlatform:true});
  });
  [300,700,1100].forEach((sy,i)=>{
    sneezeZones.push({x:0,y:sy,w:W,h:26,dir:i%2===0?1:-1,strength:3+i,phase:Math.random()*Math.PI*2,speed:0.02+Math.random()*0.01});
  });
  for (let i=0;i<5;i++) obstacles.push({x:Math.random()*(W-180),y:200+i*220,w:130,h:12,dir:i%2===0?1:-1,speed:1+Math.random()*0.8});
  bouncePads.push({x:W*0.2,y:600,w:100,h:10});
  bouncePads.push({x:W*0.6,y:1100,w:100,h:10});

  // ZONE 2: Nose Bumper Pit (y:1400-2800) - nose bumpers + booger slimes
  [[W*0.15,1500],[W*0.5,1650],[W*0.8,1520],[W*0.25,1850],[W*0.65,1950],[W*0.1,2100],[W*0.45,2200],[W*0.75,2350],[W*0.2,2500],[W*0.55,2650]].forEach(([nx,ny],i)=>{
    noseBumpers.push({x:nx,y:ny,rx:40+(i%3)*8,ry:54+(i%4)*7,nostrilL:{dx:-14,dy:28},nostrilR:{dx:14,dy:28},phaseOffset:(i/10)*NOSE_CYCLE_MS,sniffRadius:140+(i%3)*25,sneezeForce:15+(i%4)*3});
  });
  [[W*0.05,1600,120],[W*0.4,1800,100],[W*0.7,1700,110],[W*0.15,2000,130],[W*0.55,2150,100],[W*0.8,2300,90],[W*0.3,2450,120],[W*0.6,2600,100]].forEach(([bx,by,bw])=>{
    boogerSlimes.push({x:bx,y:by,w:bw,h:20,drip:Math.random()*Math.PI*2});
  });
  for (let i=0;i<7;i++) obstacles.push({x:Math.random()*(W-200),y:1450+i*190,w:150,h:13,dir:i%2===0?1:-1,speed:2.2+Math.random()*1.2});
  bouncePads.push({x:W*0.4,y:2200,w:120,h:10});

  // ZONE 3: Coral Cascade (y:2800-4200) - staggered coral platforms + nostril portals
  const coralW=Math.round(W*0.22);
  for (let i=0;i<14;i++) {
    const cy=2860+i*100, col=i%3;
    const offs=[W*0.05,W*0.38,W*0.68];
    narrowGates.push({y:cy,gapX:offs[col],gapWidth:coralW,isPlatform:true});
    if (i%4!==0) { const c2=(col+2)%3; narrowGates.push({y:cy+30,gapX:offs[c2],gapWidth:coralW,isPlatform:true}); }
  }
  [[W*0.3,2950],[W*0.65,3200],[W*0.2,3500],[W*0.7,3800],[W*0.4,4050]].forEach(([px,py],i)=>{
    nostrilPortals.push({x1:px,y1:py,x2:W-px,y2:py+20,sendUp:i%3===0,sendY:i%3===0?Math.max(20,py-600):Math.min(LEVEL_HEIGHT-50,py+350)});
  });
  for (let y=2900;y<4200;y+=130) for (let x=80;x<W-80;x+=200) pegs.push({x:x+(Math.random()-0.5)*30,y:y+(Math.random()-0.5)*20});
  bouncePads.push({x:W*0.35,y:3500,w:130,h:10});
  bouncePads.push({x:W*0.6,y:3900,w:130,h:10});

  // ZONE 4: Jellyfish Spin (y:4200-5600) - jellyfish spinners + sneeze blasts
  const jRows=[4300,4500,4700,4900,5100,5300,5500];
  jRows.forEach((sy,ri)=>{
    const cols=ri%2===0?5:4;
    for (let c=0;c<cols;c++) {
      const frac=ri%2===0?(c+0.5)/cols:(c+1)/cols;
      spinners.push({x:W*frac,y:sy,angle:Math.random()*Math.PI*2,speed:0.06+Math.random()*0.06,size:52});
    }
  });
  [4400,4900,5400].forEach((sy,i)=>{
    sneezeZones.push({x:0,y:sy,w:W,h:26,dir:i%2===0?1:-1,strength:5+i*1.5,phase:Math.random()*Math.PI*2,speed:0.025+Math.random()*0.01});
  });
  for (let i=0;i<5;i++) obstacles.push({x:Math.random()*(W-180),y:4250+i*270,w:130,h:12,dir:i%2===0?1:-1,speed:2+Math.random()});

  // ZONE 5: Seaweed Swamp (y:5600-7000) - seaweed slow zones + tide gravity wells
  [[W*0.04,5650,W*0.22,80],[W*0.32,5750,W*0.22,80],[W*0.62,5700,W*0.20,80],
   [W*0.08,5950,W*0.26,80],[W*0.45,6050,W*0.22,80],
   [W*0.04,6250,W*0.20,80],[W*0.36,6300,W*0.24,80],[W*0.68,6200,W*0.18,80],
   [W*0.12,6550,W*0.22,80],[W*0.47,6600,W*0.22,80],
   [W*0.06,6800,W*0.30,80],[W*0.55,6850,W*0.28,80]].forEach(([x,y,w,h])=>slowZones.push({x,y,w,h}));
  [[W*0.05,5800],[W*0.92,6000],[W*0.05,6200],[W*0.92,6400],[W*0.50,6700],[W*0.05,6900],[W*0.92,6950]].forEach(([x,y])=>gravityWells.push({x,y,strength:0.38}));
  // Nose bumpers scattered through swamp
  [[W*0.3,5900],[W*0.7,6100],[W*0.2,6400],[W*0.75,6600],[W*0.45,6850]].forEach(([nx,ny],i)=>{
    noseBumpers.push({x:nx,y:ny,rx:36+(i%3)*6,ry:50+(i%4)*6,nostrilL:{dx:-12,dy:26},nostrilR:{dx:12,dy:26},phaseOffset:(i/5)*NOSE_CYCLE_MS,sniffRadius:120+(i%3)*20,sneezeForce:12+(i%4)*2});
  });
  for (let y=5650;y<7000;y+=90) for (let x=60;x<W-60;x+=110) pegs.push({x:x+(Math.random()-0.5)*20,y});

  // ZONE 6: Shark Kill Gauntlet (y:7000-8400) - shark kill zones + nostril portals
  [[W*0.10,7100],[W*0.36,7200],[W*0.60,7150],[W*0.21,7400],[W*0.52,7450],[W*0.07,7500],
   [W*0.31,7650],[W*0.64,7700],[W*0.15,7800],[W*0.44,7950],[W*0.69,8000],[W*0.05,8050],
   [W*0.27,8200],[W*0.57,8250],[W*0.76,8300]].forEach(([x,y])=>{
    killZones.push({x,y,w:130,h:20,safeY:Math.max(20,y-900)});
  });
  for (let i=0;i<8;i++) {
    const py=7100+i*165;
    nostrilPortals.push({x1:40+Math.random()*(W-80),y1:py,x2:40+Math.random()*(W-80),y2:Math.max(20,py-800-Math.random()*400),sendUp:true,sendY:Math.max(20,py-800)});
  }
  for (let i=0;i<8;i++) obstacles.push({x:Math.random()*(W-230),y:7050+i*175,w:170,h:14,dir:i%2===0?1:-1,speed:3+Math.random()*2});

  // ZONE 7: Coral Ramp Descent (y:8400-10000) - diagonal coral ramps + dense pegs
  const z7Ramps=[];
  for (let i=0;i<10;i++) {
    const y=8480+i*155, fromLeft=i%2===0;
    const ramp={x1:fromLeft?0:W,y1:y,x2:fromLeft?W*0.52:W*0.48,y2:y+90};
    z7Ramps.push(ramp); zigzagWalls.push(ramp);
  }
  for (let y=8400;y<10000;y+=90) {
    const off=(Math.floor(y/90)%2===0)?0:55;
    for (let x=40+off;x<W-40;x+=110) {
      const px=x+(Math.random()-0.5)*10, py=y+(Math.random()-0.5)*10;
      let ok=true;
      for (const w of z7Ramps) { const sdx=w.x2-w.x1,sdy=w.y2-w.y1,l2=sdx*sdx+sdy*sdy,t=Math.max(0,Math.min(1,((px-w.x1)*sdx+(py-w.y1)*sdy)/l2)); if(Math.hypot(px-w.x1-t*sdx,py-w.y1-t*sdy)<55){ok=false;break;} }
      if (ok) pegs.push({x:px,y:py});
    }
  }
  for (let i=0;i<10;i++) obstacles.push({x:Math.random()*(W-240),y:8450+i*155,w:180,h:14,dir:i%2===0?1:-1,speed:3.5+Math.random()*2});
  bouncePads.push({x:W*0.35,y:9200,w:120,h:10});
  bouncePads.push({x:W*0.65,y:9700,w:100,h:10});

  // ZONE 8: Sneeze Storm (y:10000-11400) - wall-to-wall zigzag walls + nose bumpers
  // NOTE: No sneeze zones here — they conflict with the zigzag walls and block marbles
  for (let i=0;i<10;i++) {
    const y=10060+i*140, fromLeft=i%2===0;
    zigzagWalls.push(fromLeft?{x1:0,y1:y,x2:W*0.55,y2:y+80}:{x1:W,y1:y,x2:W*0.45,y2:y+80});
  }
  [[W*0.15,10150],[W*0.82,10350],[W*0.15,10700],[W*0.82,10900],[W*0.5,11100],[W*0.15,11300],[W*0.82,11350]].forEach(([nx,ny],i)=>{
    noseBumpers.push({x:nx,y:ny,rx:38+(i%3)*7,ry:52+(i%4)*6,nostrilL:{dx:-13,dy:27},nostrilR:{dx:13,dy:27},phaseOffset:(i/7)*NOSE_CYCLE_MS,sniffRadius:130+(i%3)*20,sneezeForce:14+(i%4)*3});
  });
  for (let y=10050;y<11400;y+=140) for (let x=80;x<W-80;x+=180) pegs.push({x:x+(Math.random()-0.5)*20,y:y+(Math.random()-0.5)*20});
  bouncePads.push({x:W*0.3,y:10900,w:140,h:10});
  bouncePads.push({x:W*0.6,y:11200,w:140,h:10});

  // ZONE 9: Pinball Crab (y:11400-12800) - bumper diamonds + fast spinners
  [[W*0.2,11600],[W*0.5,11500],[W*0.8,11700],[W*0.35,11900],[W*0.65,11950],[W*0.15,12100],[W*0.5,12200],[W*0.85,12150]].forEach(([cx,cy])=>{
    [[0,-50],[50,0],[0,50],[-50,0]].forEach(([ox,oy])=>bumpers.push({x:cx+ox,y:cy+oy,radius:16}));
  });
  for (let i=0;i<14;i++) spinners.push({x:80+Math.random()*(W-160),y:11450+i*95,angle:Math.random()*Math.PI*2,speed:0.09+Math.random()*0.06,size:50});
  for (let i=0;i<6;i++) obstacles.push({x:Math.random()*(W-200),y:11500+i*220,w:180,h:13,dir:i%2===0?1:-1,speed:3+Math.random()*2});
  bouncePads.push({x:W*0.45,y:12500,w:150,h:10});

  // ZONE 10: Nostril Wormhole (y:12800-14200) - dense nostril portals + booger slow zones
  for (let i=0;i<16;i++) {
    const py=12850+i*85, fwd=Math.random()>0.4;
    nostrilPortals.push({x1:40+Math.random()*(W-80),y1:py,x2:40+Math.random()*(W-80),y2:fwd?Math.min(LEVEL_HEIGHT-100,py+300+Math.random()*600):Math.max(20,py-400-Math.random()*500),sendUp:!fwd,sendY:fwd?py+300:py-400});
  }
  [[0,12900,W*0.4,70],[W*0.55,13100,W*0.4,70],[0,13400,W*0.35,70],[W*0.6,13600,W*0.35,70]].forEach(([x,y,w,h])=>boogerSlimes.push({x,y,w,h,drip:Math.random()*Math.PI*2}));
  for (let y=12850;y<14200;y+=100) for (let x=70;x<W-70;x+=140) pegs.push({x:x+(Math.random()-0.5)*18,y:y+(Math.random()-0.5)*18});
  for (let i=0;i<6;i++) obstacles.push({x:Math.random()*(W-200),y:12900+i*230,w:160,h:13,dir:i%2===0?1:-1,speed:2.5+Math.random()*1.5});

  // ZONE 11: Tide Avalanche (y:14200-16000) - shrinking coral platforms + edge kill zones
  for (let i=0;i<20;i++) {
    const y=14280+i*88, w=Math.max(60,W*0.18-i*3);
    const col=i%4, xPos=[W*0.05,W*0.28,W*0.52,W*0.74][col];
    narrowGates.push({y,gapX:xPos,gapWidth:w,isPlatform:true});
    if (i%3!==0) { const c2=(col+2)%4, xPos2=[W*0.05,W*0.28,W*0.52,W*0.74][c2]; narrowGates.push({y:y+35,gapX:xPos2,gapWidth:w*0.8,isPlatform:true}); }
  }
  for (let i=0;i<10;i++) {
    killZones.push({x:0,y:14350+i*160,w:40,h:25,safeY:Math.max(20,14350+i*160-600)});
    killZones.push({x:W-40,y:14420+i*160,w:40,h:25,safeY:Math.max(20,14420+i*160-600)});
  }
  bouncePads.push({x:W*0.4,y:15200,w:150,h:10});
  bouncePads.push({x:W*0.65,y:15900,w:120,h:10});

  // ZONE 12: The Big Schnozzle (y:16000-18000) - max nose bumpers + sneeze gauntlet
  [[30,16200],[W-30,16400],[30,16800],[W-30,17000],[W/2,17200],[30,17500],[W-30,17700]].forEach(([x,y])=>gravityWells.push({x,y,strength:0.55}));
  for (let i=0;i<12;i++) obstacles.push({x:Math.random()*(W-220),y:16050+i*165,w:200,h:14,dir:i%2===0?1:-1,speed:4+Math.random()*2.5});
  [16200,16700,17100,17500,17900].forEach((sy,i)=>{
    sneezeZones.push({x:0,y:sy,w:W,h:30,dir:i%2===0?1:-1,strength:7+i*1.5,phase:Math.random()*Math.PI*2,speed:0.03+Math.random()*0.015});
  });
  [[W*0.2,16300],[W*0.7,16500],[W*0.15,16900],[W*0.8,17100],[W*0.4,17300],[W*0.6,17600],[W*0.25,17800],[W*0.75,17900]].forEach(([nx,ny],i)=>{
    noseBumpers.push({x:nx,y:ny,rx:42+(i%3)*8,ry:56+(i%4)*7,nostrilL:{dx:-15,dy:30},nostrilR:{dx:15,dy:30},phaseOffset:(i/8)*NOSE_CYCLE_MS,sniffRadius:150+(i%3)*25,sneezeForce:18+(i%4)*4});
  });
  for (let y=16050;y<18000;y+=120) for (let x=80;x<W-80;x+=160) pegs.push({x:x+(Math.random()-0.5)*20,y:y+(Math.random()-0.5)*20});
  bouncePads.push({x:W*0.3,y:17000,w:160,h:10});
  bouncePads.push({x:W*0.6,y:17600,w:160,h:10});

  // ZONE 13: Final Schnozzle Stretch (y:18000-20000) - diagonal ramps + max spinners + nose bumpers
  const finalRamps=[];
  for (let i=0;i<14;i++) {
    const y=18050+i*140, fromLeft=i%2===0;
    const ramp={x1:fromLeft?0:W,y1:y,x2:fromLeft?W*0.52:W*0.48,y2:y+100};
    finalRamps.push(ramp); zigzagWalls.push(ramp);
  }
  for (let i=0;i<14;i++) {
    const fromLeft=i%2===0;
    spinners.push({x:fromLeft?W*0.72:W*0.28,y:18100+i*140+50,angle:Math.random()*Math.PI*2,speed:0.09+Math.random()*0.05,size:45});
  }
  [[W*0.25,18200],[W*0.7,18400],[W*0.15,18700],[W*0.8,18900],[W*0.45,19100],[W*0.3,19400],[W*0.65,19600]].forEach(([nx,ny],i)=>{
    noseBumpers.push({x:nx,y:ny,rx:38+(i%3)*7,ry:52+(i%4)*6,nostrilL:{dx:-13,dy:27},nostrilR:{dx:13,dy:27},phaseOffset:(i/7)*NOSE_CYCLE_MS,sniffRadius:130+(i%3)*20,sneezeForce:16+(i%4)*3});
  });
  for (let i=0;i<14;i++) obstacles.push({x:Math.random()*(W-220),y:18060+i*140,w:200,h:14,dir:i%2===0?1:-1,speed:5+Math.random()*3});
  for (let y=18050;y<20000;y+=100) {
    const off=(Math.floor(y/100)%2===0)?0:70;
    for (let x=50+off;x<W-50;x+=130) {
      const px=x+(Math.random()-0.5)*12, py=y+(Math.random()-0.5)*12;
      let ok=true;
      for (const w of finalRamps) { const sdx=w.x2-w.x1,sdy=w.y2-w.y1,l2=sdx*sdx+sdy*sdy,t=Math.max(0,Math.min(1,((px-w.x1)*sdx+(py-w.y1)*sdy)/l2)); if(Math.hypot(px-w.x1-t*sdx,py-w.y1-t*sdy)<55){ok=false;break;} }
      if (ok) pegs.push({x:px,y:py});
    }
  }
  bouncePads.push({x:W*0.4,y:19000,w:160,h:10});
  bouncePads.push({x:W*0.2,y:19500,w:140,h:10});
  bouncePads.push({x:W*0.65,y:19800,w:140,h:10});

  // ── NEW EXCLUSIVE OBSTACLES ──────────────────────────────────────────────────

  // 🌊 TIDE WAVES — sweeping horizontal walls that cross the screen periodically
  // Scattered across all zones, each with different speed/direction/strength
  [
    [600,  0.00, 0.018, 1,  6],
    [1200, 0.33, 0.022, -1, 7],
    [2200, 0.10, 0.020, 1,  8],
    [3400, 0.55, 0.025, -1, 9],
    [4800, 0.20, 0.028, 1,  8],
    [6200, 0.70, 0.030, -1, 10],
    [7600, 0.40, 0.032, 1,  11],
    [9000, 0.15, 0.035, -1, 10],
    [10500,0.60, 0.030, 1,  9],
    [12000,0.80, 0.028, -1, 11],
    [13500,0.25, 0.033, 1,  12],
    [15000,0.50, 0.036, -1, 13],
    [16500,0.05, 0.040, 1,  14],
    [18000,0.75, 0.038, -1, 15],
    [19200,0.45, 0.042, 1,  16],
  ].forEach(([y, phase, speed, dir, strength]) => {
    tideWaves.push({ y, phase, speed, dir, strength, w: W * 0.55 });
  });

  // 🦀 CRAB CLAWS — pincer traps that open and snap shut
  [
    [W*0.25, 900],  [W*0.70, 1100],
    [W*0.15, 2400], [W*0.60, 2600],
    [W*0.35, 3800], [W*0.75, 4000],
    [W*0.20, 5200], [W*0.65, 5400],
    [W*0.40, 6600], [W*0.80, 6800],
    [W*0.10, 7900], [W*0.55, 8100],
    [W*0.30, 9300], [W*0.70, 9500],
    [W*0.45, 10800],[W*0.15, 11000],
    [W*0.60, 12200],[W*0.25, 12400],
    [W*0.50, 13700],[W*0.85, 13900],
    [W*0.20, 15100],[W*0.65, 15300],
    [W*0.35, 16700],[W*0.75, 16900],
    [W*0.10, 18200],[W*0.55, 18500],
    [W*0.40, 19300],
  ].forEach(([x, y], i) => {
    crabClaws.push({
      x, y,
      phase: (i / 27) * Math.PI * 2,
      speed: 0.025 + (i % 5) * 0.005,
      armLen: 55 + (i % 4) * 10,
      gap: 28 + (i % 3) * 8,
    });
  });

  // 🫧 BUBBLE LIFTS — columns of rising bubbles that push marbles upward
  [
    [W*0.08,  500,  60, 200],
    [W*0.88,  800,  60, 200],
    [W*0.08, 1900,  60, 250],
    [W*0.88, 2100,  60, 250],
    [W*0.50, 3200,  70, 300],
    [W*0.08, 4600,  60, 250],
    [W*0.88, 4900,  60, 250],
    [W*0.30, 6000,  70, 300],
    [W*0.70, 6300,  70, 300],
    [W*0.08, 7400,  60, 200],
    [W*0.88, 7700,  60, 200],
    [W*0.50, 8800,  80, 350],
    [W*0.15, 10200, 60, 250],
    [W*0.85, 10500, 60, 250],
    [W*0.40, 11700, 70, 300],
    [W*0.60, 12000, 70, 300],
    [W*0.08, 13200, 60, 250],
    [W*0.88, 13500, 60, 250],
    [W*0.50, 14700, 80, 350],
    [W*0.20, 15800, 60, 250],
    [W*0.80, 16100, 60, 250],
    [W*0.35, 17300, 70, 300],
    [W*0.65, 17600, 70, 300],
    [W*0.50, 18800, 80, 350],
    [W*0.15, 19400, 60, 250],
    [W*0.85, 19600, 60, 250],
  ].forEach(([x, y, w, h]) => {
    bubbleLifts.push({ x, y, w, h, strength: 0.55 + Math.random() * 0.25 });
  });

  // ⚓ ANCHOR CHAINS — swinging pendulum chains
  [
    [W*0.20, 1600], [W*0.75, 1800],
    [W*0.40, 3000], [W*0.60, 3200],
    [W*0.15, 4400], [W*0.85, 4600],
    [W*0.35, 5800], [W*0.65, 6000],
    [W*0.25, 7200], [W*0.75, 7400],
    [W*0.50, 8600],
    [W*0.20, 9800], [W*0.80, 10000],
    [W*0.40, 11200],[W*0.60, 11400],
    [W*0.30, 12600],[W*0.70, 12800],
    [W*0.15, 14000],[W*0.85, 14200],
    [W*0.45, 15500],[W*0.55, 15700],
    [W*0.25, 16800],[W*0.75, 17000],
    // Zone 13 (y:18000+) — no chains, they block the final stretch
  ].forEach(([x, y], i) => {
    anchorChains.push({
      x, y,
      len: 90 + (i % 4) * 20,
      angle: (i % 2 === 0 ? 0.4 : -0.4),
      speed: 0.018 + (i % 5) * 0.004,
      phase: (i / 26) * Math.PI * 2,
    });
  });

} // end generateBahamasLevel


// ─── Start ────────────────────────────────────────────────────────────────────
function startRace() {
  if (players.length === 0) {
    showWinner("Add players first!");
    return;
  }
  generateLevel();
  players.forEach((p, i) => {
    const spacing = canvas.width / 10;
    p.x = 40 + (i % 9) * spacing + (Math.random() - 0.5) * 10;
    p.y = 20;
    p.vx = (Math.random() - 0.5) * 2;
    p.vy = 0;
    p.finished = false;
    p.teleportCooldown = 0;
    p.trail = [];
    p.stuckTimer = 0;
    p.lastX = p.x;
    p.lastY = p.y;
    p.prevX = p.x;
    p.prevY = p.y;
    p.stuckDist = 0;
    p.rank = 0;
    p.finishTime = null;
    p.activeBuff = null;
    p.buffTimer = 0;
    p.magnetTargets = [];
  });
  leaderboard = [];
  finalRankings = [];
  raceFinished = false;
  raceStarted = true;
  winner = null;
  spectateIndex = -1;
  spectateTarget = null;
  commentaryFeed = [];
  prevRanks = {};
  buffs = [];
  hideWinner();
  document.getElementById("ui-title").style.display = "none";
  document.getElementById("player-list-wrap").style.display = "none";
  document.getElementById("hint").style.display = "none";
  document.getElementById("ui").classList.add("racing");
  // Lock map selector during race
  document.querySelectorAll('.btn-map').forEach(b => { b.disabled = true; b.style.opacity = '0.35'; b.style.pointerEvents = 'none'; });
}

// ─── Reset ────────────────────────────────────────────────────────────────────
function resetRace() {
  players = [];
  raceStarted = false;
  winner = null;
  leaderboard = [];
  finalRankings = [];
  raceFinished = false;
  cameraY = 0;
  spectateIndex = -1;
  spectateTarget = null;
  buffs = [];
  updatePlayerList();
  hideWinner();
  document.getElementById("ui-title").style.display = "";
  document.getElementById("player-list-wrap").style.display = "";
  document.getElementById("hint").style.display = "";
  document.getElementById("ui").classList.remove("racing");
  // Unlock map selector after reset
  document.querySelectorAll('.btn-map').forEach(b => { b.disabled = false; b.style.opacity = ''; b.style.pointerEvents = ''; });
}

function showWinner(name) {
  // Only show mid-race winner toast for 1st finisher; final screen shown later
  document.getElementById("winner-name").textContent = name;
  document.getElementById("winner-sub").textContent = "WINS THE RACE";
  // Clear any scroll list from a previous final rankings display
  const scrollEl = document.getElementById("winner-rankings-scroll");
  if (scrollEl) scrollEl.remove();
  const el = document.getElementById("winner-banner");
  el.style.display = "";
  el.classList.add("visible");
  // Auto-hide after 4s if race still going
  setTimeout(() => {
    if (!raceFinished) hideWinner();
  }, 4000);
}

function showFinalRankings() {
  const el = document.getElementById("winner-banner");
  const nameEl = document.getElementById("winner-name");
  const subEl = document.getElementById("winner-sub");
  const medals = ["🥇","🥈","🥉"];
  const rows = finalRankings.map((p,i) =>
    `<div style="font-size:${i===0?'24px':'16px'};color:${i===0?'#ffd700':i===1?'#ccc':i===2?'#cd7f32':'rgba(255,255,255,0.7)'};margin:4px 0;white-space:nowrap">
      ${medals[i]||`#${i+1}`} ${p.name}
    </div>`
  ).join("");
  nameEl.innerHTML = `🏁 FINAL RANKINGS`;
  subEl.textContent = "";
  // Inject scrollable list into dedicated scroll container
  let scrollEl = document.getElementById("winner-rankings-scroll");
  if (!scrollEl) {
    scrollEl = document.createElement("div");
    scrollEl.id = "winner-rankings-scroll";
    el.appendChild(scrollEl);
  }
  scrollEl.innerHTML = `<div style="font-size:14px;margin-top:4px">${rows}</div>`;
  el.style.display = "";
  el.classList.add("visible");
}

function hideWinner() {
  const el = document.getElementById("winner-banner");
  el.classList.remove("visible");
}

function updatePlayerList() {
  const el = document.getElementById("player-list");
  el.innerHTML = players.map(p =>
    `<div style="display:flex;align-items:center;gap:6px;padding:3px 4px;border-radius:3px;background:rgba(255,255,255,0.03)">
       <span style="width:6px;height:6px;border-radius:50%;background:${p.color};box-shadow:0 0 5px ${p.color};flex-shrink:0;display:inline-block"></span>
       <span style="color:rgba(255,255,255,0.85)">${p.name}</span>
     </div>`
  ).join("");
}

// ─── Physics ──────────────────────────────────────────────────────────────────
const STUCK_FRAMES = 180; // 3 seconds at 60fps

function update() {
  if (!raceStarted) return;

  // Move obstacles — bounce off walls cleanly
  obstacles.forEach(o => {
    o.x += o.dir * o.speed;
    if (o.x <= 0) { o.x = 0; o.dir = 1; }
    if (o.x + o.w >= canvas.width) { o.x = canvas.width - o.w; o.dir = -1; }
  });

  // Rotate spinners
  spinners.forEach(s => { s.angle += s.speed; });

  // ── Compute live ranks (by progress = highest y wins) ─────────────────────
  const sorted = [...players].sort((a, b) => {
    if (a.finished && !b.finished) return -1;
    if (!a.finished && b.finished) return 1;
    if (a.finished && b.finished) return (a.finishTime || 0) - (b.finishTime || 0);
    return b.y - a.y;
  });
  sorted.forEach((p, i) => {
    const newRank = i + 1;
    if (prevRanks[p.name] && prevRanks[p.name] > newRank && newRank === 1 && !p.finished) {
      addCommentary(`⚡ ${p.name} takes the LEAD!`, p.color);
    } else if (prevRanks[p.name] && prevRanks[p.name] > newRank + 1 && !p.finished && Math.random() < 0.15) {
      addCommentary(`📈 ${p.name} overtakes ${sorted[i-1]?.name || ''}!`, p.color);
    }
    prevRanks[p.name] = newRank;
    p.rank = newRank;
  });

  let frameTime = Date.now();

  players.forEach(p => {
    if (p.finished) return;

    // Trail
    p.trail.push({ x: p.x, y: p.y });
    if (p.trail.length > 12) p.trail.shift();

    // ── Stuck detection — 3-second rolling window ─────────────────────────────
    // Only teleport when truly frozen: no downward progress AND physically still.
    // Slow-rolling marbles are never falsely teleported.
    p.stuckTimer++;
    p.stuckDist = (p.stuckDist || 0) + Math.hypot(p.x - (p.prevX || p.x), p.y - (p.prevY || p.y));
    p.prevX = p.x; p.prevY = p.y;

    if (p.stuckTimer % 300 === 0) { // evaluate every 5 seconds
      const movedDown  = p.y - (p.lastY || p.y);
      const totalPath  = p.stuckDist;
      const frozen     = totalPath < 20;                      // barely moved at all
      const thrashing  = totalPath > 80 && movedDown < 4;    // lots of motion, zero progress
      if (movedDown < 5 && (frozen || thrashing)) {
        p.x  = 60 + Math.random() * (canvas.width - 120);
        p.y  = Math.max(20, p.y - 180 - Math.random() * 80);
        p.vx = (Math.random() - 0.5) * 3;
        p.vy = 1;
        p.trail = [];
        addCommentary(`⚠️ ${p.name} unstuck!`, '#ffaa00');
      }
      p.lastX   = p.x; p.lastY = p.y;
      p.stuckDist = 0;
    }

    // ── Apply active buff effects ─────────────────────────────────────────────
    if (p.activeBuff) {
      const now2 = Date.now();
      if (now2 > p.activeBuff.expires) {
        // Restore radius if shrink wore off
        if (p.activeBuff.type === 'shrink') p.radius = 10;
        p.activeBuff = null;
      } else {
        switch (p.activeBuff.type) {
          case 'speed':
            p.vx *= 1.04; p.vy *= 1.04; // ongoing speed multiplier
            break;
          case 'boost':
            p.vy += 0.18; // extra downward pull
            break;
          case 'slow':
            p.vx *= 0.96; p.vy *= 0.96;
            break;
          case 'gravity': {
            // Magnetic pull — suck nearby marbles toward this one
            players.forEach(other => {
              if (other === p || other.finished) return;
              const ddx = p.x - other.x, ddy = p.y - other.y;
              const ddist = Math.hypot(ddx, ddy);
              if (ddist < 200 && ddist > 0) {
                const force = 0.35 * (1 - ddist / 200);
                other.vx += (ddx / ddist) * force;
                other.vy += (ddy / ddist) * force;
              }
            });
            break;
          }
          case 'ghost':
            // Ghost: skip peg/bumper/wall collisions — handled by flagging below
            break;
          case 'shrink':
            // Radius already set to 5 on pickup
            break;
        }
      }
    }

    // ── Gravity ──────────────────────────────────────────────────────────────
    p.vy += 0.22;

    // Light air resistance preserving momentum
    p.vx *= 0.998;
    p.vy *= 0.998;

    // Speed cap — prevent tunnelling through thin obstacles
    const MAX_SPEED = 15;
    const spd = Math.hypot(p.vx, p.vy);
    if (spd > MAX_SPEED) {
      p.vx = (p.vx / spd) * MAX_SPEED;
      p.vy = (p.vy / spd) * MAX_SPEED;
    }

    // Sub-step integration to reduce tunnelling
    const STEPS = 3;
    for (let step = 0; step < STEPS; step++) {
      p.x += p.vx / STEPS;
      p.y += p.vy / STEPS;

      // Wall bounce
      if (p.x - p.radius < 0) { p.x = p.radius; p.vx = Math.abs(p.vx) * 0.72; }
      if (p.x + p.radius > canvas.width) { p.x = canvas.width - p.radius; p.vx = -Math.abs(p.vx) * 0.72; }

      // 🔵 Pegs
      if (!p.activeBuff || p.activeBuff.type !== 'ghost') pegs.forEach(peg => {
        const dx = p.x - peg.x, dy = p.y - peg.y;
        const dist = Math.hypot(dx, dy);
        const minDist = p.radius + 5;
        if (dist < minDist && dist > 0) {
          const nx = dx / dist, ny = dy / dist;
          const dot = p.vx * nx + p.vy * ny;
          if (dot < 0) {
            p.vx -= (1 + 0.65) * dot * nx;
            p.vy -= (1 + 0.65) * dot * ny;
          }
          // Positional correction to prevent sticking
          p.x = peg.x + nx * (minDist + 1.5);
          p.y = peg.y + ny * (minDist + 1.5);
        }
      });

      // 🟠 Bumpers
      if (!p.activeBuff || p.activeBuff.type !== 'ghost') bumpers.forEach(b => {
        const dx = p.x - b.x, dy = p.y - b.y;
        const dist = Math.hypot(dx, dy);
        const minDist = p.radius + b.radius;
        if (dist < minDist && dist > 0) {
          const nx = dx / dist, ny = dy / dist;
          // Override velocity to guaranteed outward direction — no additive drift
          const spd = Math.max(7, Math.hypot(p.vx, p.vy) * 0.8);
          p.vx = nx * spd;
          p.vy = ny * spd;
          // Hard position correction outside bumper
          p.x = b.x + nx * (minDist + 4);
          p.y = b.y + ny * (minDist + 4);
        }
      });

      // 🔴 Moving bars — correct side detection to avoid tunnelling
      obstacles.forEach(o => {
        const left = o.x, right = o.x + o.w;
        const top = o.y, bottom = o.y + o.h;
        if (p.x + p.radius > left && p.x - p.radius < right &&
            p.y + p.radius > top && p.y - p.radius < bottom) {
          // Compute overlap on each axis
          const overlapLeft   = (p.x + p.radius) - left;
          const overlapRight  = right - (p.x - p.radius);
          const overlapTop    = (p.y + p.radius) - top;
          const overlapBottom = bottom - (p.y - p.radius);
          const minOverlap = Math.min(overlapLeft, overlapRight, overlapTop, overlapBottom);
          if (minOverlap === overlapTop) {
            p.y = top - p.radius;
            p.vy = -Math.abs(p.vy) * 0.62;
            p.vx += o.dir * o.speed * 0.3;
          } else if (minOverlap === overlapBottom) {
            p.y = bottom + p.radius;
            p.vy = Math.abs(p.vy) * 0.45;
          } else if (minOverlap === overlapLeft) {
            p.x = left - p.radius;
            p.vx = -Math.abs(p.vx) * 0.5;
          } else {
            p.x = right + p.radius;
            p.vx = Math.abs(p.vx) * 0.5;
          }
        }
      });

      // 🌀 Spinners — arm collision
      spinners.forEach(s => {
        for (let arm = 0; arm < 2; arm++) {
          const ang = s.angle + arm * Math.PI / 2;
          // Two orthogonal arms
          for (let sign = -1; sign <= 1; sign += 2) {
            const ax = s.x + Math.cos(ang) * sign * s.size;
            const ay = s.y + Math.sin(ang) * sign * s.size;
            // Closest point on arm segment from center
            const sdx = ax - s.x, sdy = ay - s.y;
            const len2 = sdx*sdx + sdy*sdy;
            const t = Math.max(0, Math.min(1, ((p.x-s.x)*sdx + (p.y-s.y)*sdy)/len2));
            const cx = s.x + t*sdx, cy = s.y + t*sdy;
            const dx = p.x - cx, dy = p.y - cy;
            const dist = Math.hypot(dx, dy);
            if (dist < p.radius + 4 && dist > 0) {
              const nx = dx/dist, ny = dy/dist;
              const dot = p.vx*nx + p.vy*ny;
              if (dot < 0) {
                p.vx -= (1 + 0.7) * dot * nx;
                p.vy -= (1 + 0.7) * dot * ny;
              }
              p.x = cx + nx * (p.radius + 5);
              p.y = cy + ny * (p.radius + 5);
            }
          }
        }
      });

      // 🟪 Bounce pads
      bouncePads.forEach(b => {
        if (p.x + p.radius > b.x && p.x - p.radius < b.x + b.w &&
            p.y + p.radius > b.y && p.y - p.radius < b.y + b.h && p.vy > 0) {
          p.y = b.y - p.radius;
          p.vy = Math.min(-12, -Math.abs(p.vy) * 1.7);
        }
      });

      // 🟩 Platforms — one-way (land from top only)
      narrowGates.forEach(g => {
        if (p.vy > 0 &&
            p.x + p.radius > g.gapX && p.x - p.radius < g.gapX + g.gapWidth &&
            p.y + p.radius > g.y && p.y - p.radius < g.y + 14) {
          p.y = g.y - p.radius;
          // If incoming speed is low, just rest on the platform (no bounce)
          // This kills the infinite micro-bounce loop
          if (p.vy < 3) {
            p.vy = 0;
            // Small sideways nudge so marble slides off edge naturally
            if (Math.abs(p.vx) < 0.5) p.vx = (Math.random() > 0.5 ? 1 : -1) * 1.5;
          } else {
            p.vy = -p.vy * 0.42;
          }
          p.vx += (Math.random() - 0.5) * 0.8;
        }
      });

      // 📐 Zigzag walls — collision radius matches drawn lineWidth (14px = 7 each side)
      zigzagWalls.forEach(w => {
        const bx1 = Math.min(w.x1,w.x2) - p.radius - 14;
        const bx2 = Math.max(w.x1,w.x2) + p.radius + 14;
        const by1 = Math.min(w.y1,w.y2) - p.radius - 14;
        const by2 = Math.max(w.y1,w.y2) + p.radius + 14;
        if (p.x < bx1 || p.x > bx2 || p.y < by1 || p.y > by2) return;

        const segDx = w.x2 - w.x1, segDy = w.y2 - w.y1;
        const segLen2 = segDx*segDx + segDy*segDy;
        const t = Math.max(0, Math.min(1, ((p.x-w.x1)*segDx + (p.y-w.y1)*segDy) / segLen2));
        const cx = w.x1 + t*segDx, cy = w.y1 + t*segDy;
        const dx = p.x - cx, dy = p.y - cy;
        const dist = Math.hypot(dx, dy);
        const WALL_R = p.radius + 7; // half of lineWidth 14

        if (dist < WALL_R && dist > 0) {
          const nx = dx/dist, ny = dy/dist;

          // Reflect velocity off wall normal
          const dot = p.vx*nx + p.vy*ny;
          if (dot < 0) {
            p.vx -= (1 + 0.5) * dot * nx;
            p.vy -= (1 + 0.5) * dot * ny;
          }

          // Hard push out — double the overlap so marble never clips back in
          const overlap = WALL_R - dist;
          p.x += nx * (overlap + 1);
          p.y += ny * (overlap + 1);

          // Ensure minimum outward speed so marble never lingers on wall
          const outSpd = p.vx*nx + p.vy*ny;
          if (outSpd < 2) {
            p.vx += nx * (2 - outSpd);
            p.vy += ny * (2 - outSpd);
          }
        }
      });
    } // end sub-steps

    // 🌐 Gravity wells
    gravityWells.forEach(w => {
      const dx=w.x-p.x, dy=w.y-p.y;
      const dist=Math.hypot(dx,dy);
      if (dist < 200 && dist > 20) {
        const force=w.strength*(1-dist/200);
        p.vx+=(dx/dist)*force;
        p.vy+=(dy/dist)*force*0.25;
      }
    });

    // 🧊 Slow zones
    slowZones.forEach(s => {
      if (p.x>s.x && p.x<s.x+s.w && p.y>s.y && p.y<s.y+s.h) {
        p.vx *= 0.84;
        p.vy *= 0.84;
      }
    });

    // 💀 Kill zones
    killZones.forEach(k => {
      if (p.x>k.x && p.x<k.x+k.w && p.y>k.y && p.y<k.y+k.h) {
        p.y=k.safeY;
        p.x=60+Math.random()*(canvas.width-120);
        p.vy=0; p.vx=(Math.random()-0.5)*2;
        p.trail=[];
        p.stuckTimer=0;
        p.lastX=p.x; p.lastY=p.y;
        if (Math.random() < 0.4) addCommentary(`☠️ ${p.name} hit a kill zone!`, '#ff4444');
      }
    });

    // 🕳️ Portals
    if (p.teleportCooldown > 0) p.teleportCooldown--;
    if (p.teleportCooldown === 0) {
      portals.forEach(po => {
        if (Math.hypot(p.x-po.x1, p.y-po.y1) < 16) {
          const wentBack = po.y2 < p.y;
          p.x=po.x2; p.y=po.y2;
          p.vy *= 0.3;
          p.teleportCooldown=90;
          p.trail=[];
          p.stuckTimer=0;
          p.lastX=p.x; p.lastY=p.y;
          if (Math.random() < 0.35) {
            addCommentary(wentBack ? `🔴 ${p.name} warped BACK!` : `🟣 ${p.name} portaled forward!`, wentBack ? '#ff4488' : '#8844ff');
          }
        }
      });
    }

    // ══════════════════════════════════════════════════
    // 🏝️ BAHAMAS MAP PHYSICS
    // ══════════════════════════════════════════════════
    if (currentMap === 'bahamas') {
      const nowMs = Date.now();

      // 👃 NOSE BUMPERS — sniff/charge/sneeze state machine
      noseBumpers.forEach(nb => {
        const phase = ((nowMs + nb.phaseOffset) % NOSE_CYCLE_MS) / NOSE_CYCLE_MS;

        if (phase < NOSE_SNIFF_END) {
          // SNIFFING — suck marbles toward the nose center
          const sniffStrength = Math.sin((phase / NOSE_SNIFF_END) * Math.PI) * 0.55;
          const dx = nb.x - p.x, dy = nb.y - p.y;
          const dist = Math.hypot(dx, dy);
          if (dist < nb.sniffRadius && dist > 5) {
            p.vx += (dx / dist) * sniffStrength;
            p.vy += (dy / dist) * sniffStrength;
            if (Math.random() < 0.008) addCommentary(`👃 ${p.name} getting SNIFFED in!`, '#ffccaa');
          }

        } else if (phase < NOSE_CHARGE_END) {
          // CHARGING — static ellipse collision only (nose is tensing up, no pull)
          // (collision handled below)

        } else if (phase < NOSE_SNEEZE_END) {
          // SNEEZING — blast everything nearby OUTWARD hard
          const sneezeFrac = (phase - NOSE_CHARGE_END) / (NOSE_SNEEZE_END - NOSE_CHARGE_END);
          const blastPower = nb.sneezeForce * Math.pow(1 - sneezeFrac, 0.5);
          const dx = p.x - nb.x, dy = p.y - nb.y;
          const dist = Math.hypot(dx, dy);
          if (dist < nb.sniffRadius * 1.4 && dist > 1) {
            p.vx += (dx / dist) * blastPower * 0.15;
            p.vy += (dy / dist) * blastPower * 0.12;
            if (blastPower > 8 && Math.random() < 0.05) addCommentary(`🤧 ${p.name} BLASTED by the schnozzle!`, '#aaffaa');
          }
        }
        // IDLE phase: no forces

        // Ellipse solid collision (always active regardless of phase)
        const edx = (p.x - nb.x) / nb.rx;
        const edy = (p.y - nb.y) / nb.ry;
        const d = Math.sqrt(edx*edx + edy*edy);
        const minD = (p.radius / Math.min(nb.rx, nb.ry)) + 1.0;
        if (d < minD && d > 0) {
          const nx = edx / d / nb.rx;
          const ny = edy / d / nb.ry;
          const nLen = Math.hypot(nx, ny);
          const nnx = nx / nLen, nny = ny / nLen;
          const speed = Math.max(8, Math.hypot(p.vx, p.vy));
          p.vx = nnx * speed;
          p.vy = nny * speed * 0.5;
          const ovScale = (minD - d) / d;
          p.x += edx * nb.rx * ovScale;
          p.y += edy * nb.ry * ovScale;
        }
      });

      // 🤧 SNEEZE ZONES — oscillating horizontal blast
      sneezeZones.forEach(sz => {
        if (p.x > sz.x && p.x < sz.x + sz.w && p.y > sz.y && p.y < sz.y + sz.h) {
          const blast = sz.dir * sz.strength * (0.5 + 0.5 * Math.sin(Date.now() * sz.speed + sz.phase));
          p.vx += blast;
          if (Math.abs(blast) > 3 && Math.random() < 0.05) addCommentary(`🤧 ${p.name} got SNEEZED ON!`, '#ccffcc');
        }
      });

      // 👃 NOSTRIL PORTALS
      if (p.teleportCooldown === 0) {
        nostrilPortals.forEach(np => {
          if (Math.hypot(p.x - np.x1, p.y - np.y1) < 18) {
            p.x = np.x2; p.y = np.y2;
            p.vy *= 0.3;
            p.teleportCooldown = 90;
            p.trail = [];
            p.stuckTimer = 0;
            p.lastX = p.x; p.lastY = p.y;
            addCommentary(np.sendUp ? `👃 ${p.name} got SNIFFED back up!` : `👃 ${p.name} blasted out the OTHER nostril!`, '#88ffaa');
          }
        });
      }

      // 🟢 BOOGER SLIMES — slow + goo pull
      boogerSlimes.forEach(bs => {
        if (p.x > bs.x && p.x < bs.x + bs.w && p.y > bs.y && p.y < bs.y + bs.h) {
          p.vx *= 0.80;
          p.vy *= 0.88;
          p.vy += 0.5;
          if (Math.random() < 0.02) addCommentary(`🟢 ${p.name} is stuck in BOOGER!`, '#88ff88');
        }
      });

      // 🌊 TIDE WAVES — sweeping horizontal wall that pushes marbles
      const nowMs2 = Date.now();
      tideWaves.forEach(tw => {
        tw.phase += tw.speed * 0.016; // advance phase each frame
        // Wave x position oscillates across the screen
        const waveX = ((tw.dir > 0 ? tw.phase % 1 : 1 - (tw.phase % 1))) * (canvas.width + tw.w) - tw.w;
        const waveRight = waveX + tw.w;
        const waveTop = tw.y - 14;
        const waveBot = tw.y + 14;
        // Push marble if overlapping
        if (p.x + p.radius > waveX && p.x - p.radius < waveRight &&
            p.y + p.radius > waveTop && p.y - p.radius < waveBot) {
          // Resolve: push out of wave in the direction of travel
          const overlapTop    = (p.y + p.radius) - waveTop;
          const overlapBottom = waveBot - (p.y - p.radius);
          const overlapLeft   = (p.x + p.radius) - waveX;
          const overlapRight  = waveRight - (p.x - p.radius);
          const minOv = Math.min(overlapTop, overlapBottom, overlapLeft, overlapRight);
          if (minOv === overlapTop) {
            p.y = waveTop - p.radius;
            p.vy = -Math.abs(p.vy) * 0.6;
            p.vx += tw.dir * tw.strength * 0.4;
          } else if (minOv === overlapBottom) {
            p.y = waveBot + p.radius;
            p.vy = Math.abs(p.vy) * 0.4;
          } else if (minOv === overlapLeft) {
            p.x = waveX - p.radius;
            p.vx = -Math.abs(p.vx) * 0.5;
            p.vx += tw.dir * tw.strength * 0.6;
          } else {
            p.x = waveRight + p.radius;
            p.vx = Math.abs(p.vx) * 0.5;
            p.vx += tw.dir * tw.strength * 0.6;
          }
          if (Math.random() < 0.04) addCommentary(`🌊 ${p.name} hit by a TIDE WAVE!`, '#44aaff');
        }
      });

      // 🦀 CRAB CLAWS — pincer collision
      crabClaws.forEach(cc => {
        const t = Date.now();
        const openAng = Math.abs(Math.sin((t * cc.speed + cc.phase)));
        const maxOpen = Math.PI * 0.55;
        const ang = openAng * maxOpen; // 0 = closed, maxOpen = wide open
        // Two arms: upper-left and upper-right
        for (let side = -1; side <= 1; side += 2) {
          const armAng = (side > 0 ? -Math.PI * 0.5 + ang : -Math.PI * 0.5 - ang);
          const tipX = cc.x + Math.cos(armAng) * cc.armLen * side;
          const tipY = cc.y + Math.sin(armAng) * cc.armLen;
          // Segment collision: pivot (cc.x, cc.y) → tip
          const sdx = tipX - cc.x, sdy = tipY - cc.y;
          const slen2 = sdx*sdx + sdy*sdy;
          const tParam = Math.max(0, Math.min(1, ((p.x-cc.x)*sdx + (p.y-cc.y)*sdy) / slen2));
          const cx2 = cc.x + tParam*sdx, cy2 = cc.y + tParam*sdy;
          const dx = p.x - cx2, dy = p.y - cy2;
          const dist = Math.hypot(dx, dy);
          const ARM_R = p.radius + 8;
          if (dist < ARM_R && dist > 0) {
            const nx = dx/dist, ny = dy/dist;
            const dot = p.vx*nx + p.vy*ny;
            if (dot < 0) {
              p.vx -= (1 + 0.7) * dot * nx;
              p.vy -= (1 + 0.7) * dot * ny;
            }
            p.x = cx2 + nx * (ARM_R + 2);
            p.y = cy2 + ny * (ARM_R + 2);
            // If claws nearly closed, extra outward blast
            if (ang < 0.15 && Math.random() < 0.08) {
              p.vx += nx * 8;
              p.vy += ny * 8;
              addCommentary(`🦀 ${p.name} got PINCHED by a crab!`, '#ff8844');
            }
          }
        }
      });

      // 🫧 BUBBLE LIFTS — push marbles upward when inside column
      bubbleLifts.forEach(bl => {
        if (p.x > bl.x && p.x < bl.x + bl.w && p.y > bl.y && p.y < bl.y + bl.h) {
          p.vy -= bl.strength;
          p.vx *= 0.96; // slight horizontal damping inside column
          if (Math.random() < 0.015) addCommentary(`🫧 ${p.name} riding a BUBBLE LIFT!`, '#aaddff');
        }
      });

      // ⚓ ANCHOR CHAINS — swinging pendulum collision
      anchorChains.forEach(ac => {
        ac.angle = Math.sin(Date.now() * ac.speed + ac.phase) * 0.9;
        const links = 6;
        for (let li = 1; li <= links; li++) {
          const frac = li / links;
          const lx = ac.x + Math.sin(ac.angle) * ac.len * frac;
          const ly = ac.y + Math.cos(ac.angle) * ac.len * frac;
          const dx = p.x - lx, dy = p.y - ly;
          const dist = Math.hypot(dx, dy);
          const LINK_R = p.radius + 10;
          if (dist < LINK_R && dist > 0) {
            const nx = dx/dist, ny = dy/dist;
            const dot = p.vx*nx + p.vy*ny;
            if (dot < 0) {
              p.vx -= (1 + 0.65) * dot * nx;
              p.vy -= (1 + 0.65) * dot * ny;
            }
            p.x = lx + nx * (LINK_R + 2);
            p.y = ly + ny * (LINK_R + 2);
            if (Math.random() < 0.03) addCommentary(`⚓ ${p.name} tangled in an ANCHOR CHAIN!`, '#aabbcc');
          }
        }
      });
    }

    // 🎁 Buff pickups
    const now3 = Date.now();
    buffs = buffs.filter(bf => now3 - bf.born < BUFF_LIFETIME); // expire old
    buffs.forEach((bf, bi) => {
      if (Math.hypot(p.x - bf.x, p.y - bf.y) < p.radius + BUFF_RADIUS) {
        // Apply buff to player
        const def = BUFF_TYPES.find(d => d.type === bf.type);
        p.activeBuff = { type: bf.type, expires: now3 + BUFF_DURATION };
        if (bf.type === 'shrink') p.radius = 5;
        if (bf.type === 'shrink' || bf.type === 'speed' || bf.type === 'boost') {
          // restore radius after duration for shrink
        }
        buffs.splice(bi, 1);
        addCommentary(`${def.icon} ${p.name} got ${def.label}!`, def.color);
      }
    });

    // 🏆 Finish line
    if (p.y > LEVEL_HEIGHT - 20 && !p.finished) {
      p.finished = true;
      p.finishTime = frameTime;
      const place = finalRankings.length + 1;
      finalRankings.push({ name: p.name, color: p.color, place });
      leaderboard.push(p.name);
      if (!winner) {
        winner = p.name;
        addCommentary(`🏆 ${p.name} crosses the finish line FIRST!`, p.color);
        showWinner(winner);
      } else {
        const medals = ['🥇','🥈','🥉'];
        addCommentary(`${medals[place-1] || `#${place}`} ${p.name} finishes!`, p.color);
      }
      updatePlayerList();
    }
  });

  // ── Marble-to-marble collisions ───────────────────────────────────────────
  for (let i = 0; i < players.length; i++) {
    const a = players[i];
    if (a.finished) continue;
    for (let j = i + 1; j < players.length; j++) {
      const b = players[j];
      if (b.finished) continue;
      const dx = b.x - a.x, dy = b.y - a.y;
      const dist = Math.hypot(dx, dy);
      const minDist = a.radius + b.radius;
      if (dist < minDist && dist > 0) {
        const nx = dx / dist, ny = dy / dist;
        // Relative velocity along normal
        const dvx = b.vx - a.vx, dvy = b.vy - a.vy;
        const dvn = dvx * nx + dvy * ny;
        if (dvn < 0) { // approaching
          const restitution = 0.75;
          const impulse = -(1 + restitution) * dvn / 2; // equal mass
          a.vx -= impulse * nx;
          a.vy -= impulse * ny;
          b.vx += impulse * nx;
          b.vy += impulse * ny;
          // Commentary on hard hits
          if (Math.abs(impulse) > 5 && Math.random() < 0.3) {
            addCommentary(`💥 ${a.name} crashes into ${b.name}!`, '#ff8844');
          }
        }
        // Positional separation
        const overlap = (minDist - dist) / 2;
        a.x -= nx * overlap; a.y -= ny * overlap;
        b.x += nx * overlap; b.y += ny * overlap;
      }
    }
  }

  // ── Spawn buffs periodically ──────────────────────────────────────────────
  if (raceStarted && !raceFinished) {
    const tick = Math.floor(Date.now() / (BUFF_SPAWN_INTERVAL * 16.67));
    if (!update._lastBuffTick || update._lastBuffTick !== tick) {
      update._lastBuffTick = tick;
      if (buffs.length < 8) {
        // Spawn near camera area so players can actually reach it
        const spawnY = cameraY + 100 + Math.random() * (canvas.height - 200);
        const def = BUFF_TYPES[Math.floor(Math.random() * BUFF_TYPES.length)];
        buffs.push({
          x: 60 + Math.random() * (canvas.width - 120),
          y: spawnY,
          type: def.type,
          born: Date.now(),
          pulsePhase: Math.random() * Math.PI * 2
        });
      }
    }
  }

  // ── Check if ALL players finished ─────────────────────────────────────────
  if (!raceFinished && players.length > 0 && players.every(p => p.finished)) {
    raceFinished = true;
    raceStarted = false;
    showFinalRankings();
  }

  // ── Camera: follow spectate target or leader ───────────────────────────────
  let camTarget = null;
  if (spectateIndex >= 0 && spectateIndex < players.length) {
    camTarget = players[spectateIndex];
  } else {
    const active = players.filter(p => !p.finished);
    const pool = active.length > 0 ? active : players;
    if (pool.length > 0) camTarget = pool.reduce((a,b) => a.y > b.y ? a : b, pool[0]);
  }
  if (camTarget) {
    const target = camTarget.y - canvas.height / 2;
    cameraY += (target - cameraY) * 0.08;
    cameraY = Math.max(0, Math.min(LEVEL_HEIGHT - canvas.height, cameraY));
  }
}

// ─── Draw ─────────────────────────────────────────────────────────────────────
function getZoneColor(y) {
  if (y < 1400)  return "#0a0a1a";
  if (y < 2800)  return "#0d0a1a";
  if (y < 4200)  return "#0a1a0a";
  if (y < 5600)  return "#1a0a0a";
  if (y < 7000)  return "#0a0e1a";
  if (y < 8400)  return "#1a0a0e";
  if (y < 10000) return "#120a1a";
  if (y < 11400) return "#120010";
  if (y < 12800) return "#1a0018";
  if (y < 14200) return "#001a18";
  if (y < 16000) return "#1a0800";
  if (y < 18000) return "#1a0000";
  return "#0a0a0a";
}

function draw() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // ─── BACKGROUND ──────────────────────────────────────────────────────────────
  if (currentMap === 'bahamas') {
    // Bikini Bottom ocean gradient — warm tropical cyan/teal underwater
    const grad = ctx.createLinearGradient(0, 0, 0, canvas.height);
    const depthFrac = Math.min(1, cameraY / LEVEL_HEIGHT);
    // Shallow = bright teal; deep = dark navy
    const r = Math.round(0 + depthFrac * 0);
    const g = Math.round(120 - depthFrac * 80);
    const b = Math.round(180 - depthFrac * 60);
    grad.addColorStop(0, `rgb(${r},${g+10},${b+20})`);
    grad.addColorStop(1, `rgb(${r},${Math.max(20,g-30)},${Math.max(40,b-40)})`);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Sandy sea-floor hint at very bottom
    if (cameraY > LEVEL_HEIGHT - canvas.height - 200) {
      const sandY = (LEVEL_HEIGHT - cameraY) - 40;
      if (sandY < canvas.height) {
        const sandGrad = ctx.createLinearGradient(0, sandY, 0, canvas.height);
        sandGrad.addColorStop(0, 'rgba(210,180,100,0)');
        sandGrad.addColorStop(1, 'rgba(210,180,100,0.9)');
        ctx.fillStyle = sandGrad;
        ctx.fillRect(0, sandY, canvas.width, canvas.height - sandY);
      }
    }

    // Bikini Bottom background elements (parallax)
    const t_bg = Date.now();
    BB_ELEMENTS.forEach(el => {
      const screenY = el.y - cameraY * el.layer;
      if (screenY < -100 || screenY > canvas.height + 100) return;
      const wobbleX = Math.sin(t_bg * el.wobbleSpeed + el.wobble) * 6;
      ctx.save();
      ctx.translate(el.x + wobbleX, screenY);
      ctx.scale(el.scale, el.scale);
      ctx.globalAlpha = 0.18 + el.layer * 0.12;
      drawBBElement(el.type, t_bg);
      ctx.restore();
    });
  } else {
    // Original background
    const zoneColor = getZoneColor(cameraY + canvas.height / 2);
    const grad = ctx.createLinearGradient(0, 0, 0, canvas.height);
    grad.addColorStop(0, zoneColor);
    grad.addColorStop(1, "#080810");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }

  ctx.save();
  ctx.translate(0, -cameraY);

  // Zone labels (only when not Bahamas — Bahamas draws its own below)
  if (currentMap !== 'bahamas') {
  const zones = [
    { y: 80,    label: "ZONE 1 — PEG FOREST",         color: "#4488ff" },
    { y: 1400,  label: "ZONE 2 — BUMPER PIT",         color: "#ff8844" },
    { y: 2800,  label: "ZONE 3 — PLATFORM CASCADE",   color: "#44ff88" },
    { y: 4200,  label: "ZONE 4 — SPINNER HELL",       color: "#ff4444" },
    { y: 5600,  label: "ZONE 5 — GRAVITY SWAMP",      color: "#44aaff" },
    { y: 7000,  label: "ZONE 6 — KILL ZONE GAUNTLET", color: "#ff2244" },
    { y: 8400,  label: "ZONE 7 — FINAL DESCENT",      color: "#ffdd00" },
    { y: 10000, label: "ZONE 8 — MIRROR MADNESS",     color: "#cc44ff" },
    { y: 11400, label: "ZONE 9 — PINBALL PALACE",     color: "#ff44cc" },
    { y: 12800, label: "ZONE 10 — WORMHOLE ALLEY",    color: "#44ffee" },
    { y: 14200, label: "ZONE 11 — AVALANCHE",         color: "#ffaa00" },
    { y: 16000, label: "ZONE 12 — THE GAUNTLET",      color: "#ff3300" },
    { y: 18000, label: "ZONE 13 — FINAL MILE",        color: "#ffffff" },
  ];
  zones.forEach(z => {
    ctx.fillStyle = z.color + "22";
    ctx.fillRect(0, z.y, canvas.width, 40);
    ctx.fillStyle = z.color;
    ctx.font = "bold 13px monospace";
    ctx.textAlign = "center";
    ctx.globalAlpha = 0.7;
    ctx.fillText(z.label, canvas.width / 2, z.y + 27);
    ctx.globalAlpha = 1;
    ctx.textAlign = "left";
  });
  }

  // ═══════════════════════════════════════════════════════════════════════
  // OBSTACLE DRAWING — map-aware reskin
  // ═══════════════════════════════════════════════════════════════════════
  const isBahamas = currentMap === 'bahamas';

  // PEGS — default: neon blue dots | bahamas: coral/bubble clusters
  pegs.forEach(peg => {
    ctx.beginPath();
    ctx.arc(peg.x, peg.y, 5, 0, Math.PI * 2);
    if (isBahamas) {
      ctx.fillStyle = Math.sin(peg.x * 0.1 + peg.y * 0.05) > 0 ? "#ff7755" : "#44ddcc";
      ctx.shadowColor = "#ffaa88";
      ctx.shadowBlur = 5;
    } else {
      ctx.fillStyle = "#aabbcc";
      ctx.shadowColor = "#ffffff";
      ctx.shadowBlur = 3;
    }
    ctx.fill();
    ctx.shadowBlur = 0;
  });

  // BUMPERS — default: orange circles | bahamas: sea urchins (spiky purple)
  bumpers.forEach(b => {
    if (isBahamas) {
      // Spiky sea urchin
      const spikes = 12;
      ctx.save();
      ctx.translate(b.x, b.y);
      ctx.beginPath();
      for (let s = 0; s < spikes; s++) {
        const a = (s / spikes) * Math.PI * 2;
        const inner = b.radius * 0.55, outer = b.radius * 1.35;
        const amid = a + Math.PI / spikes;
        ctx.lineTo(Math.cos(a) * outer, Math.sin(a) * outer);
        ctx.lineTo(Math.cos(amid) * inner, Math.sin(amid) * inner);
      }
      ctx.closePath();
      ctx.fillStyle = "#aa44cc";
      ctx.shadowColor = "#dd88ff";
      ctx.shadowBlur = 14;
      ctx.fill();
      ctx.strokeStyle = "#ffaaff";
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.restore();
    } else {
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.radius, 0, Math.PI * 2);
      ctx.fillStyle = "#ff6600";
      ctx.shadowColor = "#ff8844";
      ctx.shadowBlur = 16;
      ctx.fill();
      ctx.strokeStyle = "#ffaa44";
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.shadowBlur = 0;
    }
  });

  // MOVING BARS — default: red neon | bahamas: shark fins (dark blue-grey)
  obstacles.forEach(o => {
    if (isBahamas) {
      // Shark fin silhouette
      ctx.save();
      ctx.fillStyle = "#1a3a5c";
      ctx.shadowColor = "#4488bb";
      ctx.shadowBlur = 10;
      ctx.fillRect(o.x, o.y, o.w, o.h);
      // Fin triangle on top
      ctx.beginPath();
      ctx.moveTo(o.x + o.w * 0.3, o.y);
      ctx.lineTo(o.x + o.w * 0.55, o.y - o.h * 1.8);
      ctx.lineTo(o.x + o.w * 0.8, o.y);
      ctx.closePath();
      ctx.fillStyle = "#1a3a5c";
      ctx.fill();
      ctx.strokeStyle = "#66aadd";
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.restore();
    } else {
      ctx.fillStyle = "#e03030";
      ctx.shadowColor = "#ff4444";
      ctx.shadowBlur = 8;
      ctx.fillRect(o.x, o.y, o.w, o.h);
      ctx.shadowBlur = 0;
    }
  });

  // SPINNERS — default: cyan cross | bahamas: jellyfish (orange/pink tentacles)
  spinners.forEach(s => {
    ctx.save();
    ctx.translate(s.x, s.y);
    ctx.rotate(s.angle);
    if (isBahamas) {
      // Jellyfish bell
      ctx.beginPath();
      ctx.ellipse(0, 0, s.size * 0.45, s.size * 0.3, 0, Math.PI, 0);
      ctx.fillStyle = "rgba(255,140,80,0.7)";
      ctx.shadowColor = "#ff8844";
      ctx.shadowBlur = 16;
      ctx.fill();
      // Tentacles (the arms)
      const tentacleColors = ["#ff6688","#ffaa44","#ff88cc","#ffdd44"];
      for (let arm = 0; arm < 4; arm++) {
        const ang = (arm / 4) * Math.PI * 2;
        const tx = Math.cos(ang) * s.size, ty = Math.sin(ang) * s.size;
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(tx, ty);
        ctx.strokeStyle = tentacleColors[arm];
        ctx.lineWidth = 3;
        ctx.shadowColor = tentacleColors[arm];
        ctx.shadowBlur = 10;
        ctx.stroke();
        // Tip dot
        ctx.beginPath();
        ctx.arc(tx, ty, 4, 0, Math.PI * 2);
        ctx.fillStyle = tentacleColors[arm];
        ctx.fill();
      }
      ctx.shadowBlur = 0;
    } else {
      ctx.strokeStyle = "cyan";
      ctx.shadowColor = "cyan";
      ctx.shadowBlur = 14;
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(-s.size, 0); ctx.lineTo(s.size, 0); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, -s.size); ctx.lineTo(0, s.size); ctx.stroke();
      ctx.shadowBlur = 0;
    }
    ctx.restore();
  });

  // BOUNCE PADS — default: green | bahamas: sea anemone (orange-red)
  bouncePads.forEach(b => {
    if (isBahamas) {
      ctx.fillStyle = "#ff5522";
      ctx.shadowColor = "#ff8844";
      ctx.shadowBlur = 14;
      ctx.fillRect(b.x, b.y, b.w, b.h);
      // Anemone tentacles on top
      const numT = Math.floor(b.w / 10);
      for (let t = 0; t < numT; t++) {
        const tx = b.x + (t + 0.5) * (b.w / numT);
        const wave = Math.sin(Date.now() * 0.003 + t * 0.8) * 4;
        ctx.beginPath();
        ctx.moveTo(tx, b.y);
        ctx.lineTo(tx + wave, b.y - 10);
        ctx.strokeStyle = "#ffaa44";
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(tx + wave, b.y - 12, 3, 0, Math.PI * 2);
        ctx.fillStyle = "#ffdd88";
        ctx.fill();
      }
      ctx.shadowBlur = 0;
    } else {
      ctx.fillStyle = "#44ff88";
      ctx.shadowColor = "#44ff88";
      ctx.shadowBlur = 12;
      ctx.fillRect(b.x, b.y, b.w, b.h);
      ctx.shadowBlur = 0;
    }
  });

  // PLATFORMS — default: green shelf | bahamas: coral shelf (orange-brown)
  narrowGates.forEach(g => {
    if (isBahamas) {
      // Coral shelf — bumpy orange-brown
      const cg = ctx.createLinearGradient(g.gapX, g.y, g.gapX, g.y + 10);
      cg.addColorStop(0, "#ff8844");
      cg.addColorStop(1, "#994422");
      ctx.fillStyle = cg;
      ctx.shadowColor = "#ffaa66";
      ctx.shadowBlur = 10;
      ctx.fillRect(g.gapX, g.y, g.gapWidth, 10);
      // Bumpy top
      const bumps = Math.floor(g.gapWidth / 14);
      for (let b = 0; b < bumps; b++) {
        ctx.beginPath();
        ctx.arc(g.gapX + b * 14 + 7, g.y, 5, Math.PI, 0);
        ctx.fillStyle = "#ffaa55";
        ctx.fill();
      }
      ctx.shadowBlur = 0;
    } else {
      const grad = ctx.createLinearGradient(g.gapX, g.y, g.gapX, g.y + 10);
      grad.addColorStop(0, "#55ee88");
      grad.addColorStop(1, "#228844");
      ctx.fillStyle = grad;
      ctx.shadowColor = "#44ff88";
      ctx.shadowBlur = 10;
      ctx.fillRect(g.gapX, g.y, g.gapWidth, 10);
      ctx.fillStyle = "rgba(180,255,200,0.5)";
      ctx.fillRect(g.gapX, g.y, g.gapWidth, 2);
      ctx.shadowBlur = 0;
    }
  });

  // ZIGZAG WALLS — default: yellow ramps | bahamas: seaweed ramps (green)
  zigzagWalls.forEach(w => {
    ctx.beginPath();
    ctx.moveTo(w.x1, w.y1);
    ctx.lineTo(w.x2, w.y2);
    if (isBahamas) {
      ctx.strokeStyle = "#22cc44";
      ctx.shadowColor = "#44ff66";
      ctx.shadowBlur = 16;
      ctx.lineWidth = 14;
      ctx.lineCap = "round";
      ctx.stroke();
      // Seaweed highlight
      ctx.beginPath(); ctx.moveTo(w.x1, w.y1); ctx.lineTo(w.x2, w.y2);
      ctx.strokeStyle = "rgba(150,255,150,0.5)";
      ctx.shadowBlur = 0; ctx.lineWidth = 3; ctx.stroke();
    } else {
      ctx.strokeStyle = "#ffdd00";
      ctx.shadowColor = "#ffdd00";
      ctx.shadowBlur = 18;
      ctx.lineWidth = 14;
      ctx.lineCap = "round";
      ctx.stroke();
      ctx.beginPath(); ctx.moveTo(w.x1, w.y1); ctx.lineTo(w.x2, w.y2);
      ctx.strokeStyle = "rgba(255,255,180,0.6)";
      ctx.shadowBlur = 0; ctx.lineWidth = 3; ctx.stroke();
    }
  });

  // GRAVITY WELLS — default: blue vortex | bahamas: ocean whirlpool (teal)
  gravityWells.forEach(w => {
    const gwColor = isBahamas ? "#00ccaa" : "#4488ff";
    const gwFill  = isBahamas ? "rgba(0,180,140,0.3)" : "rgba(0,100,255,0.3)";
    ctx.beginPath();
    ctx.arc(w.x, w.y, 18, 0, Math.PI * 2);
    ctx.fillStyle = gwFill;
    ctx.fill();
    ctx.strokeStyle = gwColor;
    ctx.shadowColor = gwColor;
    ctx.shadowBlur = 20;
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.shadowBlur = 0;
    for (let r = 40; r <= 200; r += 50) {
      ctx.beginPath();
      ctx.arc(w.x, w.y, r, 0, Math.PI * 2);
      ctx.strokeStyle = isBahamas ? `rgba(0,200,160,${0.15 - r * 0.0005})` : `rgba(68,136,255,${0.15 - r * 0.0005})`;
      ctx.lineWidth = 1;
      ctx.stroke();
    }
    if (isBahamas) {
      ctx.fillStyle = "#00ffcc";
      ctx.font = "bold 10px monospace";
      ctx.textAlign = "center";
      ctx.fillText("🌀 TIDE", w.x, w.y + 4);
    }
  });

  // SLOW ZONES — default: blue ice | bahamas: seaweed patch (green)
  slowZones.forEach(s => {
    if (isBahamas) {
      ctx.fillStyle = "rgba(20,160,60,0.3)";
      ctx.fillRect(s.x, s.y, s.w, s.h);
      ctx.strokeStyle = "#22aa44";
      ctx.lineWidth = 1;
      ctx.strokeRect(s.x, s.y, s.w, s.h);
      ctx.fillStyle = "rgba(100,255,120,0.8)";
      ctx.font = "10px monospace";
      ctx.fillText("🌿 SEAWEED", s.x + 4, s.y + 14);
    } else {
      ctx.fillStyle = "rgba(30,100,255,0.25)";
      ctx.fillRect(s.x, s.y, s.w, s.h);
      ctx.strokeStyle = "#3366ff";
      ctx.lineWidth = 1;
      ctx.strokeRect(s.x, s.y, s.w, s.h);
      ctx.fillStyle = "rgba(150,200,255,0.7)";
      ctx.font = "10px monospace";
      ctx.fillText("SLOW", s.x + 4, s.y + 14);
    }
  });

  // KILL ZONES — default: red skull | bahamas: shark mouth (red/white teeth)
  killZones.forEach(k => {
    if (isBahamas) {
      ctx.fillStyle = "rgba(180,20,20,0.85)";
      ctx.shadowColor = "#ff2200";
      ctx.shadowBlur = 16;
      ctx.fillRect(k.x, k.y, k.w, k.h);
      ctx.shadowBlur = 0;
      // Teeth
      const teeth = Math.floor(k.w / 12);
      for (let t = 0; t < teeth; t++) {
        ctx.beginPath();
        ctx.moveTo(k.x + t * 12, k.y);
        ctx.lineTo(k.x + t * 12 + 6, k.y - 8);
        ctx.lineTo(k.x + t * 12 + 12, k.y);
        ctx.fillStyle = "white";
        ctx.fill();
      }
      ctx.fillStyle = "white";
      ctx.font = "bold 10px monospace";
      ctx.fillText("🦈 SHARK", k.x + 4, k.y + 14);
    } else {
      ctx.fillStyle = "rgba(200,0,0,0.75)";
      ctx.shadowColor = "red";
      ctx.shadowBlur = 14;
      ctx.fillRect(k.x, k.y, k.w, k.h);
      ctx.shadowBlur = 0;
      ctx.fillStyle = "white";
      ctx.font = "bold 11px monospace";
      ctx.fillText("☠ KILL", k.x + 4, k.y + 14);
    }
  });

  // PORTALS — default: purple/orange | bahamas: not used (nostril portals replace them)
  portals.forEach(po => {
    ctx.beginPath();
    ctx.arc(po.x1, po.y1, 12, 0, Math.PI * 2);
    ctx.fillStyle = "#6644ff";
    ctx.shadowColor = "#6644ff";
    ctx.shadowBlur = 18;
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.fillStyle = "white";
    ctx.font = "9px monospace";
    ctx.textAlign = "center";
    ctx.fillText("IN", po.x1, po.y1 + 4);
    ctx.beginPath();
    ctx.arc(po.x2, po.y2, 12, 0, Math.PI * 2);
    ctx.fillStyle = "#ff8844";
    ctx.shadowColor = "#ff8844";
    ctx.shadowBlur = 18;
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.fillStyle = "white";
    ctx.fillText("OUT", po.x2, po.y2 + 4);
    ctx.textAlign = "left";
  });

  // 🎁 Buffs / pickups
  const drawNow = Date.now();
  buffs.forEach(bf => {
    const def = BUFF_TYPES.find(d => d.type === bf.type);
    const pulse = 0.7 + 0.3 * Math.sin(drawNow * 0.006 + bf.pulsePhase);
    const age = (drawNow - bf.born) / BUFF_LIFETIME;
    const alpha = age > 0.75 ? 1 - (age - 0.75) / 0.25 : 1; // fade out last 25%
    ctx.save();
    ctx.globalAlpha = alpha;
    // Outer glow ring
    ctx.beginPath();
    ctx.arc(bf.x, bf.y, BUFF_RADIUS * 1.6 * pulse, 0, Math.PI * 2);
    ctx.fillStyle = def.color + '22';
    ctx.fill();
    // Main circle
    ctx.beginPath();
    ctx.arc(bf.x, bf.y, BUFF_RADIUS, 0, Math.PI * 2);
    ctx.fillStyle = def.color + '44';
    ctx.shadowColor = def.glow;
    ctx.shadowBlur = 18 * pulse;
    ctx.fill();
    ctx.strokeStyle = def.color;
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.shadowBlur = 0;
    // Icon
    ctx.font = 'bold 12px monospace';
    ctx.textAlign = 'center';
    ctx.fillStyle = '#fff';
    ctx.fillText(def.icon, bf.x, bf.y + 4);
    ctx.restore();
  });

  // ══════════════════════════════════════════════════
  // 🏝️ BAHAMAS MAP DRAWING
  // ══════════════════════════════════════════════════
  if (currentMap === 'bahamas') {
    const t_draw = Date.now();

    // 👃 NOSE BUMPERS — animated sniff/charge/sneeze states
    const t_nose = Date.now();
    noseBumpers.forEach(nb => {
      const phase = ((t_nose + nb.phaseOffset) % NOSE_CYCLE_MS) / NOSE_CYCLE_MS;

      // Determine state + visual params
      let state, quiver = 0, glow = 0, noseColor, noseOutline, glowColor;
      let sniffRingAlpha = 0, sniffRingR = 0;

      if (phase < NOSE_SNIFF_END) {
        state = 'sniff';
        const t = phase / NOSE_SNIFF_END;
        sniffRingAlpha = Math.sin(t * Math.PI) * 0.6;
        sniffRingR = t * nb.sniffRadius;
        noseColor = '#ffaa88';
        noseOutline = '#cc5544';
        glowColor = '#ff8877';
        glow = 15;
      } else if (phase < NOSE_CHARGE_END) {
        state = 'charge';
        const t = (phase - NOSE_SNIFF_END) / (NOSE_CHARGE_END - NOSE_SNIFF_END);
        quiver = Math.sin(t * Math.PI * 18) * (4 + t * 6); // rapid shake
        noseColor = '#ff8855';
        noseOutline = '#ff3300';
        glowColor = '#ff5500';
        glow = 25 + t * 20;
      } else if (phase < NOSE_SNEEZE_END) {
        state = 'sneeze';
        const t = (phase - NOSE_CHARGE_END) / (NOSE_SNEEZE_END - NOSE_CHARGE_END);
        sniffRingAlpha = (1 - t) * 0.8;
        sniffRingR = t * nb.sniffRadius * 2.5;
        noseColor = '#ffffaa';
        noseOutline = '#ffdd00';
        glowColor = '#ffff00';
        glow = 40 * (1 - t);
      } else {
        state = 'idle';
        noseColor = '#ffccbb';
        noseOutline = '#cc6655';
        glowColor = '#ff8877';
        glow = 6;
      }

      ctx.save();
      ctx.translate(nb.x + quiver, nb.y);

      // Sniff / sneeze shockwave ring
      if (sniffRingAlpha > 0.01) {
        ctx.beginPath();
        ctx.arc(0, 0, sniffRingR, 0, Math.PI * 2);
        ctx.strokeStyle = state === 'sneeze'
          ? `rgba(180,255,100,${sniffRingAlpha})`
          : `rgba(200,160,255,${sniffRingAlpha})`;
        ctx.lineWidth = state === 'sneeze' ? 5 : 2;
        ctx.stroke();
        if (state === 'sneeze') {
          // Extra snot particles radiating out
          for (let a = 0; a < Math.PI * 2; a += Math.PI / 5) {
            const pr = sniffRingR * 0.6;
            ctx.beginPath();
            ctx.arc(Math.cos(a) * pr, Math.sin(a) * pr, 5 + Math.random() * 4, 0, Math.PI * 2);
            ctx.fillStyle = `rgba(150,255,80,${sniffRingAlpha * 0.8})`;
            ctx.fill();
          }
        }
      }

      // Main nose body
      const noseGrad = ctx.createRadialGradient(-8, -12, 2, 0, 0, Math.max(nb.rx, nb.ry));
      noseGrad.addColorStop(0, '#ffeecc');
      noseGrad.addColorStop(0.6, noseColor);
      noseGrad.addColorStop(1, '#cc5544');
      ctx.beginPath();
      ctx.ellipse(0, 0, nb.rx, nb.ry, 0, 0, Math.PI * 2);
      ctx.fillStyle = noseGrad;
      ctx.shadowColor = glowColor;
      ctx.shadowBlur = glow;
      ctx.fill();
      ctx.strokeStyle = noseOutline;
      ctx.lineWidth = 3;
      ctx.stroke();
      ctx.shadowBlur = 0;

      // Nose tip bump
      ctx.beginPath();
      ctx.ellipse(0, nb.ry * 0.55, nb.rx * 0.5, nb.ry * 0.28, 0, 0, Math.PI * 2);
      ctx.fillStyle = state === 'charge' ? '#ffddaa' : '#ffbbaa';
      ctx.fill();

      // Nostrils — flare wide during charge/sneeze
      const nostrilFlare = (state === 'charge' || state === 'sneeze') ? 1.5 : 1;
      ctx.beginPath();
      ctx.ellipse(nb.nostrilL.dx, nb.nostrilL.dy, 10 * nostrilFlare, 7 * nostrilFlare, -0.3, 0, Math.PI * 2);
      ctx.fillStyle = state === 'sneeze' ? '#228800' : '#883322';
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(nb.nostrilR.dx, nb.nostrilR.dy, 10 * nostrilFlare, 7 * nostrilFlare, 0.3, 0, Math.PI * 2);
      ctx.fillStyle = state === 'sneeze' ? '#228800' : '#883322';
      ctx.fill();

      // Snot drip during sneeze
      if (state === 'sneeze') {
        const sneezeFrac = (phase - NOSE_CHARGE_END) / (NOSE_SNEEZE_END - NOSE_CHARGE_END);
        const dripLen = sneezeFrac * 80;
        ctx.beginPath();
        ctx.moveTo(nb.nostrilL.dx, nb.nostrilL.dy + 7 * nostrilFlare);
        ctx.bezierCurveTo(nb.nostrilL.dx - 8, nb.nostrilL.dy + dripLen * 0.5, nb.nostrilL.dx + 4, nb.nostrilL.dy + dripLen * 0.8, nb.nostrilL.dx, nb.nostrilL.dy + dripLen);
        ctx.strokeStyle = `rgba(100,255,60,0.85)`;
        ctx.lineWidth = 7;
        ctx.lineCap = 'round';
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(nb.nostrilL.dx, nb.nostrilL.dy + dripLen, 8, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(80,220,40,0.8)';
        ctx.fill();
      }

      // State label
      const stateLabels = { sniff: '😮 SNIFFING…', charge: '😤 CHARGING!', sneeze: '🤧 ACHOO!!!', idle: '👃 BIG NOSE' };
      const labelColor = { sniff: '#ddaaff', charge: '#ff6600', sneeze: '#aaffaa', idle: 'rgba(255,180,150,0.8)' };
      ctx.fillStyle = labelColor[state];
      ctx.font = `bold ${state === 'charge' || state === 'sneeze' ? 12 : 10}px monospace`;
      ctx.textAlign = 'center';
      ctx.fillText(stateLabels[state], 0, -nb.ry - 8);

      ctx.restore();
    });

    // 🤧 SNEEZE ZONES — oscillating horizontal hazard bar
    sneezeZones.forEach(sz => {
      const blast = sz.dir * sz.strength * (0.5 + 0.5 * Math.sin(t_draw * sz.speed + sz.phase));
      const intensity = Math.abs(blast) / sz.strength;
      ctx.save();
      ctx.globalAlpha = 0.55 + intensity * 0.35;
      // Green-yellow sneezy color
      ctx.fillStyle = `rgba(180,255,100,${0.3 + intensity * 0.3})`;
      ctx.shadowColor = '#aaff44';
      ctx.shadowBlur = 12 * intensity;
      ctx.fillRect(sz.x, sz.y, sz.w, sz.h);
      ctx.shadowBlur = 0;

      // Arrow showing blast direction
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 12px monospace';
      ctx.textAlign = 'center';
      const arrowCh = sz.dir > 0 ? '→→→ 🤧 SNEEZE →→→' : '←←← 🤧 SNEEZE ←←←';
      ctx.fillText(arrowCh, sz.w / 2, sz.y + sz.h * 0.75);
      ctx.restore();
    });

    // 👃 NOSTRIL PORTALS
    nostrilPortals.forEach(np => {
      // Left nostril (entry) — dark pink/mauve
      ctx.beginPath();
      ctx.ellipse(np.x1, np.y1, 18, 13, -0.3, 0, Math.PI * 2);
      ctx.fillStyle = '#cc4488';
      ctx.shadowColor = '#ff44aa';
      ctx.shadowBlur = 18;
      ctx.fill();
      ctx.fillStyle = '#330011';
      ctx.beginPath();
      ctx.ellipse(np.x1, np.y1, 10, 7, -0.3, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.fillStyle = 'white';
      ctx.font = '9px monospace';
      ctx.textAlign = 'center';
      ctx.fillText('👃 IN', np.x1, np.y1 - 18);

      // Right nostril (exit) — snot green
      ctx.beginPath();
      ctx.ellipse(np.x2, np.y2, 18, 13, 0.3, 0, Math.PI * 2);
      ctx.fillStyle = '#44cc44';
      ctx.shadowColor = '#88ff44';
      ctx.shadowBlur = 18;
      ctx.fill();
      ctx.fillStyle = '#003300';
      ctx.beginPath();
      ctx.ellipse(np.x2, np.y2, 10, 7, 0.3, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.fillStyle = 'white';
      ctx.font = '9px monospace';
      ctx.textAlign = 'center';
      ctx.fillText(np.sendUp ? '👃 SNIFF↑' : '👃 OUT', np.x2, np.y2 - 18);
      ctx.textAlign = 'left';
    });

    // 🟢 BOOGER SLIMES — animated dripping green goo
    boogerSlimes.forEach(bs => {
      bs.drip += 0.04;
      const drip1 = Math.sin(bs.drip) * 6;
      const drip2 = Math.sin(bs.drip + 1.5) * 4;

      ctx.save();
      // Main slime blob
      ctx.beginPath();
      ctx.roundRect(bs.x, bs.y, bs.w, bs.h + drip1, 8);
      ctx.fillStyle = 'rgba(80,200,60,0.82)';
      ctx.shadowColor = '#44ff44';
      ctx.shadowBlur = 10;
      ctx.fill();
      // Highlight
      ctx.beginPath();
      ctx.roundRect(bs.x + 4, bs.y + 2, bs.w - 8, 5, 3);
      ctx.fillStyle = 'rgba(180,255,120,0.5)';
      ctx.fill();
      ctx.shadowBlur = 0;
      // Drip drop
      ctx.beginPath();
      ctx.arc(bs.x + bs.w * 0.35, bs.y + bs.h + drip1 + 4, 5 + drip2 * 0.3, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(60,180,40,0.8)';
      ctx.fill();
      // Label
      ctx.fillStyle = '#003300';
      ctx.font = 'bold 9px monospace';
      ctx.textAlign = 'center';
      ctx.fillText('🟢 BOOGER', bs.x + bs.w / 2, bs.y + bs.h * 0.75);
      ctx.restore();
    });

    // 🌊 TIDE WAVES — sweeping horizontal wall
    tideWaves.forEach(tw => {
      const waveX = ((tw.dir > 0 ? tw.phase % 1 : 1 - (tw.phase % 1))) * (canvas.width + tw.w) - tw.w;
      const waveRight = waveX + tw.w;
      const waveTop = tw.y - 14;
      const waveH = 28;
      // Only draw if on screen
      if (waveRight < 0 || waveX > canvas.width) return;
      ctx.save();
      // Wave body gradient
      const wg = ctx.createLinearGradient(waveX, waveTop, waveRight, waveTop);
      wg.addColorStop(0,   'rgba(30,120,220,0)');
      wg.addColorStop(0.1, 'rgba(60,160,255,0.85)');
      wg.addColorStop(0.9, 'rgba(60,160,255,0.85)');
      wg.addColorStop(1,   'rgba(30,120,220,0)');
      ctx.fillStyle = wg;
      ctx.shadowColor = '#44aaff';
      ctx.shadowBlur = 18;
      ctx.fillRect(waveX, waveTop, tw.w, waveH);
      ctx.shadowBlur = 0;
      // Foam crest
      const foamY = waveTop + 4;
      for (let fx = waveX + 8; fx < waveRight - 8; fx += 22) {
        ctx.beginPath();
        ctx.arc(fx, foamY, 6 + Math.sin(fx * 0.3 + t_draw * 0.004) * 2, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(200,240,255,0.7)';
        ctx.fill();
      }
      // Direction arrow
      ctx.fillStyle = 'rgba(255,255,255,0.9)';
      ctx.font = 'bold 11px monospace';
      ctx.textAlign = 'center';
      const arrowStr = tw.dir > 0 ? '→ 🌊 TIDE →' : '← 🌊 TIDE ←';
      ctx.fillText(arrowStr, waveX + tw.w / 2, tw.y + 5);
      ctx.restore();
    });

    // 🦀 CRAB CLAWS — animated pincers
    crabClaws.forEach(cc => {
      const openAng = Math.abs(Math.sin(Date.now() * cc.speed + cc.phase));
      const maxOpen = Math.PI * 0.55;
      const ang = openAng * maxOpen;
      ctx.save();
      ctx.translate(cc.x, cc.y);
      // Body (small crab shell)
      ctx.beginPath();
      ctx.ellipse(0, 0, 18, 12, 0, 0, Math.PI * 2);
      ctx.fillStyle = '#cc4400';
      ctx.shadowColor = '#ff6622';
      ctx.shadowBlur = 12;
      ctx.fill();
      ctx.strokeStyle = '#ff8844';
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.shadowBlur = 0;
      // Eyes
      ctx.beginPath(); ctx.arc(-7, -5, 3, 0, Math.PI*2); ctx.fillStyle='#ffdd00'; ctx.fill();
      ctx.beginPath(); ctx.arc( 7, -5, 3, 0, Math.PI*2); ctx.fillStyle='#ffdd00'; ctx.fill();
      // Two arms (pincers)
      for (let side = -1; side <= 1; side += 2) {
        const armAng = (side > 0 ? -Math.PI * 0.5 + ang : -Math.PI * 0.5 - ang);
        const tipX = Math.cos(armAng) * cc.armLen * side;
        const tipY = Math.sin(armAng) * cc.armLen;
        ctx.beginPath();
        ctx.moveTo(side * 14, 0);
        ctx.lineTo(tipX, tipY);
        ctx.strokeStyle = '#dd5500';
        ctx.lineWidth = 8;
        ctx.lineCap = 'round';
        ctx.shadowColor = '#ff6622';
        ctx.shadowBlur = 8;
        ctx.stroke();
        ctx.shadowBlur = 0;
        // Pincer tip
        ctx.beginPath();
        ctx.arc(tipX, tipY, 10, 0, Math.PI * 2);
        ctx.fillStyle = '#ff4400';
        ctx.shadowColor = '#ff8844';
        ctx.shadowBlur = 10;
        ctx.fill();
        ctx.shadowBlur = 0;
      }
      // State label
      const isOpen = ang > maxOpen * 0.5;
      ctx.fillStyle = isOpen ? '#ffaa44' : '#ff4400';
      ctx.font = 'bold 9px monospace';
      ctx.textAlign = 'center';
      ctx.fillText(isOpen ? '🦀 OPEN' : '🦀 SNAP!', 0, -cc.armLen - 8);
      ctx.restore();
    });

    // 🫧 BUBBLE LIFTS — rising bubble column
    bubbleLifts.forEach(bl => {
      ctx.save();
      // Column background
      const blg = ctx.createLinearGradient(bl.x, bl.y, bl.x, bl.y + bl.h);
      blg.addColorStop(0, 'rgba(100,200,255,0.5)');
      blg.addColorStop(1, 'rgba(100,200,255,0.05)');
      ctx.fillStyle = blg;
      ctx.fillRect(bl.x, bl.y, bl.w, bl.h);
      ctx.strokeStyle = 'rgba(150,220,255,0.4)';
      ctx.lineWidth = 1;
      ctx.strokeRect(bl.x, bl.y, bl.w, bl.h);
      // Animated bubbles rising
      const numBubbles = 5;
      for (let bi = 0; bi < numBubbles; bi++) {
        const bPhase = ((t_draw * 0.0008 + bi / numBubbles) % 1);
        const bx = bl.x + bl.w * 0.2 + (bi % 3) * (bl.w * 0.25);
        const by = bl.y + bl.h * (1 - bPhase);
        const br = 4 + (bi % 3) * 2;
        ctx.beginPath();
        ctx.arc(bx, by, br, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(180,240,255,${0.5 + bPhase * 0.3})`;
        ctx.shadowColor = '#aaddff';
        ctx.shadowBlur = 6;
        ctx.fill();
        ctx.shadowBlur = 0;
        // Shine
        ctx.beginPath();
        ctx.arc(bx - br * 0.3, by - br * 0.3, br * 0.35, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(255,255,255,0.6)';
        ctx.fill();
      }
      ctx.fillStyle = 'rgba(150,230,255,0.9)';
      ctx.font = 'bold 9px monospace';
      ctx.textAlign = 'center';
      ctx.fillText('🫧 LIFT', bl.x + bl.w / 2, bl.y + 14);
      ctx.restore();
    });

    // ⚓ ANCHOR CHAINS — swinging pendulum
    anchorChains.forEach(ac => {
      const links = 6;
      ctx.save();
      ctx.translate(ac.x, ac.y);
      // Anchor mount point
      ctx.beginPath();
      ctx.arc(0, 0, 8, 0, Math.PI * 2);
      ctx.fillStyle = '#778899';
      ctx.shadowColor = '#aabbcc';
      ctx.shadowBlur = 8;
      ctx.fill();
      ctx.shadowBlur = 0;
      // Chain links
      for (let li = 1; li <= links; li++) {
        const frac = li / links;
        const lx = Math.sin(ac.angle) * ac.len * frac;
        const ly = Math.cos(ac.angle) * ac.len * frac;
        const prevFrac = (li - 1) / links;
        const plx = Math.sin(ac.angle) * ac.len * prevFrac;
        const ply = Math.cos(ac.angle) * ac.len * prevFrac;
        // Link segment
        ctx.beginPath();
        ctx.moveTo(plx, ply);
        ctx.lineTo(lx, ly);
        ctx.strokeStyle = '#8899aa';
        ctx.lineWidth = 6;
        ctx.lineCap = 'round';
        ctx.shadowColor = '#aabbcc';
        ctx.shadowBlur = 4;
        ctx.stroke();
        ctx.shadowBlur = 0;
        // Link oval
        ctx.beginPath();
        ctx.arc(lx, ly, 7, 0, Math.PI * 2);
        ctx.fillStyle = '#667788';
        ctx.strokeStyle = '#99aabb';
        ctx.lineWidth = 2;
        ctx.fill();
        ctx.stroke();
      }
      // Anchor weight at bottom
      const ax = Math.sin(ac.angle) * ac.len;
      const ay = Math.cos(ac.angle) * ac.len;
      ctx.beginPath();
      ctx.arc(ax, ay, 14, 0, Math.PI * 2);
      ctx.fillStyle = '#445566';
      ctx.shadowColor = '#6688aa';
      ctx.shadowBlur = 12;
      ctx.fill();
      ctx.strokeStyle = '#8899bb';
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.fillStyle = '#aabbcc';
      ctx.font = 'bold 10px monospace';
      ctx.textAlign = 'center';
      ctx.fillText('⚓', ax, ay + 4);
      ctx.restore();
    });

    // Zone label override for Bahamas
    const bahamasZones = [
      { y: 80,    label: "🌴 BAHAMAS BEACH — Peg Forest",       color: "#88ddff" },
      { y: 1400,  label: "🐠 BIKINI BOTTOM — Bumper Pit",       color: "#ffaa44" },
      { y: 2800,  label: "🪸 CORAL CASCADE — Platforms",         color: "#44ffbb" },
      { y: 4200,  label: "🌀 SEAHORSE SPIN — Spinner Hell",      color: "#ff8888" },
      { y: 5600,  label: "🌊 DEEP SWAMP — Gravity Zone",         color: "#44bbff" },
      { y: 7000,  label: "☠️ DAVY JONES — Kill Gauntlet",        color: "#ff4455" },
      { y: 8400,  label: "🦈 SHARK DESCENT — Final Dive",        color: "#ffee44" },
      { y: 10000, label: "🐙 KRAKEN LAIR — Zigzag Walls",        color: "#dd44ff" },
      { y: 11400, label: "🎠 PINBALL CRAB — Pinball Palace",     color: "#ff55cc" },
      { y: 12800, label: "🕳️ WORMHOLE REEF — Nostril Portals",   color: "#44ffee" },
      { y: 14200, label: "🏔️ AVALANCHE ATOLL",                   color: "#ffbb44" },
      { y: 16000, label: "💥 THE NOSE GAUNTLET",                  color: "#ff4400" },
      { y: 18000, label: "🏁 FINAL SCHNOZZLE STRETCH",            color: "#ffffff" },
    ];
    bahamasZones.forEach(z => {
      ctx.fillStyle = z.color + "22";
      ctx.fillRect(0, z.y, canvas.width, 40);
      ctx.fillStyle = z.color;
      ctx.font = "bold 13px monospace";
      ctx.textAlign = "center";
      ctx.globalAlpha = 0.8;
      ctx.fillText(z.label, canvas.width / 2, z.y + 27);
      ctx.globalAlpha = 1;
      ctx.textAlign = "left";
    });
  }

  // 🏁 Finish line
  for (let x = 0; x < canvas.width; x += 20) {
    ctx.fillStyle = Math.floor(x / 20) % 2 === 0 ? "white" : "black";
    ctx.fillRect(x, LEVEL_HEIGHT - 15, 20, 15);
  }
  ctx.fillStyle = "yellow";
  ctx.font = "bold 20px monospace";
  ctx.textAlign = "center";
  ctx.fillText("🏁 FINISH", canvas.width / 2, LEVEL_HEIGHT - 22);
  ctx.textAlign = "left";

  // 🎾 Player trails + marbles
  players.forEach(p => {
    if (p.finished) return;

    // Speed-colored trail — cyan=slow, yellow=medium, red=fast
    const spd = Math.hypot(p.vx, p.vy);
    const speedFrac = Math.min(1, spd / 14); // 0=slow, 1=max speed
    p.trail.forEach((pt, i) => {
      const frac = i / p.trail.length;
      const alpha = frac * 0.55;
      const size = p.radius * frac * 0.75;
      // Interpolate hue: 180 (cyan) → 60 (yellow) → 0 (red) based on speed
      const hue = 180 - speedFrac * 180;
      const sat = 80 + speedFrac * 20;
      const lit = 50 + speedFrac * 15;
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, size, 0, Math.PI * 2);
      ctx.fillStyle = `hsla(${hue},${sat}%,${lit}%,${alpha})`;
      ctx.fill();
    });

    // Marble glow color shifts with speed too
    const glowHue = 180 - speedFrac * 180;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
    ctx.fillStyle = p.color;
    ctx.shadowColor = speedFrac > 0.6 ? `hsl(${glowHue},100%,60%)` : p.color;
    ctx.shadowBlur = 10 + speedFrac * 16;
    ctx.fill();
    ctx.shadowBlur = 0;

    // Shine
    ctx.beginPath();
    ctx.arc(p.x - 3, p.y - 3, 4, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(255,255,255,0.35)";
    ctx.fill();

    // Buff aura ring around marble
    if (p.activeBuff) {
      const bdef = BUFF_TYPES.find(d => d.type === p.activeBuff.type);
      const buffPulse = 0.7 + 0.3 * Math.sin(Date.now() * 0.008);
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.radius + 5 + buffPulse * 3, 0, Math.PI * 2);
      ctx.strokeStyle = bdef.color;
      ctx.shadowColor = bdef.glow;
      ctx.shadowBlur = 14;
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.shadowBlur = 0;
      // Buff icon above name
      ctx.font = '11px monospace';
      ctx.textAlign = 'center';
      ctx.fillText(bdef.icon, p.x, p.y - 32);
    }

    // Name + rank
    const isSpectated = spectateTarget === p;
    const rankColors = ["#ffd700","#cccccc","#cd7f32"];
    const rankColor = p.rank <= 3 ? rankColors[p.rank-1] : "white";

    if (isSpectated) {
      ctx.strokeStyle = "#00d4ff";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.radius + 5, 0, Math.PI * 2);
      ctx.stroke();
    }

    ctx.fillStyle = rankColor;
    ctx.font = "bold 9px monospace";
    ctx.textAlign = "center";
    ctx.fillText(`#${p.rank}`, p.x, p.y - 23);
    ctx.fillStyle = "white";
    ctx.font = "bold 10px monospace";
    ctx.fillText(p.name, p.x, p.y - 14);
    ctx.textAlign = "left";
  });

  ctx.restore();

  // HUD
  drawHUD();

  // 📢 Commentary feed (drawn over everything, fixed position)
  drawCommentary();
}

function drawCommentary() {
  const now = Date.now();
  // Expire old entries
  commentaryFeed = commentaryFeed.filter(c => now - c.born < COMMENTARY_TTL);

  const cx = canvas.width / 2;
  const baseY = canvas.height - 60;

  commentaryFeed.forEach((c, i) => {
    const age = (now - c.born) / COMMENTARY_TTL;
    const alpha = age < 0.15 ? age / 0.15 : age > 0.75 ? 1 - (age - 0.75) / 0.25 : 1;
    const yOff = (commentaryFeed.length - 1 - i) * 26;

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.font = "bold 13px 'Share Tech Mono', monospace";
    const textW = ctx.measureText(c.text).width;
    // Background pill
    ctx.fillStyle = "rgba(4,8,20,0.82)";
    roundRect(ctx, cx - textW/2 - 12, baseY - yOff - 18, textW + 24, 22, 11);
    ctx.fill();
    // Border in message color
    ctx.strokeStyle = c.color + "66";
    ctx.lineWidth = 1;
    roundRect(ctx, cx - textW/2 - 12, baseY - yOff - 18, textW + 24, 22, 11);
    ctx.stroke();
    // Text
    ctx.fillStyle = c.color;
    ctx.textAlign = "center";
    ctx.fillText(c.text, cx, baseY - yOff);
    ctx.restore();
  });
}

function drawHUD() {
  const barW = 160;
  const barH = 12;
  const margin = 6;
  const rowH = barH + margin + 16;
  const startX = canvas.width - barW - 16;

  // Sort players by rank for display
  const sorted = [...players].sort((a,b) => a.rank - b.rank);

  const COLLAPSED_COUNT = 3;
  const TOGGLE_H = 26;
  // How many rows fit on screen when expanded
  const maxFit = Math.max(COLLAPSED_COUNT, Math.floor((canvas.height - 14 - TOGGLE_H) / rowH));
  const hasMore = sorted.length > COLLAPSED_COUNT;

  // Clamp scroll offset
  if (hudExpanded) {
    const maxScroll = Math.max(0, sorted.length - maxFit);
    hudScrollOffset = Math.max(0, Math.min(hudScrollOffset, maxScroll));
  } else {
    hudScrollOffset = 0;
  }

  const showCount = hudExpanded ? Math.min(maxFit, sorted.length) : Math.min(COLLAPSED_COUNT, sorted.length);
  const startIdx  = hudExpanded ? hudScrollOffset : 0;

  for (let i = 0; i < showCount; i++) {
    const p = sorted[startIdx + i];
    if (!p) break;
    const progress = Math.min(1, p.y / LEVEL_HEIGHT);
    const y = 14 + i * rowH;

    // Panel BG
    const isSpectated = spectateTarget === p;
    ctx.fillStyle = isSpectated ? "rgba(0,212,255,0.15)" : "rgba(4,8,20,0.75)";
    roundRect(ctx, startX - 24, y - 14, barW + 28, barH + 18, 4);
    ctx.fill();
    if (isSpectated) {
      ctx.strokeStyle = "#00d4ff";
      ctx.lineWidth = 1;
      roundRect(ctx, startX - 24, y - 14, barW + 28, barH + 18, 4);
      ctx.stroke();
    }

    // Rank number
    const rankColor = p.rank === 1 ? "#ffd700" : p.rank === 2 ? "#cccccc" : p.rank === 3 ? "#cd7f32" : "rgba(255,255,255,0.5)";
    ctx.fillStyle = rankColor;
    ctx.font = "bold 10px 'Orbitron', monospace";
    ctx.textAlign = "right";
    ctx.fillText(`#${p.rank}`, startX - 4, y + barH - 2);

    // Track
    ctx.fillStyle = "rgba(255,255,255,0.06)";
    roundRect(ctx, startX, y, barW, barH, 3);
    ctx.fill();

    // Fill bar
    const fillColor = p.finished ? "#ffd700" : p.color;
    ctx.fillStyle = fillColor;
    ctx.shadowColor = fillColor;
    ctx.shadowBlur = 6;
    roundRect(ctx, startX, y, Math.max(4, barW * progress), barH, 3);
    ctx.fill();
    ctx.shadowBlur = 0;

    // Name
    ctx.fillStyle = p.finished ? "#ffd700" : "rgba(255,255,255,0.85)";
    ctx.font = `bold 10px 'Share Tech Mono', monospace`;
    ctx.textAlign = "right";
    ctx.fillText((p.finished ? "✓ " : "") + p.name.substring(0, 13), startX + barW, y - 3);
    ctx.textAlign = "left";
  }

  // Expand / collapse toggle button (only when there are more than 3 players)
  if (hasMore) {
    const toggleY = 14 + showCount * rowH;
    const toggleW = barW + 28;
    const toggleH = 18;
    const toggleX = startX - 24;

    // Store toggle bounds for click detection
    drawHUD._toggleBounds = { x: toggleX, y: toggleY - 4, w: toggleW, h: toggleH + 4 };

    ctx.fillStyle = "rgba(4,8,20,0.85)";
    roundRect(ctx, toggleX, toggleY - 4, toggleW, toggleH + 4, 4);
    ctx.fill();
    ctx.strokeStyle = "rgba(0,212,255,0.3)";
    ctx.lineWidth = 1;
    roundRect(ctx, toggleX, toggleY - 4, toggleW, toggleH + 4, 4);
    ctx.stroke();

    ctx.fillStyle = "rgba(0,212,255,0.7)";
    ctx.font = "bold 9px 'Orbitron', monospace";
    ctx.textAlign = "center";

    if (!hudExpanded) {
      const remaining = sorted.length - COLLAPSED_COUNT;
      ctx.fillText(`▼ +${remaining} MORE`, toggleX + toggleW / 2, toggleY + 9);
    } else {
      // When expanded show scroll position + SHOW LESS
      const canScrollUp   = hudScrollOffset > 0;
      const canScrollDown = hudScrollOffset < sorted.length - maxFit;
      // Up / down arrows on left side of button
      const arrowX = toggleX + 14;
      ctx.fillStyle = canScrollUp ? "rgba(0,212,255,0.9)" : "rgba(0,212,255,0.2)";
      ctx.fillText("▲", arrowX, toggleY + 9);
      ctx.fillStyle = canScrollDown ? "rgba(0,212,255,0.9)" : "rgba(0,212,255,0.2)";
      ctx.fillText("▼", arrowX + 14, toggleY + 9);
      // Scroll position indicator
      ctx.fillStyle = "rgba(255,255,255,0.35)";
      ctx.font = "bold 8px 'Share Tech Mono', monospace";
      ctx.fillText(`${startIdx + 1}–${startIdx + showCount} / ${sorted.length}`, toggleX + toggleW / 2 + 10, toggleY + 9);
      // SHOW LESS on right
      ctx.fillStyle = "rgba(0,212,255,0.7)";
      ctx.font = "bold 9px 'Orbitron', monospace";
      ctx.textAlign = "right";
      ctx.fillText("▲ LESS", toggleX + toggleW - 4, toggleY + 9);
    }
    ctx.textAlign = "left";

    // Store scroll arrow bounds for click detection
    if (hudExpanded) {
      const arrowX = toggleX + 7;
      drawHUD._scrollUpBounds   = { x: arrowX,      y: toggleY - 4, w: 14, h: toggleH + 4 };
      drawHUD._scrollDownBounds = { x: arrowX + 14, y: toggleY - 4, w: 14, h: toggleH + 4 };
    } else {
      drawHUD._scrollUpBounds   = null;
      drawHUD._scrollDownBounds = null;
    }
  } else {
    drawHUD._toggleBounds     = null;
    drawHUD._scrollUpBounds   = null;
    drawHUD._scrollDownBounds = null;
  }

  // Spectate hint
  const hintY = 14 + showCount * rowH + (hasMore ? 28 : 8);
  ctx.fillStyle = "rgba(255,255,255,0.25)";
  ctx.font = "9px 'Share Tech Mono', monospace";
  ctx.textAlign = "right";
  ctx.fillText(spectateIndex >= 0 ? `👁 ${spectateTarget ? spectateTarget.name : ''} · [A] auto` : "click bar to spectate", canvas.width - 16, hintY);
  ctx.textAlign = "left";

  // Zone indicator
  const currentZone = zones_ref(cameraY + canvas.height / 2);
  const zw = 220;
  ctx.fillStyle = "rgba(4,8,20,0.75)";
  roundRect(ctx, 10, canvas.height - 44, zw, 30, 6);
  ctx.fill();
  ctx.strokeStyle = currentZone.color + "44";
  ctx.lineWidth = 1;
  roundRect(ctx, 10, canvas.height - 44, zw, 30, 6);
  ctx.stroke();
  ctx.fillStyle = currentZone.color;
  ctx.shadowColor = currentZone.color;
  ctx.shadowBlur = 8;
  ctx.font = "bold 11px 'Orbitron', monospace";
  ctx.fillText(currentZone.label, 20, canvas.height - 24);
  ctx.shadowBlur = 0;
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function zones_ref(y) {
  if (currentMap === 'bahamas') {
    if (y < 1400)  return { label: "ZONE 1 - BUBBLE BEACH",         color: "#88ddff" };
    if (y < 2800)  return { label: "ZONE 2 - NOSE BUMPER PIT",      color: "#ffaa44" };
    if (y < 4200)  return { label: "ZONE 3 - CORAL CASCADE",        color: "#44ffbb" };
    if (y < 5600)  return { label: "ZONE 4 - JELLYFISH SPIN",       color: "#ff8888" };
    if (y < 7000)  return { label: "ZONE 5 - SEAWEED SWAMP",        color: "#44bbff" };
    if (y < 8400)  return { label: "ZONE 6 - SHARK GAUNTLET",       color: "#ff4455" };
    if (y < 10000) return { label: "ZONE 7 - CORAL RAMP DESCENT",   color: "#ffee44" };
    if (y < 11400) return { label: "ZONE 8 - SNEEZE STORM",         color: "#dd44ff" };
    if (y < 12800) return { label: "ZONE 9 - PINBALL CRAB",         color: "#ff55cc" };
    if (y < 14200) return { label: "ZONE 10 - NOSTRIL WORMHOLE",    color: "#44ffee" };
    if (y < 16000) return { label: "ZONE 11 - TIDE AVALANCHE",      color: "#ffbb44" };
    if (y < 18000) return { label: "ZONE 12 - THE BIG SCHNOZZLE",   color: "#ff4400" };
    return                { label: "ZONE 13 - FINAL SCHNOZZLE",     color: "#ffffff" };
  }
  if (y < 1400)  return { label: "ZONE 1 - PEG FOREST",         color: "#4488ff" };
  if (y < 2800)  return { label: "ZONE 2 - BUMPER PIT",         color: "#ff8844" };
  if (y < 4200)  return { label: "ZONE 3 - PLATFORM CASCADE",   color: "#44ff88" };
  if (y < 5600)  return { label: "ZONE 4 - SPINNER HELL",       color: "#ff4444" };
  if (y < 7000)  return { label: "ZONE 5 - GRAVITY SWAMP",      color: "#44aaff" };
  if (y < 8400)  return { label: "ZONE 6 - KILL ZONE GAUNTLET", color: "#ff2244" };
  if (y < 10000) return { label: "ZONE 7 - FINAL DESCENT",      color: "#ffdd00" };
  if (y < 11400) return { label: "ZONE 8 - MIRROR MADNESS",     color: "#cc44ff" };
  if (y < 12800) return { label: "ZONE 9 - PINBALL PALACE",     color: "#ff44cc" };
  if (y < 14200) return { label: "ZONE 10 - WORMHOLE ALLEY",    color: "#44ffee" };
  if (y < 16000) return { label: "ZONE 11 - AVALANCHE",         color: "#ffaa00" };
  if (y < 18000) return { label: "ZONE 12 - THE GAUNTLET",      color: "#ff3300" };
  return                { label: "ZONE 13 - FINAL MILE",        color: "#ffffff" };
}

// ─── Bikini Bottom background element renderer ────────────────────────────────
function drawBBElement(type, t) {
  ctx.lineWidth = 2;
  switch(type) {
    case 'pineapple': {
      // SpongeBob's house — yellow pineapple
      ctx.fillStyle = '#eecc22';
      ctx.fillRect(-16, -40, 32, 50);
      ctx.fillStyle = '#cc9900';
      ctx.fillRect(-18, -10, 36, 20);
      // windows
      ctx.fillStyle = '#88eeff';
      ctx.fillRect(-10, -30, 8, 8);
      ctx.fillRect(4, -30, 8, 8);
      // leaves
      ctx.fillStyle = '#22aa22';
      ctx.beginPath(); ctx.moveTo(0,-40); ctx.lineTo(-12,-70); ctx.lineTo(0,-55); ctx.closePath(); ctx.fill();
      ctx.beginPath(); ctx.moveTo(0,-40); ctx.lineTo(12,-68); ctx.lineTo(0,-55); ctx.closePath(); ctx.fill();
      ctx.beginPath(); ctx.moveTo(0,-40); ctx.lineTo(0,-75); ctx.lineTo(5,-60); ctx.closePath(); ctx.fill();
      break;
    }
    case 'coral': {
      ctx.fillStyle = '#ff6644';
      ctx.strokeStyle = '#cc3322';
      // Three coral branches
      for (let i = -1; i <= 1; i++) {
        ctx.beginPath();
        ctx.moveTo(i*12, 20);
        ctx.bezierCurveTo(i*12-5, 0, i*20-5, -20, i*10, -40);
        ctx.lineWidth = 6 - Math.abs(i);
        ctx.strokeStyle = i === 0 ? '#ff4422' : '#ff8855';
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(i*10, -40, 5, 0, Math.PI*2);
        ctx.fillStyle = '#ffaaaa';
        ctx.fill();
      }
      break;
    }
    case 'rock': {
      ctx.fillStyle = '#888a99';
      ctx.beginPath();
      ctx.ellipse(0, 0, 30, 20, 0, 0, Math.PI*2);
      ctx.fill();
      ctx.fillStyle = '#aab0bb';
      ctx.beginPath();
      ctx.ellipse(-8, -5, 12, 8, -0.3, 0, Math.PI*2);
      ctx.fill();
      break;
    }
    case 'bubble': {
      const bub = Math.sin(t * 0.001 + Math.random()) * 3;
      ctx.beginPath();
      ctx.arc(0, bub, 12, 0, Math.PI*2);
      ctx.strokeStyle = 'rgba(180,240,255,0.7)';
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(-3, bub-4, 3, 0, Math.PI*2);
      ctx.fillStyle = 'rgba(255,255,255,0.5)';
      ctx.fill();
      break;
    }
    case 'fish': {
      // Cute cartoon fish
      ctx.fillStyle = '#ff8844';
      ctx.beginPath();
      ctx.ellipse(0, 0, 18, 10, 0, 0, Math.PI*2);
      ctx.fill();
      // Tail
      ctx.beginPath();
      ctx.moveTo(18, 0); ctx.lineTo(28, -10); ctx.lineTo(28, 10); ctx.closePath();
      ctx.fill();
      // Eye
      ctx.beginPath();
      ctx.arc(-8, -3, 3, 0, Math.PI*2);
      ctx.fillStyle = 'white'; ctx.fill();
      ctx.beginPath();
      ctx.arc(-8, -3, 1.5, 0, Math.PI*2);
      ctx.fillStyle = 'black'; ctx.fill();
      break;
    }
    case 'star': {
      ctx.fillStyle = '#ffdd44';
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2 - Math.PI/2;
        const b = a + Math.PI / 5;
        ctx.beginPath();
        ctx.moveTo(Math.cos(a)*20, Math.sin(a)*20);
        ctx.lineTo(Math.cos(b)*8,  Math.sin(b)*8);
        ctx.lineTo(Math.cos(a + Math.PI*2/5)*20, Math.sin(a + Math.PI*2/5)*20);
        ctx.fill();
      }
      break;
    }
    case 'seaweed': {
      ctx.strokeStyle = '#22bb44';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(0, 40);
      for (let y = 30; y > -60; y -= 12) {
        const wave = Math.sin((y + t*0.001) * 0.3) * 10;
        ctx.lineTo(wave, y);
      }
      ctx.stroke();
      break;
    }
  }
}

// ─── Loop ─────────────────────────────────────────────────────────────────────
function loop() {
  update();
  draw();
  requestAnimationFrame(loop);
}
loop();

// ─── WebSocket ────────────────────────────────────────────────────────────────
function connectWebSocket() {
  try {
    // Connect to same host/port the page was served from (works locally and hosted)
    const wsProto = location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl   = wsProto + "//" + location.host;
    const socket  = new WebSocket(wsUrl);

    socket.onopen = () => {
      console.log("Connected to game server");
      // Read chatroom config from window globals (game.html) OR directly from URL params (index.html)
      const urlParams  = new URLSearchParams(window.location.search);
      const chatroomId = window.KICK_CHATROOM_ID || parseInt(urlParams.get("chatroomId"), 10) || null;
      const channel    = window.KICK_CHANNEL     || urlParams.get("channel") || "";
      if (chatroomId) {
        console.log("Configuring chat: chatroomId=" + chatroomId + " channel=" + channel);
        socket.send(JSON.stringify({ type: "configure", chatroomId: chatroomId, channel: channel }));
      } else {
        console.warn("No chatroomId in URL — chat disabled. Use setup page or add ?chatroomId=XXXXX to URL.");
      }
    };

    socket.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === "join") addPlayer(data.username);
        if (data.type === "connected") {
          // Hide the connection overlay
          const overlay = document.getElementById("conn-overlay");
          if (overlay) overlay.classList.add("hidden");
          console.log("Chat connected for channel:", data.channel);
        }
      } catch (e) {}
    };

    socket.onerror = () => {
      console.warn("WebSocket error — standalone mode");
      const overlay = document.getElementById("conn-overlay");
      if (overlay) overlay.classList.add("hidden");
    };
    socket.onclose = () => {
      console.warn("WebSocket closed — retrying in 5s...");
      setTimeout(connectWebSocket, 5000);
    };
  } catch (e) {
    console.warn("Could not connect:", e);
    const overlay = document.getElementById("conn-overlay");
    if (overlay) overlay.classList.add("hidden");
  }
}
connectWebSocket();

// ─── Spectate click handler ───────────────────────────────────────────────────
canvas.addEventListener("click", e => {
  if (!raceStarted && !raceFinished) return;
  const rect = canvas.getBoundingClientRect();
  const mx = (e.clientX - rect.left) * (canvas.width / rect.width);
  const my = (e.clientY - rect.top) * (canvas.height / rect.height);

  // Check if click is on expand/collapse toggle
  const tb = drawHUD._toggleBounds;
  if (tb && mx >= tb.x && mx <= tb.x + tb.w && my >= tb.y && my <= tb.y + tb.h) {
    // Check scroll up arrow first
    const sub = drawHUD._scrollUpBounds;
    const sdb = drawHUD._scrollDownBounds;
    if (sub && mx >= sub.x && mx <= sub.x + sub.w) {
      hudScrollOffset = Math.max(0, hudScrollOffset - 1);
      return;
    }
    if (sdb && mx >= sdb.x && mx <= sdb.x + sdb.w) {
      hudScrollOffset++;
      return;
    }
    // Otherwise toggle expand/collapse
    hudExpanded = !hudExpanded;
    hudScrollOffset = 0;
    return;
  }

  // Check if click is on HUD bars (right side)
  const barW = 160, barH = 12, margin = 6;
  const rowH = barH + margin + 16;
  const startX = canvas.width - barW - 40;
  const sorted = [...players].sort((a,b) => a.rank - b.rank);
  const COLLAPSED_COUNT_CL = 3;
  const TOGGLE_H_CL = 26;
  const maxFitCL = Math.max(COLLAPSED_COUNT_CL, Math.floor((canvas.height - 14 - TOGGLE_H_CL) / rowH));
  const expandedCountCL = Math.min(sorted.length, maxFitCL);
  const showCount = hudExpanded ? expandedCountCL : Math.min(COLLAPSED_COUNT_CL, sorted.length);
  const startIdx = hudExpanded ? hudScrollOffset : 0;
  for (let i = 0; i < showCount; i++) {
    const barY = 14 + i * rowH - 14;
    if (mx >= startX && mx <= canvas.width - 10 && my >= barY && my <= barY + barH + 18) {
      const p = sorted[startIdx + i];
      if (p) { spectateIndex = players.indexOf(p); spectateTarget = p; }
      return;
    }
  }

  // Check if click on a marble in the world
  const worldY = my + cameraY;
  let found = false;
  players.forEach((p, i) => {
    if (Math.hypot(mx - p.x, worldY - p.y) < p.radius + 10) {
      spectateIndex = i;
      spectateTarget = p;
      found = true;
    }
  });
  if (!found) {
    spectateIndex = -1;
    spectateTarget = null;
  }
});

// ─── HUD scroll via mouse wheel ───────────────────────────────────────────────
canvas.addEventListener("wheel", e => {
  if (!hudExpanded) return;
  const tb = drawHUD._toggleBounds;
  if (!tb) return;
  const rect = canvas.getBoundingClientRect();
  const mx = (e.clientX - rect.left) * (canvas.width / rect.width);
  const my = (e.clientY - rect.top) * (canvas.height / rect.height);
  // Only intercept if mouse is over the HUD panel (right side)
  const hudLeft = canvas.width - 160 - 16 - 28;
  if (mx < hudLeft) return;
  e.preventDefault();
  hudScrollOffset += e.deltaY > 0 ? 1 : -1;
  hudScrollOffset = Math.max(0, hudScrollOffset);
}, { passive: false });

// ─── Dev shortcuts ────────────────────────────────────────────────────────────
window.addEventListener("keydown", e => {
  if (e.key === "j" || e.key === "J") addPlayer("User" + Math.floor(Math.random() * 1000));
  if (e.key === "s" || e.key === "S") startRace();
  if (e.key === "r" || e.key === "R") resetRace();
  // Spectate cycling with arrow keys
  if (e.key === "ArrowRight" && players.length > 0) {
    spectateIndex = (spectateIndex + 1) % players.length;
    spectateTarget = players[spectateIndex];
  }
  if (e.key === "ArrowLeft" && players.length > 0) {
    spectateIndex = (spectateIndex - 1 + players.length) % players.length;
    spectateTarget = players[spectateIndex];
  }
  if (e.key === "a" || e.key === "A") {
    spectateIndex = -1;
    spectateTarget = null;
  }
});
