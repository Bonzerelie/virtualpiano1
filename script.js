(() => {
  // ======================================================================
  // ============================= CONFIG =================================
  // ======================================================================
  const START_OCTAVE_MAP = {
    2: 4, // 2 octaves start on C4
    3: 3, // 3 octaves start on C3
    4: 2, // 4 octaves start on C2
    5: 2  // 5 octaves start on C2
  };
  
  const END_ON_FINAL_C = true;

  const OUTER_H = 350; 
  const BORDER_PX = 19;
  const WHITE_W = 40;
  const WHITE_H = OUTER_H - (BORDER_PX * 2);
  const BLACK_W = Math.round(WHITE_W * 0.62);
  const BLACK_H = Math.round(WHITE_H * 0.63);
  const RADIUS = 18;
  const WHITE_CORNER_R = 10;

  // QWERTY mapping (C to C)
  const QWERTY_MAP = {
    'a': 0, 'w': 1, 's': 2, 'e': 3, 'd': 4,
    'f': 5, 't': 6, 'g': 7, 'y': 8, 'h': 9, 'u': 10, 'j': 11, 'k': 12
  };

  // ======================================================================
  // =========================== NOTE MAPS =================================
  // ======================================================================
  const WHITE_NOTES = ["C", "D", "E", "F", "G", "A", "B"];
  const WHITE_PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

  const BLACK_BY_WHITE_INDEX = {
    0: ["C#", "Db", 1],
    1: ["D#", "Eb", 3],
    3: ["F#", "Gb", 6],
    4: ["G#", "Ab", 8],
    5: ["A#", "Bb", 10],
  };

  const PC_NAMES = [
    { sharp: "C",  flat: "C"  },
    { sharp: "C#", flat: "Db" },
    { sharp: "D",  flat: "D"  },
    { sharp: "D#", flat: "Eb" },
    { sharp: "E",  flat: "E"  },
    { sharp: "F",  flat: "F"  },
    { sharp: "F#", flat: "Gb" },
    { sharp: "G",  flat: "G"  },
    { sharp: "G#", flat: "Ab" },
    { sharp: "A",  flat: "A"  },
    { sharp: "A#", flat: "Bb" },
    { sharp: "B",  flat: "B"  },
  ];

  const INTERVAL_INFO = {
    0:  { abbr: "P1", names: ["Unison", "Perfect 1st"] },
    1:  { abbr: "m2", names: ["Minor 2nd", "Semitone", "Half Step"] },
    2:  { abbr: "M2", names: ["Major 2nd", "Whole Step"] },
    3:  { abbr: "m3", names: ["Minor 3rd"] },
    4:  { abbr: "M3", names: ["Major 3rd"] },
    5:  { abbr: "P4", names: ["Perfect 4th"] },
    6:  { abbr: "TT", names: ["Tritone", "Augmented 4th", "Diminished 5th"] },
    7:  { abbr: "P5", names: ["Perfect 5th"] },
    8:  { abbr: "m6", names: ["Minor 6th"] },
    9:  { abbr: "M6", names: ["Major 6th"] },
    10: { abbr: "m7", names: ["Minor 7th"] },
    11: { abbr: "M7", names: ["Major 7th"] },
    12: { abbr: "P8", names: ["Octave"] },
  };

  // ======================================================================
  // ============================= DOM ====================================
  // ======================================================================
  const mount = document.getElementById("mount");
  const rangeSelect = document.getElementById("rangeSelect");
  const sustainSelect = document.getElementById("sustainSelect");
  const stopNotesBtn = document.getElementById("stopNotesBtn");
  const colorHighlight = document.getElementById("colorHighlight");
  
  const notesOut = document.getElementById("notesOut");
  const chordsOut = document.getElementById("chordsOut");

  // ======================================================================
  // ========================== STATE =====================================
  // ======================================================================
  let currentOctaves = 5;   
  let startOctave = 2; 
  let svg = null;

  // QWERTY config
  let qwertyBaseOctave = 4;
  const qwertyActivePitches = new Map(); 

  // ======================================================================
  // ============================== AUDIO =================================
  // ======================================================================
  const AUDIO_DIR = "audio";
  const LIMITER_THRESHOLD_DB = -6;    
  const STOP_FADE_SEC = 0.04;       
  const MAX_POLYPHONY = 20;

  const PC_TO_STEM = {
    0: "c", 1: "csharp", 2: "d", 3: "dsharp", 4: "e", 5: "f",
    6: "fsharp", 7: "g", 8: "gsharp", 9: "a", 10: "asharp", 11: "b"
  };

  let audioCtx = null;
  let masterGain = null;
  let limiter = null;

  const bufferPromiseCache = new Map();
  const activeVoices = new Set(); 

  function ensureAudioGraph() {
    if (audioCtx) return audioCtx;

    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) {
      alert("Your browser doesn’t support Web Audio (required for playback).");
      return null;
    }

    audioCtx = new Ctx();
    masterGain = audioCtx.createGain();
    masterGain.gain.value = 0.9;

    limiter = audioCtx.createDynamicsCompressor();
    limiter.threshold.value = LIMITER_THRESHOLD_DB;
    limiter.knee.value = 0;
    limiter.ratio.value = 20;
    limiter.attack.value = 0.001;
    limiter.release.value = 0.12;

    masterGain.connect(limiter);
    limiter.connect(audioCtx.destination);
    return audioCtx;
  }

  async function resumeAudioIfNeeded() {
    const ctx = ensureAudioGraph();
    if (!ctx) return;
    if (ctx.state === "suspended") {
      try { await ctx.resume(); } catch {}
    }
  }

  function noteUrl(stem, octaveNum) {
    return `${AUDIO_DIR}/${stem}${octaveNum}.mp3`;
  }

  function getKeyAudioInfo(group) {
    const pc = Number(group.getAttribute("data-pc"));
    const oct = Number(group.getAttribute("data-oct"));
    const stem = PC_TO_STEM[(pc + 12) % 12];
    if (!stem || Number.isNaN(oct)) return null;
    return { pc, oct, stem, url: noteUrl(stem, oct) };
  }

  function loadBuffer(url) {
    if (bufferPromiseCache.has(url)) return bufferPromiseCache.get(url);
    const p = (async () => {
      const ctx = ensureAudioGraph();
      if (!ctx) return null;
      try {
        const res = await fetch(url);
        if (!res.ok) return null;
        const ab = await res.arrayBuffer();
        return await ctx.decodeAudioData(ab);
      } catch {
        return null;
      }
    })();
    bufferPromiseCache.set(url, p);
    return p;
  }

  function stopAllNotes() {
    const voices = Array.from(activeVoices);
    voices.forEach(v => stopVoice(v));
  }

  function stopVoice(voice) {
    if (!voice || !voice.src) return;
    const ctx = ensureAudioGraph();
    if (!ctx) return;
    const now = ctx.currentTime;

    try {
      voice.gain.gain.cancelScheduledValues(now);
      voice.gain.gain.setTargetAtTime(0, now, STOP_FADE_SEC / 6);
      voice.src.stop(now + STOP_FADE_SEC + 0.02);
    } catch(e) {}

    setTimeout(() => { cleanupVoice(voice); }, STOP_FADE_SEC * 1000 + 50);
  }

  function cleanupVoice(voice) {
    activeVoices.delete(voice);
    
    // Manage visual active state
    let stillPlaying = false;
    for (let v of activeVoices) {
      if (v.abs === voice.abs) {
        stillPlaying = true;
        break;
      }
    }

    if (!stillPlaying && voice.keyNode) {
      voice.keyNode.classList.remove('playing');
    }
    updateAnalysis();
  }

  function enforcePolyphony() {
    if (activeVoices.size >= MAX_POLYPHONY) {
      const oldest = activeVoices.values().next().value;
      if (oldest) stopVoice(oldest);
    }
  }

  async function playNoteAudio(abs, keyNode) {
    const info = getKeyAudioInfo(keyNode);
    if (!info) return;

    // Apply immediate visual state update before fetching/decoding starts
    keyNode.classList.add('playing');
    updateAnalysis();

    await resumeAudioIfNeeded();
    const buf = await loadBuffer(info.url);
    if (!buf) {
      // Revert if buffer fails and no other active voice uses this key
      let stillPlaying = Array.from(activeVoices).some(v => v.abs === abs);
      if (!stillPlaying) {
        keyNode.classList.remove('playing');
        updateAnalysis();
      }
      return;
    }

    const ctx = ensureAudioGraph();
    const now = ctx.currentTime;

    enforcePolyphony();

    const src = ctx.createBufferSource();
    src.buffer = buf;
    
    // Equal power smoothing
    const voicesPlaying = Math.max(1, activeVoices.size + 1);
    const polyphonyGain = Math.min(1, 0.9 / Math.sqrt(voicesPlaying));

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(polyphonyGain, now + 0.004);

    src.connect(gain);
    gain.connect(masterGain);

    // Save the sustain mode chosen exactly when this note started
    const currentSustainMode = sustainSelect.value;
    
    const voice = { id: Date.now() + Math.random(), src, gain, abs, keyNode, startTime: now, sustainMode: currentSustainMode };
    activeVoices.add(voice);

    if (currentSustainMode === '0.5' || currentSustainMode === '2' || currentSustainMode === '4') {
      const dur = parseFloat(currentSustainMode);
      setTimeout(() => { stopVoice(voice); }, dur * 1000);
    }

    src.onended = () => { cleanupVoice(voice); };
    src.start(now);
  }

  // Interaction handlers
  function handleNoteInteractionStart(abs) {
    const keyNode = svg?.querySelector(`.key[data-abs="${abs}"]`);
    if(!keyNode) return;
    triggerFlash(keyNode);
    playNoteAudio(abs, keyNode);
  }

  function handleNoteInteractionEnd(abs) {
    for (let v of activeVoices) {
      if (v.abs === abs && v.sustainMode === 'release') stopVoice(v);
    }
  }

  // ======================================================================
  // ========================= SVG HELPERS =================================
  // ======================================================================
  const SVG_NS = "http://www.w3.org/2000/svg";

  function el(name, attrs = {}, children = []) {
    const n = document.createElementNS(SVG_NS, name);
    for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v));
    for (const ch of children) n.appendChild(ch);
    return n;
  }

  function hexToRgb(hex) {
    const h = String(hex).replace("#", "").trim();
    const full = h.length === 3 ? h.split("").map(x => x + x).join("") : h;
    const num = parseInt(full, 16);
    return { r: (num >> 16) & 255, g: (num >> 8) & 255, b: num & 255 };
  }
  function rgbToHex(r, g, b) {
    const to = (x) => x.toString(16).padStart(2, "0");
    return `#${to(r)}${to(g)}${to(b)}`;
  }
  function darken(hex, amount01) {
    const { r, g, b } = hexToRgb(hex);
    const k = Math.max(0, Math.min(1, amount01));
    return rgbToHex(
      Math.round(r * (1 - k)), Math.round(g * (1 - k)), Math.round(b * (1 - k))
    );
  }
  function lighten(hex, amount01) {
    const { r, g, b } = hexToRgb(hex);
    const k = Math.max(0, Math.min(1, amount01));
    return rgbToHex(
      Math.round(r + (255 - r) * k), Math.round(g + (255 - g) * k), Math.round(b + (255 - b) * k)
    );
  }

  function pcNameSingle(pc) { return PC_NAMES[(pc + 12) % 12].sharp; }
  function pcNameBoth(pc) {
    const p = PC_NAMES[(pc + 12) % 12];
    return p.sharp === p.flat ? p.sharp : `${p.sharp}/${p.flat}`;
  }

  function escHtml(s) {
    return String(s).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
  }

  function intervalDisplay(semi) {
    const s0 = ((semi % 12) + 12) % 12;
    const s = (semi !== 0 && s0 === 0) ? 12 : s0;
    const info = INTERVAL_INFO[s];
    if (!info) return `${s} semitones`;
    return `${info.names.join(" / ")} (${info.abbr})`;
  }

  function uniqueByOrder(arr) {
    const seen = new Set(); const out = [];
    for (const x of arr) {
      if (seen.has(x)) continue; seen.add(x); out.push(x);
    }
    return out;
  }

  function outerRoundedWhitePath(x, y, w, h, r, roundLeft, roundRight) {
    const rr = Math.max(0, Math.min(r, Math.min(w / 2, h / 2)));
    if (roundLeft) {
      return [ `M ${x + rr} ${y}`, `H ${x + w}`, `V ${y + h}`, `H ${x + rr}`, `A ${rr} ${rr} 0 0 1 ${x} ${y + h - rr}`, `V ${y + rr}`, `A ${rr} ${rr} 0 0 1 ${x + rr} ${y}`, `Z` ].join(" ");
    }
    return [ `M ${x} ${y}`, `H ${x + w - rr}`, `A ${rr} ${rr} 0 0 1 ${x + w} ${y + rr}`, `V ${y + h - rr}`, `A ${rr} ${rr} 0 0 1 ${x + w - rr} ${y + h}`, `H ${x}`, `V ${y}`, `Z` ].join(" ");
  }

  function bindKeyEvents(g, abs) {
    const start = (e) => { e.preventDefault(); handleNoteInteractionStart(abs); };
    const end = (e) => { e.preventDefault(); handleNoteInteractionEnd(abs); };
    const enter = (e) => { if (e.buttons === 1) handleNoteInteractionStart(abs); };

    g.addEventListener("mousedown", start);
    g.addEventListener("mouseenter", enter);
    g.addEventListener("mouseup", end);
    g.addEventListener("mouseleave", end);

    g.addEventListener("touchstart", start);
    g.addEventListener("touchend", end);
    g.addEventListener("touchcancel", end);
  }

  function makeWhiteKey(x, y, w, h, label, noteName, pc, abs, id, roundLeft, roundRight, octaveNum) {
    const shape = (roundLeft || roundRight)
      ? el("path", { d: outerRoundedWhitePath(x, y, w, h, WHITE_CORNER_R, roundLeft, roundRight) })
      : el("rect", { x, y, width: w, height: h });
    const text = el("text", { x: x + w / 2, y: y + h - 16, "text-anchor": "middle" });
    text.textContent = label;

    const g = el("g", { class: "key white", "data-id": id, "data-pc": pc, "data-abs": abs, "data-note": noteName, "data-oct": octaveNum }, [shape, text]);
    bindKeyEvents(g, abs);
    return g;
  }

  function makeBlackKey(x, y, w, h, sharpName, flatName, pc, abs, id, octaveNum) {
    const rect = el("rect", { x, y, width: w, height: h, rx: 4, ry: 4 });
    const text = el("text", { x: x + w / 2, y: y + Math.round(h * 0.46), "text-anchor": "middle" });
    const t1 = el("tspan", { x: x + w / 2, dy: "-6" }); t1.textContent = sharpName;
    const t2 = el("tspan", { x: x + w / 2, dy: "14" }); t2.textContent = flatName;
    text.appendChild(t1); text.appendChild(t2);

    const g = el("g", { class: "key black", "data-id": id, "data-pc": pc, "data-abs": abs, "data-oct": octaveNum }, [rect, text]);
    bindKeyEvents(g, abs);
    return g;
  }

  // ======================================================================
  // ============================ BUILD SVG ================================
  // ======================================================================
  function buildKeyboard(octaves, startOct) {
    stopAllNotes(); 
    const totalWhite = octaves * 7 + (END_ON_FINAL_C ? 1 : 0);
    const innerW = totalWhite * WHITE_W;
    const outerW = innerW + (BORDER_PX * 2);

    svg = el("svg", { width: outerW, height: OUTER_H, viewBox: `0 0 ${outerW} ${OUTER_H}`, preserveAspectRatio: "xMidYMid meet" });

    const style = document.createElementNS(SVG_NS, "style");
    style.textContent = `
      .white rect, .white path { fill:#fff; stroke:#222; stroke-width:1; }
      .white text { font-family: Arial, Helvetica, sans-serif; font-size:14px; fill:#9a9a9a; pointer-events:none; user-select:none; }
      .white.playing rect, .white.playing path { fill: var(--hl); }
      .white.playing text { fill: var(--hlText); font-weight:700; }
      
      .black rect { fill: url(#blackGrad); stroke:#111; stroke-width:1; }
      .black text { font-family: Arial, Helvetica, sans-serif; font-size:12px; fill:#fff; pointer-events:none; user-select:none; opacity:0; }
      .black.playing rect { fill: url(#hlBlackGrad); }
      .black.playing text { opacity:1; }
      
      .key { cursor:pointer; }
      .key.flash { animation: keyGlow 320ms ease-out; }
      .white.flash rect, .white.flash path { animation: whiteFlash 320ms ease-out; }
      
      @keyframes whiteFlash { 
        0% { fill: var(--flash); } 
        100% { fill: var(--hl); } 
      }
      @keyframes keyGlow { 
        0% { filter: drop-shadow(0 0 10px var(--flash)); } 
        100% { filter: drop-shadow(0 0 0px rgba(0,0,0,0)); } 
      }
    `;
    svg.appendChild(style);

    const defs = el("defs");
    defs.appendChild(el("linearGradient", { id: "blackGrad", x1: "0", y1: "0", x2: "0", y2: "1" }, [
      el("stop", { offset: "0%", "stop-color": "#3a3a3a" }), el("stop", { offset: "100%", "stop-color": "#000000" }),
    ]));
    defs.appendChild(el("linearGradient", { id: "hlBlackGrad", x1: "0", y1: "0", x2: "0", y2: "1" }, [
      el("stop", { id: "hlStopTop", offset: "0%", "stop-color": "#4da3ff" }), el("stop", { id: "hlStopBot", offset: "100%", "stop-color": "#1f4a73" }),
    ]));
    svg.appendChild(defs);

    svg.appendChild(el("rect", { x: BORDER_PX / 2, y: BORDER_PX / 2, width: outerW - BORDER_PX, height: OUTER_H - BORDER_PX, rx: RADIUS, ry: RADIUS, fill: "#ffffff", stroke: "#000000", "stroke-width": BORDER_PX }));

    const gWhite = el("g"); const gBlack = el("g");
    svg.appendChild(gWhite); svg.appendChild(gBlack);

    for (let i = 0; i < totalWhite; i++) {
      const noteName = WHITE_NOTES[i % 7];
      const octIndex = Math.floor(i / 7);
      const octaveNum = startOct + octIndex;
      const label = (noteName === "C" && octaveNum === 4) ? "C4" : noteName;
      gWhite.appendChild(makeWhiteKey(
        BORDER_PX + (i * WHITE_W), BORDER_PX, WHITE_W, WHITE_H, label, noteName, 
        WHITE_PC[noteName], (octIndex * 12) + WHITE_PC[noteName], 
        `W|${octIndex}|${noteName}`, i === 0, i === totalWhite - 1, octaveNum
      ));
    }

    for (let oct = 0; oct < octaves; oct++) {
      Object.entries(BLACK_BY_WHITE_INDEX).forEach(([whiteI, info]) => {
        const x = BORDER_PX + (((oct * 7) + Number(whiteI)) * WHITE_W) + WHITE_W - (BLACK_W / 2);
        gBlack.appendChild(makeBlackKey(
          x, BORDER_PX, BLACK_W, BLACK_H, info[0], info[1], info[2], 
          (oct * 12) + info[2], `B|${oct}|${info[0]}`, startOct + oct
        ));
      });
    }

    mount.innerHTML = ""; mount.appendChild(svg);
    applyHighlightColor();
    updateAnalysis();
  }

  // ======================================================================
  // ========================= COLOUR HANDLING =============================
  // ======================================================================
  function applyHighlightColor() {
    if (!svg) return;
    const c = colorHighlight.value;
    svg.style.setProperty("--hl", c);
    svg.style.setProperty("--hlText", darken(c, 0.45));
    svg.style.setProperty("--flash", lighten(c, 0.22)); 
    const nodeTop = svg.querySelector(`#hlStopTop`);
    const nodeBot = svg.querySelector(`#hlStopBot`);
    if (nodeTop) nodeTop.setAttribute("stop-color", c);
    if (nodeBot) nodeBot.setAttribute("stop-color", darken(c, 0.35));
  }
  colorHighlight.addEventListener("input", applyHighlightColor);

  function triggerFlash(group) {
    if (!svg) return;
    group.classList.remove("flash");
    try { group.getBBox(); } catch {}
    group.classList.add("flash");
    setTimeout(() => {
      group.classList.remove("flash");
    }, 320);
  }

  // ======================================================================
  // ============================ UI CONTROLS ==============================
  // ======================================================================
  function setRangePreset(preset) {
    currentOctaves = Number(preset);
    startOctave = START_OCTAVE_MAP[currentOctaves];
    buildKeyboard(currentOctaves, startOctave);
  }

  rangeSelect.addEventListener("change", (e) => {
    setRangePreset(e.target.value);
    rangeSelect.blur(); 
  });
  
  stopNotesBtn.addEventListener("click", stopAllNotes);
  
  sustainSelect.addEventListener("change", () => sustainSelect.blur());

  // ======================================================================
  // ============================ QWERTY INPUT =============================
  // ======================================================================
  window.addEventListener('keydown', e => {
    if (e.target.tagName === "INPUT" || e.target.tagName === "SELECT") return;
    if (e.key === ' ') { e.preventDefault(); stopAllNotes(); return; }
    
    // Shift octaves
    if (e.key === '-' || e.key === '_') {
      qwertyBaseOctave = Math.max(1, qwertyBaseOctave - 1);
      return;
    }
    if (e.key === '=' || e.key === '+') {
      qwertyBaseOctave = Math.min(6, qwertyBaseOctave + 1);
      return;
    }

    if (e.repeat) return;

    const keyChar = e.key.toLowerCase();
    if (QWERTY_MAP[keyChar] !== undefined) {
      const pcOffset = QWERTY_MAP[keyChar];
      const abs = ((qwertyBaseOctave - startOctave) * 12) + pcOffset;
      qwertyActivePitches.set(keyChar, abs);
      handleNoteInteractionStart(abs);
    }
  });

  window.addEventListener('keyup', e => {
    const keyChar = e.key.toLowerCase();
    if (qwertyActivePitches.has(keyChar)) {
      const abs = qwertyActivePitches.get(keyChar);
      qwertyActivePitches.delete(keyChar);
      handleNoteInteractionEnd(abs);
    }
  });

  // ======================================================================
  // ===================== CHORD DETECTION =================================
  // ======================================================================
  function getPlayingKeys() {
    if (!svg) return [];
    const nodes = [...svg.querySelectorAll(".key.playing")];
    return nodes.map(n => ({
      pc: Number(n.getAttribute("data-pc")),
      abs: Number(n.getAttribute("data-abs")),
    })).sort((a, b) => a.abs - b.abs);
  }

  function intervalSetForRoot(pcSet, rootPc) {
    const out = new Set();
    for (const pc of pcSet) out.add(((pc - rootPc) + 12) % 12);
    out.add(0);
    return out;
  }

  function classifyChordStrict(iv, rootPc, bassPc) {
    const has = (n) => iv.has(n);
    const M3 = has(4), m3 = has(3), P5 = has(7), b5 = has(6), aug5 = has(8);
    const M7 = has(11), m7 = has(10), M6 = has(9);
    
    let quality = null;
    if (M3 && P5) quality = "maj";
    else if (m3 && P5) quality = "min";
    else if (m3 && b5) quality = "dim";
    else if (M3 && aug5) quality = "aug";
    else if (!M3 && !m3 && P5) {
      if (has(2)) quality = "sus2";
      if (has(5)) quality = "sus4";
      if (!has(2) && !has(5)) quality = "5";
    }

    if (!quality) return null;

    let ext = "";
    if (M7) ext = "maj7";
    else if (m7) ext = "7";
    else if (M6) ext = "6";

    let base = "";
    if (quality === "maj") base = ext; 
    else if (quality === "min") {
        if (ext === "maj7") base = "m(maj7)";
        else if (ext) base = `m${ext}`;
        else base = "m";
    }
    else if (quality === "dim") {
        if (ext === "7") base = "m7b5";
        else if (M6 && !m7 && !M7) base = "dim7"; 
        else base = "dim";
    }
    else if (quality === "aug") base = ext ? `aug${ext}` : "aug";
    else base = ext ? `${quality}${ext}` : quality;

    let score = 5;
    if (rootPc === bassPc) score += 2; // Favor root position over inversions
    if (ext === "6") score -= 0.5; // Slight deduction so standard 7ths win ties unless bass dictates otherwise

    const invSuffix = rootPc !== bassPc ? `/${pcNameSingle(bassPc)}` : "";
    const names = [`${pcNameSingle(rootPc)}${base}${invSuffix}`];

    return { names, score };
  }

  function detectOneBestChord(pcSet, bassPc) {
    const pcs = [...pcSet].sort((a,b)=>a-b);
    if (!pcs.length) return null;

    let best = null;
    for (const rootPc of pcs) {
      const iv = intervalSetForRoot(pcSet, rootPc);
      const res = classifyChordStrict(iv, rootPc, bassPc);
      if (res && (!best || res.score > best.score)) {
        best = { rootPc, names: res.names, score: res.score };
      }
    }
    return best;
  }

  // ======================================================================
  // ===================== LIVE ANALYSIS OUTPUT ============================
  // ======================================================================
  function updateAnalysis() {
    if (!svg) return;
    const keys = getPlayingKeys();

    if (!keys.length) {
      notesOut.textContent = "—";
      chordsOut.innerHTML = "—";
      return;
    }

    const pcsInOrder = uniqueByOrder(keys.map(k => k.pc));
    const pcSet = new Set(pcsInOrder);
    const bassPc = keys[0].pc; // Lowest key acts as bass

    notesOut.textContent = pcsInOrder.map(pc => pcNameBoth(pc)).join(", ");

    if (keys.length === 1) {
      chordsOut.innerHTML = `<ul class="chordList"><li class="chordPrimary">${escHtml(intervalDisplay(0))}</li></ul>`;
      return;
    }

    if (keys.length === 2) {
      const semi = Math.abs(keys[1].abs - keys[0].abs) % 12 || 12;
      chordsOut.innerHTML = `<ul class="chordList"><li class="chordPrimary">${escHtml(intervalDisplay(semi))}</li></ul>`;
      return;
    }

    const detected = detectOneBestChord(pcSet, bassPc);
    if (!detected) {
      chordsOut.innerHTML = `<div class="muted">No standard chord detected</div>`;
      return;
    }

    const items = detected.names.map(name => `<li class="chordPrimary">${escHtml(name)}</li>`).join("");
    chordsOut.innerHTML = `<ul class="chordList">${items}</ul>`;
  }

  // INIT
  setRangePreset("5");
})();