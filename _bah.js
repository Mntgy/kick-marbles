// --- BAHAMAS MAP ---
function generateBahamasLevel() {
  pegs = []; obstacles = []; spinners = []; bouncePads = [];
  portals = []; slowZones = []; killZones = []; gravityWells = [];
  narrowGates = []; zigzagWalls = []; bumpers = []; buffs = [];
  noseBumpers = []; sneezeZones = []; nostrilPortals = []; boogerSlimes = [];
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

  // ZONE 8: Sneeze Storm (y:10000-11400) - wall-to-wall sneeze zones + nose bumpers
  for (let i=0;i<10;i++) {
    const y=10060+i*140, fromLeft=i%2===0;
    zigzagWalls.push(fromLeft?{x1:0,y1:y,x2:W*0.55,y2:y+80}:{x1:W,y1:y,x2:W*0.45,y2:y+80});
  }
  [10200,10600,11000,11300].forEach((sy,i)=>{
    sneezeZones.push({x:0,y:sy,w:W,h:28,dir:i%2===0?1:-1,strength:6+i*1.5,phase:Math.random()*Math.PI*2,speed:0.03+Math.random()*0.015});
  });
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
} // end generateBahamasLevel