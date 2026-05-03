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
}

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
}

function showWinner(name) {
  // Only show mid-race winner toast for 1st finisher; final screen shown later
  document.getElementById("winner-name").textContent = name;
  document.getElementById("winner-sub").textContent = "WINS THE RACE";
  const el = document.getElementById("winner-banner");
  el.style.display = "block";
  // Auto-hide after 4s if race still going
  setTimeout(() => {
    if (!raceFinished) el.style.display = "none";
  }, 4000);
}

function showFinalRankings() {
  const el = document.getElementById("winner-banner");
  const nameEl = document.getElementById("winner-name");
  const subEl = document.getElementById("winner-sub");
  const medals = ["🥇","🥈","🥉"];
  const rows = finalRankings.map((p,i) =>
    `<div style="font-size:${i===0?'28px':'18px'};color:${i===0?'#ffd700':i===1?'#ccc':i===2?'#cd7f32':'rgba(255,255,255,0.7)'};margin:4px 0">
      ${medals[i]||`#${i+1}`} ${p.name}
    </div>`
  ).join("");
  nameEl.innerHTML = `🏁 FINAL RANKINGS<br><div style="font-size:16px;margin-top:12px">${rows}</div>`;
  subEl.textContent = "";
  el.style.display = "block";
}

function hideWinner() {
  document.getElementById("winner-banner").style.display = "none";
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

  // Background: gradient based on camera zone
  const zoneColor = getZoneColor(cameraY + canvas.height / 2);
  const grad = ctx.createLinearGradient(0, 0, 0, canvas.height);
  grad.addColorStop(0, zoneColor);
  grad.addColorStop(1, "#080810");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.save();
  ctx.translate(0, -cameraY);

  // Zone labels
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

  // 🔵 Pegs
  pegs.forEach(peg => {
    ctx.beginPath();
    ctx.arc(peg.x, peg.y, 5, 0, Math.PI * 2);
    ctx.fillStyle = "#aabbcc";
    ctx.shadowColor = "#ffffff";
    ctx.shadowBlur = 3;
    ctx.fill();
    ctx.shadowBlur = 0;
  });

  // 🟠 Bumpers
  bumpers.forEach(b => {
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
  });

  // 🔴 Moving bars
  obstacles.forEach(o => {
    ctx.fillStyle = "#e03030";
    ctx.shadowColor = "#ff4444";
    ctx.shadowBlur = 8;
    ctx.fillRect(o.x, o.y, o.w, o.h);
    ctx.shadowBlur = 0;
  });

  // 🌀 Spinners
  spinners.forEach(s => {
    ctx.save();
    ctx.translate(s.x, s.y);
    ctx.rotate(s.angle);
    ctx.strokeStyle = "cyan";
    ctx.shadowColor = "cyan";
    ctx.shadowBlur = 14;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(-s.size, 0);
    ctx.lineTo(s.size, 0);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, -s.size);
    ctx.lineTo(0, s.size);
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.restore();
  });

  // 🟪 Bounce pads
  bouncePads.forEach(b => {
    ctx.fillStyle = "#44ff88";
    ctx.shadowColor = "#44ff88";
    ctx.shadowBlur = 12;
    ctx.fillRect(b.x, b.y, b.w, b.h);
    ctx.shadowBlur = 0;
  });

  // 🟩 Platforms (was narrow gates)
  narrowGates.forEach(g => {
    // Platform body
    const grad = ctx.createLinearGradient(g.gapX, g.y, g.gapX, g.y + 10);
    grad.addColorStop(0, "#55ee88");
    grad.addColorStop(1, "#228844");
    ctx.fillStyle = grad;
    ctx.shadowColor = "#44ff88";
    ctx.shadowBlur = 10;
    ctx.fillRect(g.gapX, g.y, g.gapWidth, 10);
    // Top highlight stripe
    ctx.fillStyle = "rgba(180,255,200,0.5)";
    ctx.fillRect(g.gapX, g.y, g.gapWidth, 2);
    ctx.shadowBlur = 0;
  });

  // 📐 Zigzag walls — thick ramps with glow
  zigzagWalls.forEach(w => {
    ctx.beginPath();
    ctx.moveTo(w.x1, w.y1);
    ctx.lineTo(w.x2, w.y2);
    ctx.strokeStyle = "#ffdd00";
    ctx.shadowColor = "#ffdd00";
    ctx.shadowBlur = 18;
    ctx.lineWidth = 14;
    ctx.lineCap = "round";
    ctx.stroke();
    // Bright highlight on top
    ctx.beginPath();
    ctx.moveTo(w.x1, w.y1);
    ctx.lineTo(w.x2, w.y2);
    ctx.strokeStyle = "rgba(255,255,180,0.6)";
    ctx.shadowBlur = 0;
    ctx.lineWidth = 3;
    ctx.stroke();
  });

  // 🌐 Gravity wells
  gravityWells.forEach(w => {
    ctx.beginPath();
    ctx.arc(w.x, w.y, 18, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(0,100,255,0.3)";
    ctx.fill();
    ctx.strokeStyle = "#4488ff";
    ctx.shadowColor = "#4488ff";
    ctx.shadowBlur = 20;
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.shadowBlur = 0;
    // Ripple rings
    for (let r = 40; r <= 200; r += 50) {
      ctx.beginPath();
      ctx.arc(w.x, w.y, r, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(68,136,255,${0.15 - r * 0.0005})`;
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  });

  // 🧊 Slow zones
  slowZones.forEach(s => {
    ctx.fillStyle = "rgba(30,100,255,0.25)";
    ctx.fillRect(s.x, s.y, s.w, s.h);
    ctx.strokeStyle = "#3366ff";
    ctx.lineWidth = 1;
    ctx.strokeRect(s.x, s.y, s.w, s.h);
    ctx.fillStyle = "rgba(150,200,255,0.7)";
    ctx.font = "10px monospace";
    ctx.fillText("SLOW", s.x + 4, s.y + 14);
  });

  // 💀 Kill zones
  killZones.forEach(k => {
    ctx.fillStyle = "rgba(200,0,0,0.75)";
    ctx.shadowColor = "red";
    ctx.shadowBlur = 14;
    ctx.fillRect(k.x, k.y, k.w, k.h);
    ctx.shadowBlur = 0;
    ctx.fillStyle = "white";
    ctx.font = "bold 11px monospace";
    ctx.fillText("☠ KILL", k.x + 4, k.y + 14);
  });

  // 🕳️ Portals
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
  const startX = canvas.width - barW - 16;

  // Sort players by rank for display
  const sorted = [...players].sort((a,b) => a.rank - b.rank);

  sorted.forEach((p, i) => {
    const progress = Math.min(1, p.y / LEVEL_HEIGHT);
    const y = 14 + i * (barH + margin + 16);

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
  });

  // Spectate hint
  const hintY = 14 + sorted.length * (barH + margin + 16) + 8;
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
  if (y < 1400)  return { label: "ZONE 1 — PEG FOREST",         color: "#4488ff" };
  if (y < 2800)  return { label: "ZONE 2 — BUMPER PIT",         color: "#ff8844" };
  if (y < 4200)  return { label: "ZONE 3 — PLATFORM CASCADE",   color: "#44ff88" };
  if (y < 5600)  return { label: "ZONE 4 — SPINNER HELL",       color: "#ff4444" };
  if (y < 7000)  return { label: "ZONE 5 — GRAVITY SWAMP",      color: "#44aaff" };
  if (y < 8400)  return { label: "ZONE 6 — KILL ZONE GAUNTLET", color: "#ff2244" };
  if (y < 10000) return { label: "ZONE 7 — FINAL DESCENT",      color: "#ffdd00" };
  if (y < 11400) return { label: "ZONE 8 — MIRROR MADNESS",     color: "#cc44ff" };
  if (y < 12800) return { label: "ZONE 9 — PINBALL PALACE",     color: "#ff44cc" };
  if (y < 14200) return { label: "ZONE 10 — WORMHOLE ALLEY",    color: "#44ffee" };
  if (y < 16000) return { label: "ZONE 11 — AVALANCHE",         color: "#ffaa00" };
  if (y < 18000) return { label: "ZONE 12 — THE GAUNTLET",      color: "#ff3300" };
  return                { label: "ZONE 13 — FINAL MILE",        color: "#ffffff" };
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

  // Check if click is on HUD bars (right side)
  const barW = 160, barH = 12, margin = 6;
  const startX = canvas.width - barW - 40;
  const sorted = [...players].sort((a,b) => a.rank - b.rank);
  for (let i = 0; i < sorted.length; i++) {
    const barY = 14 + i * (barH + margin + 16) - 14;
    if (mx >= startX && mx <= canvas.width - 10 && my >= barY && my <= barY + barH + 18) {
      spectateIndex = players.indexOf(sorted[i]);
      spectateTarget = sorted[i];
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