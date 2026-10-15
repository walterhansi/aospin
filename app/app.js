// aoSPIN – virtuelle Rennen auf dem Spinningrad, gesteuert über den Puls
(() => {
  "use strict";
  const $ = id => document.getElementById(id);
  const APP_VERSION = document.querySelector('meta[name="app-version"]').content;
  const DEV = APP_VERSION.startsWith("__");
  const params = new URLSearchParams(location.search);
  // Nur zum Testen: ?speed=20 lässt Rennen 20-mal schneller ablaufen
  const SPEED = Math.max(1, Math.min(200, Number(params.get("speed")) || 1));

  const load = (k, d) => { try { const v = localStorage.getItem("aos_" + k); return v === null ? d : JSON.parse(v); } catch { return d; } };
  const save = (k, v) => { try { localStorage.setItem("aos_" + k, JSON.stringify(v)); } catch {} };
  const drop = k => { try { localStorage.removeItem("aos_" + k); } catch {} };
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const now = () => Date.now();

  // ---------- Farben ----------
  const ZC = ["#00b5a6", "#124f92", "#247d4d", "#f9a73b", "#cc2d3f"];
  const ZN = ["Regeneration", "Grundlage", "Tempo", "Schwelle", "Maximal"];
  const BELOW = "#23252e", NOSIG = "#131419";
  function lum(hex) {
    const c = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).map(x => x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4);
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  }
  // Schrift mit dem größten Kontrast zur Fläche
  const textOn = hex => ((lum(hex) + 0.05) / 0.05 > 1.05 / (lum(hex) + 0.05) ? "#000000" : "#ffffff");

  // ---------- Einstellungen ----------
  const DEF = { hf: 172, hfEst: true, rp: 58, zones: [115, 126, 138, 149, 161], z5Sec: 120, abort: 165,
    drift: true, sound: true, metro: true, sim: false, simHr: 120, course: 3, format: 0, goal: 3, diff: 1 };
  const S = Object.assign({}, DEF, load("settings", {}));
  const saveS = () => save("settings", S);

  // ---------- Widerstandsstellungen (Umdrehungen ab Anschlag offen) ----------
  const LV = ["0", "1", "1½", "2", "2¼", "2½", "2¾", "3"];
  const TURNS = [0, 1, 1.5, 2, 2.25, 2.5, 2.75, 3];
  function fracTxt(d) {
    const w = Math.floor(d + 1e-9), r = Math.round((d - w) * 4) / 4;
    const f = r === 0.25 ? "¼" : r === 0.5 ? "½" : r === 0.75 ? "¾" : "";
    return (w > 0 ? String(w) : "") + f;
  }
  function turnText(from, to) {
    const d = TURNS[to] - TURNS[from];
    if (Math.abs(d) < 1e-9) return "Stellung passt";
    const a = Math.abs(d);
    return fracTxt(a) + (a > 1 ? " Umdrehungen " : " Umdrehung ") + (d > 0 ? "fester" : "lockerer");
  }

  // ---------- Strecken: Abschnitte [Länge in m, Steigung in %] ----------
  const COURSES = [
    { id: "flach", name: "Flachland", text: "Grundlage, kaum Steigung", bg: ZC[1],
      segs: [[3000, 0], [2000, 0.5], [3000, -0.3], [4000, 0.8], [2000, 0], [3000, -0.5], [3000, 0.6], [4000, 0]] },
    { id: "huegel", name: "Hügelrunde", text: "Sanfte Wellen", bg: ZC[2],
      segs: [[1500, 0], [1200, 3], [1000, -2.5], [1500, 0.5], [1500, 3.5], [1300, -3], [1500, 1], [1000, 4], [1200, -3.5], [1500, 0], [1300, 2.5], [1500, -1], [1500, 0]] },
    { id: "krit", name: "Kriterium", text: "Kurzer Rundkurs, 12 Runden", bg: "#c2185b", laps: 12,
      segs: [[400, 0], [200, 4], [400, -2], [400, 0]] },
    { id: "klassiker", name: "Klassiker", text: "Kurze, steile Anstiege", bg: ZC[3],
      segs: [[3000, 0.5], [800, 8], [1500, -3], [2500, 0], [600, 10], [2000, -2], [3000, 0.5], [1000, 7], [1500, -3], [2500, 0], [700, 9], [1900, 0]] },
    { id: "alpen", name: "Alpenpass", text: "Ein langer Anstieg", bg: ZC[4],
      segs: [[2000, 0.5], [1000, 3], [2000, 5.5], [2000, 7], [1500, 6], [1000, 8], [1500, 4.5]] },
    { id: "zf", name: "Zeitfahrkurs", text: "Flach, gegen die Uhr", bg: ZC[0],
      segs: [[5000, 0], [2500, 0.8], [2500, -0.8], [5000, 0]] },
  ];
  for (const c of COURSES) {
    const segs = c.laps ? Array.from({ length: c.laps }, () => c.segs).flat() : c.segs;
    c.lapLen = c.segs.reduce((s, x) => s + x[0], 0);
    c.all = []; let d = 0, e = 0;
    for (const [len, g] of segs) { c.all.push({ d0: d, d1: d + len, g, e0: e }); d += len; e += len * g / 100; }
    c.total = d;
  }
  function segAt(c, d) {
    d = clamp(d, 0, c.total - 0.001);
    let lo = 0, hi = c.all.length - 1;
    while (lo < hi) { const m = (lo + hi) >> 1; if (c.all[m].d1 <= d) lo = m + 1; else hi = m; }
    return c.all[lo];
  }
  const gradeAt = (c, d) => segAt(c, d).g;
  const elevAt = (c, d) => { const s = segAt(c, d); return s.e0 + (clamp(d, 0, c.total) - s.d0) * s.g / 100; };
  // Abschnittsart nach Steigung
  const klass = g => g < -1.5 ? 0 : g < 2 ? 1 : g < 5 ? 2 : 3;
  const KLASS = ["Abfahrt", "Flachstück", "Anstieg", "Steiler Anstieg"];

  // ---------- Physik ----------
  const RHO = 1.2, CDA = 0.32, CRR = 0.005, G = 9.81;
  function speedFor(W, grade, m, cda = CDA) {
    const th = Math.atan(grade / 100);
    const c = CRR * m * G * Math.cos(th) + m * G * Math.sin(th), a = 0.5 * RHO * cda;
    let lo = 0.05, hi = 30;
    for (let i = 0; i < 40; i++) { const v = (lo + hi) / 2; if (a * v * v * v + c * v - W > 0) hi = v; else lo = v; }
    return clamp((lo + hi) / 2, 1, 22);
  }
  const eOf = hr => (hr - S.rp) / Math.max(20, S.hf - S.rp);
  const wattsFromE = e => 40 + 240 * clamp((e - 0.45) / 0.5, 0, 1.1);

  // ---------- Ziele, Formate, Gegner ----------
  const GOALS = [
    { name: "Grundlage", zone: 1, parE: 0.66, text: () => `Tempo steigt bis ${S.zones[2] - 1} bpm (Zone 2). Darüber gibt es keinen Gewinn – Disziplin gewinnt.`, cap: () => S.zones[2] - 1 },
    { name: "Tempo", zone: 2, parE: 0.75, text: () => `Bestes Tempo in Zone 3 (${S.zones[2]}–${S.zones[3] - 1} bpm). Kurze Antritte sind erlaubt.`, cap: () => S.zones[3] - 1 },
    { name: "Intervalle", zone: 2, parE: 0.74, text: () => "Anstiege und der Schlusssprint sind hart (Zone 4/5), dazwischen Zone 3.", cap: hard => hard ? S.hf : S.zones[3] - 1 },
    { name: "Frei", zone: 3, parE: 0.8, text: () => `Tempo steigt bis Zone 5. Hinweis ab ${S.zones[4]} bpm nach ${S.z5Sec} s.`, cap: () => S.hf },
  ];
  const FORMATS = ["5 Gegner", "Ghost", "Zeitfahren"];
  const BOTS = [
    { id: "A", name: "Ausreißer", color: "#cc2d3f", m: 75 },
    { id: "B", name: "Bergfloh", color: "#247d4d", m: 64 },
    { id: "D", name: "Diesel", color: "#00b5a6", m: 80 },
    { id: "S", name: "Sprinter", color: "#f9a73b", m: 82 },
    { id: "L", name: "Lutscher", color: "#c2185b", m: 74 },
  ];
  function botFactor(id, p, g) {
    switch (id) {
      case "A": return p < 0.5 ? 1.07 : 1.07 - (p - 0.5) * 0.24;
      case "B": return g > 3 ? 1.1 : 0.95;
      case "S": return p > 0.93 ? 1.25 : 0.97;
      case "L": return p < 0.7 ? 0.97 : 1.04;
      default: return 1;
    }
  }
  const parW = goal => wattsFromE(GOALS[goal].parE);
  function estimateMin(ci, goal) {
    const c = COURSES[ci], W = parW(goal); let d = 0, t = 0;
    while (d < c.total && t < 36000) { d += speedFor(W, gradeAt(c, d), 80) * 2; t += 2; }
    return Math.round(t / 60);
  }

  // ---------- Formatierung ----------
  const fmtT = s => { s = Math.max(0, Math.round(s)); const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), x = s % 60;
    return (h ? h + ":" + String(m).padStart(2, "0") : m) + ":" + String(x).padStart(2, "0"); };
  const fmtGap = s => (s < 0 ? "−" : "+") + fmtT(Math.abs(s));
  const km = (m, dec = 1) => (m / 1000).toFixed(dec).replace(".", ",");
  const fmtDate = ts => new Date(ts).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "2-digit" });

  // ---------- Hinweise ----------
  let toastT = null;
  function toast(msg, err = false, ms = 3500) {
    const t = $("toast"); t.textContent = msg; t.className = err ? "err" : ""; t.hidden = false;
    clearTimeout(toastT); toastT = setTimeout(() => t.hidden = true, ms);
  }
  function ask(title, text, buttons) {
    $("askTitle").textContent = title; $("askText").textContent = text;
    const box = $("askBtns"); box.innerHTML = "";
    for (const [label, fn, solid] of buttons) {
      const b = document.createElement("button"); b.type = "button"; b.className = "btn" + (solid ? " solid" : ""); b.textContent = label;
      b.onclick = () => { $("askOv").classList.remove("on"); fn && fn(); }; box.appendChild(b);
    }
    $("askOv").classList.add("on");
  }

  // ---------- Ton ----------
  let actx = null;
  function audio() {
    if (!actx) { try { actx = new (window.AudioContext || window.webkitAudioContext)(); } catch { return null; } }
    if (actx.state === "suspended") actx.resume().catch(() => {});
    return actx;
  }
  document.addEventListener("pointerdown", audio, { once: true });
  function beep(freq = 880, ms = 140, vol = 0.22, force = false) {
    if (!S.sound && !force) return;
    const a = audio(); if (!a) return;
    const o = a.createOscillator(), gn = a.createGain(), t = a.currentTime;
    o.frequency.value = freq; o.type = "sine";
    gn.gain.setValueAtTime(0, t); gn.gain.linearRampToValueAtTime(vol, t + 0.01); gn.gain.exponentialRampToValueAtTime(0.0001, t + ms / 1000);
    o.connect(gn).connect(a.destination); o.start(t); o.stop(t + ms / 1000 + 0.02);
  }
  const announce = () => { beep(660, 120); setTimeout(() => beep(990, 160), 160); };

  // ---------- Puls ----------
  let hrS = null, hrAt = 0, hrLast = null, jumpCount = 0, hrSource = "";
  const sustBuf = [];
  function onHeartRate(v, src) {
    if (!(v >= 30 && v <= 230)) return;
    // Ausreißer vom Handgelenk glätten: großer Sprung wird erst nach 3 Werten geglaubt
    if (hrLast !== null && Math.abs(v - hrLast) > 30 && jumpCount < 2) { jumpCount++; return; }
    jumpCount = 0; hrLast = v;
    hrS = hrS === null || now() - hrAt > 10000 ? v : hrS + (v - hrS) * 0.45;
    hrAt = now(); hrSource = src;
    sustBuf.push(v); if (sustBuf.length > 5) sustBuf.shift();
    updatePill();
  }
  const hrValid = () => hrS !== null && now() - hrAt < 10000;
  const hrNow = () => Math.round(hrS);
  function zoneOf(hr) { let z = -1; for (let i = 0; i < 5; i++) if (hr >= S.zones[i]) z = i; return z; }
  const zoneLo = z => z < 0 ? 0 : S.zones[z];
  const zoneHi = z => z < 4 ? S.zones[z + 1] - 1 : S.hf;
  function updatePill() {
    const p = $("hrPill"), ok = hrValid();
    p.className = ok ? "ok" : (wantConnected || S.sim) ? "wait" : "";
    $("hrPillText").textContent = ok ? (hrSource === "sim" ? "Testmodus · " : "Uhr · ") + hrNow() + " bpm"
      : S.sim ? "Testmodus" : wantConnected ? "Warte auf Puls …" : "Uhr nicht verbunden";
  }
  setInterval(updatePill, 2000);

  // Testmodus ohne Uhr
  setInterval(() => { if (S.sim) onHeartRate(S.simHr + Math.round((Math.random() - 0.5) * 2), "sim"); }, 1000);

  // ---------- Bluetooth (wie ao Puls) ----------
  const HAS_BT = "bluetooth" in navigator;
  let device = null, wantConnected = false, connecting = false, userDisconnected = false;
  let retryTimer = null, retryDelay = 800, hrChar = null, lastNotifyAt = 0, autoRunning = false;
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const withTimeout = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), ms))]);
  function setBt(text) {
    $("btStatus").textContent = text;
    $("btDevice").textContent = device && device.name ? device.name : "";
    $("btConnect").textContent = wantConnected ? "Uhr trennen" : "Uhr verbinden";
    updatePill();
  }
  function onHrValue(e) {
    const dv = e.target.value, flags = dv.getUint8(0);
    lastNotifyAt = now();
    onHeartRate((flags & 1) ? dv.getUint16(1, true) : dv.getUint8(1), "bt");
  }
  function adoptDevice(dev) {
    if (device === dev) return;
    if (device) device.removeEventListener("gattserverdisconnected", onGattDisconnected);
    device = dev;
    device.addEventListener("gattserverdisconnected", onGattDisconnected);
    save("lastDeviceId", dev.id); save("lastDeviceName", dev.name || "");
  }
  async function gattConnect() {
    if (connecting) throw new Error("busy");
    connecting = true;
    try {
      const server = await withTimeout(device.gatt.connect(), 10000);
      const svc = await withTimeout(server.getPrimaryService("heart_rate"), 6000);
      const ch = await withTimeout(svc.getCharacteristic("heart_rate_measurement"), 6000);
      if (hrChar) hrChar.removeEventListener("characteristicvaluechanged", onHrValue);
      hrChar = ch;
      ch.addEventListener("characteristicvaluechanged", onHrValue);
      await withTimeout(ch.startNotifications(), 6000);
      lastNotifyAt = now();
    } catch (e) {
      try { device.gatt.disconnect(); } catch {}
      throw e;
    } finally { connecting = false; }
  }
  function onConnected() {
    wantConnected = true; userDisconnected = false; autoRunning = false;
    retryDelay = 800; clearTimeout(retryTimer);
    setBt("Verbunden");
    requestWakeLock();
  }
  function onGattDisconnected() {
    if (!wantConnected) return;
    setBt("Verbindung verloren – verbinde neu …");
    scheduleReconnect();
  }
  function scheduleReconnect() {
    clearTimeout(retryTimer);
    if (!wantConnected) return;
    retryTimer = setTimeout(async () => {
      if (!wantConnected || connecting) { if (wantConnected) scheduleReconnect(); return; }
      try { await gattConnect(); onConnected(); }
      catch {
        retryDelay = Math.min(retryDelay * 1.6, 5000);
        if (wantConnected) { setBt("Verbindung verloren – neuer Versuch …"); scheduleReconnect(); }
      }
    }, retryDelay);
  }
  // Wächter: Verbindung steht, aber es kommen keine Werte mehr → neu aufbauen
  setInterval(() => {
    if (wantConnected && device && device.gatt.connected && !connecting && now() - lastNotifyAt > 8000) {
      setBt("Kein Puls-Signal – verbinde neu …");
      lastNotifyAt = now();
      try { device.gatt.disconnect(); } catch {}
    }
  }, 2000);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible") return;
    if (wantConnected && device && !device.gatt.connected) { retryDelay = 300; scheduleReconnect(); }
    else if (!wantConnected && !userDisconnected) autoConnect();
  });
  async function attemptConnect(all = false) {
    if (!HAS_BT) { toast("Dieser Browser kann kein Web Bluetooth. Bitte Chrome verwenden.", true, 6000); return false; }
    let dev;
    try {
      dev = await navigator.bluetooth.requestDevice(all
        ? { acceptAllDevices: true, optionalServices: ["heart_rate"] }
        : { filters: [{ services: ["heart_rate"] }] });
    } catch { return false; }
    autoRunning = false;
    adoptDevice(dev);
    setBt("Verbinde …");
    try { await gattConnect(); onConnected(); toast("Uhr verbunden"); return true; }
    catch (e) {
      setBt("Nicht verbunden");
      if (all && /service|not found|NotFound/i.test(String(e))) toast("Dieses Gerät sendet keinen Puls. Ist Herzfrequenz-Push auf der Uhr aktiv?", true, 6000);
      else toast("Keine Verbindung. Läuft Herzfrequenz-Push auf der Uhr? Ist ao Puls auf dem Handy getrennt?", true, 6000);
      return false;
    }
  }
  // Zuletzt genutzte Uhr ohne Geräteliste (Chrome mit „getDevices“)
  async function knownDevice() {
    if (!HAS_BT || !navigator.bluetooth.getDevices) return null;
    try {
      const list = await navigator.bluetooth.getDevices();
      const id = load("lastDeviceId", null);
      return list.find(d => d.id === id) || null;
    } catch { return null; }
  }
  async function connectKnown(dev, waitMs) {
    // Chrome verbindet bekannte Geräte erst zuverlässig, wenn es sie in Reichweite gehört hat
    if (dev.watchAdvertisements) {
      const ac = new AbortController();
      let heard = false;
      try {
        await dev.watchAdvertisements({ signal: ac.signal });
        await new Promise((res, rej) => {
          const h = () => { clearTimeout(t); dev.removeEventListener("advertisementreceived", h); heard = true; res(); };
          const t = setTimeout(() => { dev.removeEventListener("advertisementreceived", h); rej(new Error("timeout")); }, waitMs);
          dev.addEventListener("advertisementreceived", h);
        });
      } catch (e) {
        ac.abort();
        if (e.message === "timeout") throw e;
      }
      if (heard) ac.abort();
    }
    adoptDevice(dev);
    await gattConnect();
  }
  async function autoConnect() {
    if (autoRunning || wantConnected || userDisconnected || S.sim) return;
    const dev = await knownDevice();
    if (!dev) return;
    autoRunning = true;
    const name = dev.name || "Uhr";
    while (autoRunning && !wantConnected && !S.sim) {
      if (document.visibilityState === "visible" && !connecting) {
        setBt(`Suche „${name}“ …`);
        try { await connectKnown(dev, 8000); onConnected(); break; }
        catch { if (autoRunning && !wantConnected) setBt("Nicht verbunden – suche weiter …"); }
      }
      await sleep(4000);
    }
    autoRunning = false;
  }
  function disconnectBt() {
    wantConnected = false; userDisconnected = true; autoRunning = false; clearTimeout(retryTimer);
    try { device && device.gatt.connected && device.gatt.disconnect(); } catch {}
    setBt("Nicht verbunden");
  }

  // ---------- Bildschirm bleibt an ----------
  let wakeLock = null;
  async function requestWakeLock() {
    try { if ("wakeLock" in navigator && !wakeLock) { wakeLock = await navigator.wakeLock.request("screen"); wakeLock.addEventListener("release", () => wakeLock = null); } } catch {}
  }
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible" && (R || C || wantConnected)) requestWakeLock(); });

  // ---------- Bildschirme ----------
  let screen = "start";
  function show(name) {
    screen = name;
    document.querySelectorAll(".screen").forEach(s => s.classList.toggle("on", s.id === "s-" + name));
    const ctx = { start: "Rennen wählen", settings: "Einstellungen", history: "Verlauf", result: "Ergebnis", calib: "Kalibrierfahrt" };
    if (name !== "ride") $("ctx").textContent = ctx[name] || "";
    const tb = $("topBtns"); tb.innerHTML = "";
    if (name === "ride") {
      tb.appendChild(mkBtn("Pause", () => pauseRace(true)));
      tb.appendChild(mkBtn("Beenden", () => endRaceAsk()));
    }
    if (!(name === "ride" && R) && !(name === "calib" && C)) $("topClock").textContent = "";
    if (name === "start") renderStart();
    if (name === "settings") renderSettings();
    if (name === "history") renderHistory();
    if (name === "calib" && !C) renderCalibIntro();
  }
  function mkBtn(label, fn) { const b = document.createElement("button"); b.type = "button"; b.className = "btn"; b.textContent = label; b.onclick = fn; return b; }

  // ---------- Start ----------
  function profilePoints(c, w = 200, h = 50) {
    const n = 60, el = [];
    for (let i = 0; i <= n; i++) el.push(elevAt(c, c.total * i / n));
    const mn = Math.min(...el), mx = Math.max(...el), rg = Math.max(30, mx - mn);
    return el.map((e, i) => `${(i / n * w).toFixed(1)},${(h - 6 - (e - mn) / rg * (h - 12)).toFixed(1)}`).join(" ");
  }
  function renderStart() {
    const best = load("best", {});
    $("courses").innerHTML = COURSES.map((c, i) => {
      const fg = textOn(c.bg), b = best[c.id];
      return `<button type="button" class="course${i === S.course ? " sel" : ""}" data-i="${i}" style="background:${c.bg};color:${fg}">
        <div><b>${c.name}</b><div class="d">${km(c.total)} km · ca. ${estimateMin(i, S.goal)} min</div><div class="x">${c.text}</div></div>
        <svg viewBox="0 0 200 50" preserveAspectRatio="none" aria-hidden="true"><polyline points="${profilePoints(c)}" fill="none" stroke="${fg}" stroke-width="3" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"/></svg>
        <div class="best">${b ? "Bestzeit " + fmtT(b.time) : "Noch nicht gefahren"}</div></button>`;
    }).join("");
    $("courses").querySelectorAll(".course").forEach(el => el.onclick = () => { S.course = +el.dataset.i; saveS(); renderStart(); });
    $("fmtSeg").innerHTML = FORMATS.map((f, i) => `<button type="button" data-i="${i}" class="${i === S.format ? "on" : ""}">${f}</button>`).join("");
    $("fmtSeg").querySelectorAll("button").forEach(el => el.onclick = () => { S.format = +el.dataset.i; saveS(); renderStart(); });
    $("goalSeg").innerHTML = GOALS.map((g, i) => `<button type="button" data-i="${i}" class="${i === S.goal ? "on" : ""}">${g.name}</button>`).join("");
    $("goalSeg").querySelectorAll("button").forEach(el => el.onclick = () => { S.goal = +el.dataset.i; saveS(); renderStart(); });
    $("goalText").textContent = GOALS[S.goal].text();
    const cal = load("calib", null);
    const ghostInfo = S.format === 1 && !best[COURSES[S.course].id] ? "<br><b style='color:#fff'>Für Ghost fehlt noch eine Bestzeit auf dieser Strecke – du fährst diesmal allein.</b>" : "";
    $("startInfo").innerHTML = `HFmax ${S.hf}${S.hfEst ? " (geschätzt)" : ""} · Ruhepuls ${S.rp} · Gegnerstärke ${Math.round(S.diff * 100)} %<br>` +
      (cal ? `Kalibriert am ${fmtDate(cal.date)} – Widerstand passend zu deiner Kurve.` : "Noch nicht kalibriert – Widerstand nach Standardtabelle.") + ghostInfo;
  }
  $("toCalib").onclick = () => show("calib");
  $("toHistory").onclick = () => show("history");
  $("toSettings").onclick = () => show("settings");
  $("hrPill").onclick = () => { if (!R && !C) show("settings"); };
  $("btnGo").onclick = () => startCountdown();

  // ---------- Widerstand: Ziel-Stellung ----------
  function targetZone(k, goal, hard) {
    const gz = GOALS[goal].zone;
    if (k === 0) return 0;
    if (goal === 0) return 1;                       // Grundlage: überall Zone 2
    if (goal === 2) return hard ? (k === 3 ? 4 : 3) : 2;
    if (k === 1) return gz;
    return Math.min(4, gz + (k === 2 ? 1 : 2));
  }
  function levelFor(c, d, goal) {
    const g = gradeAt(c, d), k = klass(g), hard = goal === 2 && (g >= 3.5 || c.total - d < 600);
    const cal = load("calib", null);
    if (cal && cal.hr && cal.hr.every(x => x > 0)) {
      const z = targetZone(k, goal, hard), tgt = (zoneLo(z) + zoneHi(z)) / 2;
      let best = 0, bd = 1e9;
      cal.hr.forEach((h, i) => { const dd = Math.abs(h - tgt); if (dd < bd) { bd = dd; best = i; } });
      return k === 0 ? Math.min(best, 1) : best;
    }
    return g < -1.5 ? 0 : g < 1 ? 1 : g < 2 ? 2 : g < 3.5 ? 3 : g < 5 ? 4 : g < 6.5 ? 5 : g < 8.5 ? 6 : 7;
  }

  // ---------- Rennen ----------
  let R = null, raceTimer = null, lastTick = 0;
  function newRace() {
    const c = COURSES[S.course], best = load("best", {})[c.id];
    const fmt = S.format === 1 && !best ? 2 : S.format;
    return {
      ci: S.course, fmt, goal: S.goal, t: 0,
      me: { d: 0, v: 0 },
      bots: fmt === 0 ? BOTS.map((b, i) => ({ id: b.id, d: 0, v: 0, fin: null, ph: i * 1.7 })) : [],
      ghost: fmt === 1 ? best.trace : null, ghostTime: best ? best.time : null, bestTrace: best ? best.trace : null,
      ist: 0, soll: 0, plan: -1, pendingAt: 0, reminds: 0, lastChange: 0, reason: "", lowT: 0, highT: 0, z5T: 0,
      zoneSec: [0, 0, 0, 0, 0, 0], hrSum: 0, hrT: 0, hrMax: 0, sustMax: 0, trace: [0], nextTrace: 2,
      paused: false, finished: false, startedAt: now(),
    };
  }
  function startCountdown() {
    audio();
    if (!hrValid() && !S.sim) {
      ask("Noch kein Puls", "aoSPIN bekommt noch keinen Puls. Verbinde die Uhr oder schalte in den Einstellungen den Testmodus ein.",
        [["Einstellungen", () => show("settings")], ["Trotzdem starten", () => openCountdown(), true]]);
      return;
    }
    openCountdown();
  }
  let countTimer = null;
  function openCountdown() {
    let n = 10;
    $("countNum").textContent = n;
    $("countOv").classList.add("on");
    clearInterval(countTimer);
    countTimer = setInterval(() => { n--; $("countNum").textContent = n; if (n <= 3 && n > 0) beep(700, 100, 0.2, true); if (n <= 0) goRace(); }, 1000);
  }
  $("countGo").onclick = () => goRace();
  $("countCancel").onclick = () => { clearInterval(countTimer); $("countOv").classList.remove("on"); };
  function goRace() {
    clearInterval(countTimer); $("countOv").classList.remove("on");
    beep(1000, 300, 0.25, true);
    R = newRace();
    startRaceLoop();
  }
  function startRaceLoop() {
    show("ride");
    const c = COURSES[R.ci];
    $("ctx").textContent = `${c.name} · ${R.fmt === 0 ? "Rennen gegen 5 Gegner" : FORMATS[R.fmt]} · Ziel: ${GOALS[R.goal].name}`;
    $("trackName").textContent = "Strecke · " + c.name;
    $("legend").innerHTML = R.fmt === 0 ? BOTS.map(b => `<span><i class="dot" style="background:${b.color}"></i>${b.name}</span>`).join("")
      : R.fmt === 1 ? `<span><i class="dot" style="background:#717378"></i>Ghost (Bestzeit)</span>` : "";
    $("placeHead").textContent = R.fmt === 2 ? "Zeitfahren" : "Platzierung";
    requestWakeLock();
    lastTick = performance.now();
    clearInterval(raceTimer);
    raceTimer = setInterval(raceTick, 250);
    renderRide();
  }
  function setSoll(l, reason) {
    l = clamp(l, 0, 7);
    if (l === R.soll && R.soll !== R.ist) return;
    R.soll = l; R.reason = reason || ""; R.reminds = 0; R.lastChange = R.t;
    if (R.soll !== R.ist) { R.pendingAt = now(); announce(); }
  }
  function raceTick() {
    const tNow = performance.now();
    let dtReal = (tNow - lastTick) / 1000; lastTick = tNow;
    if (!R || R.finished) return;
    if (dtReal > 5) dtReal = 0;                        // nach Ruhezustand nicht springen
    const ok = hrValid();
    R.autoPaused = !ok;
    if (R.paused || !ok) { renderRide(); return; }
    const dt = dtReal * SPEED, c = COURSES[R.ci], hr = hrS;
    R.t += dt;
    // Puls → Leistung
    const drift = S.drift && R.t > 1800 ? Math.min(8, (R.t - 1800) / 60 * 0.25) : 0;
    const g = gradeAt(c, R.me.d), hard = R.goal === 2 && (g >= 3.5 || c.total - R.me.d < 600);
    let eff = Math.min(hr - drift, GOALS[R.goal].cap(hard)), factor = 1;
    R.warn = "";
    if (hr >= S.zones[4]) { R.z5T += dt; if (R.z5T > S.z5Sec) { factor = 0.92; R.warn = `Zone 5 seit ${fmtT(R.z5T)} – kurz rausnehmen`; } }
    else R.z5T = Math.max(0, R.z5T - dt * 2);
    if (hr > S.hf) { factor = 0.85; R.warn = "Über HFmax – lockerer!"; }
    const W = wattsFromE(eOf(eff)) * factor;
    const vt = speedFor(W, g, 80);
    R.me.v += (vt - R.me.v) * Math.min(1, dt / 4);
    R.me.d += R.me.v * dt;
    // Gegner
    const pw = parW(R.goal) * S.diff, ramp = Math.min(1, 0.6 + 0.4 * R.t / 90);
    for (const b of R.bots) {
      if (b.fin !== null) { b.d += b.v * dt * 0.3; continue; }
      const def = BOTS.find(x => x.id === b.id), gb = gradeAt(c, b.d);
      let Wb = pw * botFactor(b.id, b.d / c.total, gb) * ramp * (1 + 0.025 * Math.sin(R.t / 47 + b.ph));
      let cda = CDA;
      if (b.id === "L") { // Lutscher fährt gern im Windschatten
        const ahead = [R.me.d, ...R.bots.filter(o => o !== b).map(o => o.d)].some(od => od - b.d > 3 && od - b.d < 25);
        if (ahead) cda *= 0.7;
      }
      const vb = speedFor(Wb, gb, def.m, cda);
      b.v += (vb - b.v) * Math.min(1, dt / 4);
      b.d += b.v * dt;
      if (b.d >= c.total) b.fin = R.t - (b.d - c.total) / Math.max(b.v, 1);
    }
    // Statistik
    const z = zoneOf(hr);
    R.zoneSec[z + 1] += dt; R.hrSum += hr * dt; R.hrT += dt; R.hrMax = Math.max(R.hrMax, Math.round(hr));
    if (sustBuf.length === 5) R.sustMax = Math.max(R.sustMax, Math.min(...sustBuf));
    while (R.t >= R.nextTrace) { R.trace.push(Math.round(R.me.d)); R.nextTrace += 2; }
    // Widerstand: Ansage 150 m vor dem nächsten Abschnitt
    const plan = levelFor(c, R.me.d + 150, R.goal);
    if (plan !== R.plan) { R.plan = plan; setSoll(plan, ""); }
    if (R.ist === R.soll) {
      // Pulskorrektur, wenn die Stellung über längere Zeit nicht passt
      const zt = targetZone(klass(g), R.goal, hard);
      if (R.t - R.lastChange > 90) {
        R.lowT = hr < zoneLo(zt) - 6 ? R.lowT + dt : 0;
        R.highT = hr > zoneHi(zt) + 6 ? R.highT + dt : 0;
        if (R.lowT > 30 && R.ist < 7) { setSoll(R.ist + 1, "Puls zu niedrig"); R.lowT = 0; }
        else if (R.highT > 30 && R.ist > 0) { setSoll(R.ist - 1, "Puls zu hoch"); R.highT = 0; }
      }
    } else if (now() - R.pendingAt > 20000 && R.reminds < 3) { R.reminds++; R.pendingAt = now(); announce(); }
    if (R.me.d >= c.total) { finishRace(); return; }
    renderRide();
  }
  function ghostD(t) {
    const tr = R.ghost; if (!tr) return null;
    const i = t / 2, a = Math.floor(i);
    if (a >= tr.length - 1) return COURSES[R.ci].total + (t - (tr.length - 1) * 2) * 8;
    return tr[a] + (tr[a + 1] - tr[a]) * (i - a);
  }
  function riders() {
    const list = [{ me: true, name: "Du", color: "#ffffff", d: R.me.d, v: R.me.v, fin: R.finished ? R.finT : null }];
    for (const b of R.bots) { const def = BOTS.find(x => x.id === b.id); list.push({ name: def.name, color: def.color, id: b.id, d: b.d, v: b.v, fin: b.fin }); }
    if (R.fmt === 1 && R.ghost) {
      const gd = ghostD(R.t), c = COURSES[R.ci];
      list.push({ name: "Ghost", color: "#717378", id: "G", ghost: true, d: gd, v: 8, fin: gd >= c.total ? R.ghostTime : null });
    }
    list.sort((a, b) => (a.fin !== null && b.fin !== null) ? a.fin - b.fin : a.fin !== null ? -1 : b.fin !== null ? 1 : b.d - a.d);
    return list;
  }

  // ---------- Fahrbildschirm zeichnen ----------
  let lastRideSave = 0;
  function paintPulse(tile, numEl, titleEl, rangeEl, hr, ok) {
    const z = ok ? zoneOf(hr) : -2;
    const bg = !ok ? NOSIG : z < 0 ? BELOW : ZC[z];
    const fg = textOn(bg);
    tile.style.background = bg; tile.style.color = fg;
    tile.style.boxShadow = !ok ? "inset 0 0 0 2px rgba(255,255,255,0.4)" : "none";
    numEl.textContent = ok ? Math.round(hr) : "–";
    if (titleEl) titleEl.textContent = !ok ? "Kein Signal" : z < 0 ? "Unter Zone 1" : `Zone ${z + 1} · ${ZN[z]}`;
    if (rangeEl) rangeEl.textContent = !ok ? "Rennen pausiert, bis der Puls zurück ist" : z < 0 ? `unter ${S.zones[0]} bpm · locker` : `${zoneLo(z)}–${zoneHi(z)} bpm`;
    return { z, fg };
  }
  function renderRide() {
    if (!R || screen !== "ride") return;
    const c = COURSES[R.ci], ok = hrValid(), hr = hrS;
    $("topClock").textContent = "Fahrzeit " + fmtT(R.t);
    $("trackKm").textContent = (c.laps ? `Runde ${Math.min(c.laps, Math.floor(R.me.d / c.lapLen) + 1)} von ${c.laps} · ` : "") + `km ${km(R.me.d)} von ${km(c.total)}`;
    // Puls
    const { z, fg } = paintPulse($("pulseTile"), $("pulseNum"), $("zoneTitle"), $("zoneRange"), hr, ok);
    const g = gradeAt(c, R.me.d), hard = R.goal === 2 && (g >= 3.5 || c.total - R.me.d < 600);
    const cap = GOALS[R.goal].cap(hard);
    $("pulseSoll").textContent = R.goal === 3 ? "Ziel: frei" : `Tempo bis ${cap} bpm`;
    $("zoneWarn").textContent = !ok ? "" : R.warn || (hr > cap + 2 && cap < S.hf ? "Über dem Ziel – kein Tempogewinn" : "");
    $("zbar").innerHTML = ZC.map((col, i) => `<div class="${i === z ? "on" : ""}" style="background:${col};${i === z ? `box-shadow:0 0 0 3px ${fg}` : ""}"></div>`).join("");
    $("zlab").innerHTML = ZC.map((_, i) => `<div>Z${i + 1}</div>`).join("");
    // Platzierung und Abstände
    const list = riders(), myIdx = list.findIndex(r => r.me);
    if (R.fmt === 2) {
      $("placeNum").textContent = fmtT(R.t); $("placeNum").style.fontSize = "4.6rem"; $("placeOf").textContent = "";
      if (R.bestTrace) {
        const i = Math.min(R.bestTrace.length - 1, Math.floor(R.t / 2)), diff = (R.bestTrace[i] - R.me.d) / Math.max(R.me.v, 3);
        $("placeGap").textContent = `${fmtGap(diff)} auf Bestzeit`;
      } else $("placeGap").textContent = "Erste Fahrt auf dieser Strecke";
    } else {
      $("placeNum").style.fontSize = ""; $("placeNum").textContent = (myIdx + 1) + ".";
      $("placeOf").textContent = "von " + list.length;
      const front = list[myIdx - 1];
      $("placeGap").textContent = front ? `${fmtT(Math.abs((front.d - R.me.d) / Math.max(R.me.v, 3)))} auf Platz ${myIdx}` : list.length > 1 ? "Du führst!" : "";
    }
    $("gaps").innerHTML = list.map((r, i) => {
      const gap = r.me ? "·" : fmtGap(-(r.d - R.me.d) / Math.max(R.me.v, 3));
      return `<div class="${r.me ? "me" : ""}"><span class="n">${i + 1}</span><i class="dot" style="background:${r.color};${r.me ? "box-shadow:0 0 0 2px #131419" : ""}"></i><span class="nm">${r.name}</span><span>${gap}</span></div>`;
    }).join("");
    $("gapTile").style.display = R.fmt === 2 ? "none" : "";
    $("placeTile").style.gridColumn = R.fmt === 2 ? "span 6" : "";
    // Widerstand
    const wechsel = R.ist !== R.soll;
    $("istV").textContent = LV[R.ist]; $("sollV").textContent = LV[R.soll];
    $("sollBox").style.visibility = $("resArrow").style.visibility = wechsel ? "visible" : "hidden";
    $("scale").innerHTML = LV.map((_, i) => {
      let bg = "rgba(0,0,0,0.18)", bd = "none";
      if (i <= Math.min(R.ist, R.soll)) bg = "#000";
      else if (i <= R.ist) bg = "rgba(0,0,0,0.45)";
      if (wechsel && i === R.soll) { bd = "3px solid #000"; if (R.soll > R.ist) bg = "transparent"; }
      return `<div style="background:${bg};border:${bd};box-sizing:border-box"></div>`;
    }).join("");
    $("resText").textContent = turnText(R.ist, R.soll) + (wechsel && R.reason ? " · " + R.reason : "");
    $("btnTurned").disabled = !wechsel;
    $("btnTurned").textContent = wechsel ? "Gedreht" : "Stellung passt";
    $("resHint").textContent = nextChangeText(c, R.me.d);
    // Rest
    const rest = c.total - R.me.d;
    $("restKm").innerHTML = km(rest) + '<small style="font-size:0.45em;font-weight:700"> km</small>';
    $("restTime").textContent = "noch ca. " + Math.max(1, Math.round(rest / Math.max(R.me.v, 3) / 60)) + " min";
    $("restBar").style.width = (R.me.d / c.total * 100).toFixed(1) + "%";
    $("nextInfo").textContent = nextSegText(c, R.me.d);
    drawTrack(c, list);
    if (R.paused || R.autoPaused) showPause(); else $("pauseOv").classList.remove("on");
    if (now() - lastRideSave > 2000) { lastRideSave = now(); persist(); }
  }
  function nextSeg(c, d) {
    const cur = segAt(c, d), k = klass(cur.g);
    for (let i = c.all.indexOf(cur) + 1; i < c.all.length; i++) if (klass(c.all[i].g) !== k) {
      let j = i, len = 0, gsum = 0; while (j < c.all.length && klass(c.all[j].g) === klass(c.all[i].g)) { len += c.all[j].d1 - c.all[j].d0; gsum += c.all[j].g * (c.all[j].d1 - c.all[j].d0); j++; }
      return { dist: c.all[i].d0 - d, k: klass(c.all[i].g), len, g: gsum / len };
    }
    return null;
  }
  function nextSegText(c, d) {
    const n = nextSeg(c, d);
    const pc = g => g.toFixed(1).replace(".", ",").replace("-", "−") + " %";
    if (!n || n.dist > 3000) return `Jetzt: ${KLASS[klass(gradeAt(c, d))]} · ${pc(gradeAt(c, d))}`;
    return `${KLASS[n.k]} in ${n.dist < 1000 ? Math.round(n.dist / 10) * 10 + " m" : km(n.dist) + " km"} · ${km(n.len)} km · ca. ${pc(n.g)}`;
  }
  function nextChangeText(c, d) { const n = nextSeg(c, d); return n && n.dist < 600 ? `${KLASS[n.k]} in ${Math.round(n.dist / 10) * 10} m` : ""; }

  function fitCanvas(cv) {
    const dpr = window.devicePixelRatio || 1, w = Math.round(cv.clientWidth * dpr), h = Math.round(cv.clientHeight * dpr);
    if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
    return { ctx: cv.getContext("2d"), w, h, dpr };
  }
  function drawTrack(c, list) {
    const { ctx, w, h, dpr } = fitCanvas($("track"));
    if (!w || !h) return;
    ctx.clearRect(0, 0, w, h);
    const span = Math.min(c.total, 6000);
    let a = R.me.d - span * 0.3; a = clamp(a, 0, c.total - span); const b = a + span;
    const n = 160, pts = [];
    for (let i = 0; i <= n; i++) { const d = a + span * i / n; pts.push([d, elevAt(c, d)]); }
    const els = pts.map(p => p[1]); let mn = Math.min(...els), mx = Math.max(...els);
    if (mx - mn < 40) { const m = (mx + mn) / 2; mn = m - 20; mx = m + 20; }
    const padT = 46 * dpr, padB = 14 * dpr, padX = 14 * dpr;
    const X = d => padX + (d - a) / span * (w - 2 * padX), Y = e => padT + (1 - (e - mn) / (mx - mn)) * (h - padT - padB);
    const area = (upto, fill) => {
      ctx.beginPath(); ctx.moveTo(X(a), h);
      for (const [d, e] of pts) { if (d > upto) { ctx.lineTo(X(upto), Y(elevAt(c, upto))); break; } ctx.lineTo(X(d), Y(e)); }
      ctx.lineTo(X(Math.min(upto, b)), h); ctx.closePath(); ctx.fillStyle = fill; ctx.fill();
    };
    area(b, "rgba(255,255,255,0.10)"); area(R.me.d, "rgba(255,255,255,0.28)");
    ctx.beginPath(); pts.forEach(([d, e], i) => i ? ctx.lineTo(X(d), Y(e)) : ctx.moveTo(X(d), Y(e)));
    ctx.strokeStyle = "#fff"; ctx.lineWidth = 3 * dpr; ctx.lineJoin = "round"; ctx.stroke();
    ctx.font = `700 ${16 * dpr}px system-ui, sans-serif`; ctx.textAlign = "center"; ctx.fillStyle = "#fff";
    if (c.total <= b + 1) {
      const fx = X(c.total) - 2 * dpr; ctx.setLineDash([6 * dpr, 6 * dpr]); ctx.lineWidth = 2 * dpr;
      ctx.beginPath(); ctx.moveTo(fx, Y(elevAt(c, c.total))); ctx.lineTo(fx, padT - 10 * dpr); ctx.stroke(); ctx.setLineDash([]);
      ctx.textAlign = "right"; ctx.fillText("Ziel", fx, padT - 16 * dpr); ctx.textAlign = "center";
    }
    // Fahrer: zuerst die anderen, dann du
    const others = list.filter(r => !r.me), me = list.find(r => r.me);
    const meX = X(me.d), placed = [];
    others.slice().reverse().forEach((r, i) => {
      const d = Math.min(r.d, c.total); if (d < a || d > b) return;
      const x = X(d), y = Y(elevAt(c, d));
      // Buchstaben nur, wenn sie nicht über einem anderen Fahrer liegen
      const showLbl = Math.abs(x - meX) > 26 * dpr && placed.every(px => Math.abs(px - x) > 18 * dpr);
      if (showLbl) placed.push(x);
      ctx.beginPath(); ctx.arc(x, y, 10 * dpr, 0, Math.PI * 2);
      ctx.fillStyle = r.ghost ? "rgba(113,115,120,0.6)" : r.color; ctx.fill();
      ctx.lineWidth = 2.5 * dpr; ctx.strokeStyle = "#fff"; if (r.ghost) ctx.setLineDash([4 * dpr, 3 * dpr]); ctx.stroke(); ctx.setLineDash([]);
      ctx.fillStyle = "#fff"; ctx.font = `600 ${15 * dpr}px system-ui, sans-serif`;
      if (showLbl) ctx.fillText(r.ghost ? "G" : r.id, x, y - 17 * dpr);
    });
    const x = X(me.d), y = Y(elevAt(c, me.d));
    ctx.beginPath(); ctx.arc(x, y, 12 * dpr, 0, Math.PI * 2); ctx.fillStyle = "#fff"; ctx.fill();
    ctx.lineWidth = 3 * dpr; ctx.strokeStyle = "#131419"; ctx.stroke();
    ctx.font = `800 ${20 * dpr}px system-ui, sans-serif`; ctx.fillStyle = "#fff"; ctx.fillText("Du", x, y - 24 * dpr);
  }

  // Gedreht / Stellung korrigieren
  $("btnTurned").onclick = () => { if (!R || R.ist === R.soll) return; R.ist = R.soll; R.lastChange = R.t; R.reason = ""; renderRide(); persist(); };
  function openPicker(cur, cb) {
    $("pickGrid").innerHTML = LV.map((l, i) => `<button type="button" data-i="${i}" class="${i === cur ? "on" : ""}">${l}</button>`).join("");
    $("pickGrid").querySelectorAll("button").forEach(b => b.onclick = () => { $("pickOv").classList.remove("on"); cb(+b.dataset.i); });
    $("pickOv").classList.add("on");
  }
  $("pickCancel").onclick = () => $("pickOv").classList.remove("on");
  $("istBox").onclick = () => { if (R) openPicker(R.ist, i => { R.ist = i; R.lastChange = R.t; renderRide(); persist(); }); };

  // Pause und Beenden
  function showPause() {
    const ov = $("pauseOv");
    if (R && R.autoPaused && !R.paused) {
      $("pauseTitle").textContent = "Kein Puls – Rennen pausiert";
      $("pauseText").textContent = S.sim ? "Testmodus ist an, aber es kommen noch keine Werte." : "Läuft Herzfrequenz-Push auf der Uhr? Das Rennen geht automatisch weiter, sobald der Puls zurück ist.";
      $("pauseGo").hidden = true;
    } else {
      $("pauseTitle").textContent = "Pause"; $("pauseText").textContent = "Die Zeit steht. Weiter mit „Weiter“ oder der Leertaste."; $("pauseGo").hidden = false;
    }
    ov.classList.add("on");
  }
  function pauseRace(p) { if (!R) return; R.paused = p; if (!p) $("pauseOv").classList.remove("on"); renderRide(); persist(); }
  $("pauseGo").onclick = () => { if (R) pauseRace(false); else if (C) pauseCalib(false); };
  $("pauseEnd").onclick = () => { $("pauseOv").classList.remove("on"); if (R) endRaceAsk(); else if (C) stopCalibAsk(); };
  function endRaceAsk() {
    const wasPaused = R.paused; R.paused = true;
    ask("Rennen beenden?", "Das Rennen wird abgebrochen und nicht gewertet.", [
      ["Weiterfahren", () => { R.paused = wasPaused; renderRide(); }],
      ["Beenden", () => { clearInterval(raceTimer); R = null; drop("race"); $("pauseOv").classList.remove("on"); show("start"); }, true]]);
  }

  // ---------- Ziel ----------
  let recTimer = null;
  function finishRace() {
    const c = COURSES[R.ci];
    R.finished = true; R.finT = R.t - (R.me.d - c.total) / Math.max(R.me.v, 1); R.me.d = c.total;
    clearInterval(raceTimer); drop("race");
    beep(784, 160, 0.25, true); setTimeout(() => beep(1047, 400, 0.25, true), 180);
    // Gegner, die noch fahren, nach aktuellem Tempo hochrechnen
    for (const b of R.bots) if (b.fin === null) b.fin = R.t + (c.total - b.d) / Math.max(b.v, 3);
    const list = riders(), place = list.findIndex(r => r.me) + 1;
    const res = { date: now(), course: c.id, name: c.name, fmt: R.fmt, goal: R.goal, place, of: list.length, time: R.finT,
      avg: Math.round(R.hrSum / Math.max(1, R.hrT)), max: R.hrMax, sust: Math.round(R.sustMax), zoneSec: R.zoneSec.map(Math.round), rec: null };
    // Gegnerstärke anpassen
    if (R.fmt === 0) {
      const others = list.filter(r => !r.me).map(r => r.fin).sort((a, b) => a - b);
      if (place === 1 && others[0] - R.finT > 60) S.diff = Math.min(1.3, S.diff * 1.03);
      if (place === list.length && R.finT - others[others.length - 1] > 120) S.diff = Math.max(0.8, S.diff * 0.97);
      saveS();
    }
    // Bestzeit und Ghost
    const best = load("best", {}), old = best[c.id];
    res.ghostDiff = old ? R.finT - old.time : null;
    if (!old || R.finT < old.time) { R.trace.push(c.total); best[c.id] = { time: R.finT, trace: R.trace, date: now() }; save("best", best); res.newBest = true; }
    const results = load("results", []); results.unshift(res); save("results", results.slice(0, 200));
    showResult(res, list, old);
    // Erholungspuls nach 1 Minute
    const hr0 = hrValid() ? hrS : null;
    let left = 60;
    $("rRecLbl").textContent = "Erholung nach 1 min";
    $("rRec").textContent = "0:60";
    clearInterval(recTimer);
    recTimer = setInterval(() => {
      left -= SPEED;
      if (left > 0) { $("rRec").textContent = "0:" + String(Math.ceil(left)).padStart(2, "0"); return; }
      clearInterval(recTimer);
      if (hr0 !== null && hrValid()) {
        res.rec = Math.round(hr0 - hrS);
        $("rRec").textContent = (res.rec >= 0 ? "−" : "+") + Math.abs(res.rec);
        const rs = load("results", []); if (rs[0] && rs[0].date === res.date) { rs[0].rec = res.rec; save("results", rs); }
      } else $("rRec").textContent = "–";
    }, 1000);
    R = null;
  }
  function showResult(res, list, old) {
    show("result");
    $("ctx").textContent = `${res.name} · ${FORMATS[res.fmt]} · Ziel: ${GOALS[res.goal].name}`;
    if (res.fmt === 2 || res.of === 1) {
      $("rPlaceHead").textContent = "Fahrzeit"; $("rPlace").textContent = fmtT(res.time); $("rPlace").style.fontSize = "5.5rem"; $("rOf").textContent = "";
      $("rPlaceSub").textContent = res.newBest ? "Neue Bestzeit!" : "";
    } else {
      $("rPlaceHead").textContent = "Platzierung"; $("rPlace").style.fontSize = ""; $("rPlace").textContent = res.place + ".";
      $("rOf").textContent = "von " + res.of;
      const win = list[0];
      $("rPlaceSub").textContent = res.place === 1 ? `Sieg! Vorsprung ${fmtT(list[1].fin - res.time)}` : `Sieger ${win.name} ${fmtGap(res.time - win.fin).replace("+", "+")}`;
    }
    $("rAvg").textContent = res.avg; $("rMax").textContent = res.max; $("rTime").textContent = fmtT(res.time);
    if (old) {
      $("rGhost").textContent = fmtGap(res.time - old.time);
      $("rGhostSub").textContent = res.newBest ? "Neue Bestzeit – dieses Rennen ist jetzt dein Ghost." : `Bestzeit bleibt ${fmtT(old.time)}.`;
    } else { $("rGhost").textContent = "Neu"; $("rGhostSub").textContent = "Erste Fahrt auf dieser Strecke – sie ist jetzt dein Ghost."; }
    const total = res.zoneSec.reduce((a, b) => a + b, 0), mx = Math.max(1, ...res.zoneSec);
    $("rZtSum").textContent = fmtT(total) + " gesamt";
    const names = ["Unter Zone 1", ...ZN.map((n, i) => `Z${i + 1} ${n}`)], cols = [BELOW, ...ZC];
    $("zt").innerHTML = res.zoneSec.map((s, i) => `<div class="r"><div class="n">${names[i]}</div><div class="b"><div style="width:${(s / mx * 100).toFixed(1)}%;background:${cols[i]};${i === 0 ? "box-shadow:inset 0 0 0 1.5px rgba(255,255,255,0.45)" : ""}"></div></div><div class="m num">${fmtT(s)}</div></div>`).join("");
    // HFmax-Vorschlag: nur ein Wert, der 5 Sekunden lang gehalten wurde
    $("rHf").textContent = S.hf;
    const sust = res.sust || 0;
    if (sust > S.hf) {
      $("rHfSub").textContent = `Heute ${sust} bpm über 5 Sekunden gehalten – HFmax anheben?`;
      $("rHfUp").hidden = false;
      $("rHfUp").textContent = `Auf ${sust} anheben`;
      $("rHfUp").onclick = () => { S.hf = sust; S.hfEst = false; saveS(); $("rHf").textContent = S.hf; $("rHfUp").hidden = true; $("rHfSub").textContent = "Übernommen. Prüfe danach deine Zonen in den Einstellungen."; };
    } else { $("rHfSub").textContent = `${S.hfEst ? "bleibt (geschätzt)" : "bleibt"} – Höchstwert heute ${res.max}`; $("rHfUp").hidden = true; }
  }
  $("rDone").onclick = () => { clearInterval(recTimer); show("start"); };

  // ---------- Kalibrierung ----------
  let C = null, calibTimer = null, metroTimer = null, beatI = 0;
  const PHASES = [{ kind: "warm", lvl: 1, dur: 300 }, ...[1, 2, 3, 4, 5, 6, 7].map(l => ({ kind: "step", lvl: l, dur: 180 })), { kind: "cool", lvl: 0, dur: 180 }];
  const CAL_TOTAL = PHASES.reduce((s, p) => s + p.dur, 0);
  function renderCalibIntro() {
    $("s-calib").classList.add("intro");
    $("calibIntro").style.display = ""; $("calibRun1").style.display = $("calibRun2").style.display = "none";
    $("calibAbortTxt").textContent = S.abort;
    $("metroChk").checked = S.metro;
    const cal = load("calib", null);
    $("calibLast").textContent = cal ? `Letzte Kalibrierung: ${fmtDate(cal.date)}.` : "Noch keine Kalibrierung – bis dahin gilt die Standardtabelle.";
    $("calibTable").innerHTML = cal ? calTableHtml(cal) : "";
  }
  function calTableHtml(cal) {
    return `<table id="cTable"><tr><th>Stellung</th>${LV.map(l => `<th>${l}</th>`).join("")}</tr>
      <tr><td>Puls</td>${cal.hr.map((h, i) => `<td style="${cal.est[i] ? "color:#b8bac2" : "font-weight:700"}">${h ? Math.round(h) : "–"}${cal.est[i] ? "*" : ""}</td>`).join("")}</tr>
      <tr><td>Gefühl</td>${cal.rpe.map(r => `<td>${r || "–"}</td>`).join("")}</tr></table>
      <div class="note" style="margin-top:0.4rem">* geschätzt${cal.rec != null ? ` · Erholung nach 1 min: −${cal.rec} bpm` : ""}</div>`;
  }
  $("calibBack").onclick = () => show("start");
  $("metroChk").onchange = e => { S.metro = e.target.checked; saveS(); };
  $("calibGo").onclick = () => {
    audio();
    if (!hrValid() && !S.sim) { toast("Noch kein Puls – erst die Uhr verbinden.", true); return; }
    C = { ph: 0, t: 0, tt: 0, ist: 0, soll: PHASES[0].lvl, pendingAt: now(), reminds: 0, samples: [], hr: Array(8).fill(0), est: Array(8).fill(false), rpe: Array(8).fill(0),
      lastStep: -1, hiT: 0, rec0: null, rec: null, paused: false };
    announce();
    startCalibLoop();
  };
  function startCalibLoop() {
    show("calib");
    $("s-calib").classList.remove("intro");
    $("calibIntro").style.display = "none"; $("calibRun1").style.display = $("calibRun2").style.display = "";
    const tb = $("topBtns"); tb.innerHTML = ""; tb.appendChild(mkBtn("Pause", () => pauseCalib(true)));
    $("beatDots").innerHTML = "<i></i><i></i><i></i><i></i>".replace(/<i><\/i>/g, '<span style="width:1.3rem;height:1.3rem;border-radius:50%;background:rgba(255,255,255,0.3);display:inline-block"></span>');
    $("rpe").innerHTML = Array.from({ length: 10 }, (_, i) => `<button type="button" data-v="${i + 1}">${i + 1}</button>`).join("");
    $("rpe").querySelectorAll("button").forEach(b => b.onclick = () => { if (C && C.lastStep > 0) { C.rpe[C.lastStep] = +b.dataset.v; renderCalib(); persist(); } });
    requestWakeLock();
    lastTick = performance.now();
    clearInterval(calibTimer); calibTimer = setInterval(calibTick, 250);
    setMetro();
    renderCalib();
  }
  function setMetro() {
    clearInterval(metroTimer);
    $("metroBtn").textContent = S.metro ? "Takt-Ton aus" : "Takt-Ton an";
    if (!C) return;
    metroTimer = setInterval(() => {
      if (!C || C.paused || !hrValid()) return;
      beatI = (beatI + 1) % 4;
      if (S.metro) beep(beatI === 0 ? 1200 : 900, 40, 0.18, true);
      $("beatDots").querySelectorAll("span").forEach((s, i) => s.style.background = i === beatI ? "#fff" : "rgba(255,255,255,0.3)");
    }, 750);
  }
  $("metroBtn").onclick = () => { S.metro = !S.metro; saveS(); setMetro(); };
  function pauseCalib(p) { if (!C) return; C.paused = p; if (p) { $("pauseTitle").textContent = "Pause"; $("pauseText").textContent = "Die Kalibrierung steht. Weiter mit „Weiter“."; $("pauseGo").hidden = false; $("pauseOv").classList.add("on"); } else $("pauseOv").classList.remove("on"); }
  function calibTick() {
    const tNow = performance.now();
    let dtReal = (tNow - lastTick) / 1000; lastTick = tNow;
    if (!C) return;
    if (dtReal > 5) dtReal = 0;
    const ok = hrValid();
    if (!ok && !C.paused) { $("pauseTitle").textContent = "Kein Puls – Kalibrierung pausiert"; $("pauseText").textContent = "Läuft Herzfrequenz-Push auf der Uhr? Es geht automatisch weiter."; $("pauseGo").hidden = true; $("pauseOv").classList.add("on"); }
    else if (ok && !C.paused) $("pauseOv").classList.remove("on");
    if (C.paused || !ok) { renderCalib(); return; }
    const dt = dtReal * SPEED, P = PHASES[C.ph], hr = hrS;
    C.t += dt; C.tt += dt;
    C.samples.push([C.t, hr]);
    // Sicherheit: 5 Sekunden über der Grenze → Ende
    C.hiT = hr >= S.abort ? C.hiT + dt : 0;
    if (C.hiT >= 5) { toast(`Puls über ${S.abort} – Kalibrierung beendet. Locker ausfahren!`, true, 6000); finishCalib(true); return; }
    if (P.kind === "cool") {
      if (C.rec0 === null) C.rec0 = hr;
      if (C.t >= 60 && C.rec === null) C.rec = Math.round(C.rec0 - hr);
    }
    if (C.ist !== C.soll && now() - C.pendingAt > 20000 && C.reminds < 3) { C.reminds++; C.pendingAt = now(); announce(); }
    if (C.t >= P.dur) {
      if (P.kind === "step") {
        const last = C.samples.filter(s => s[0] > P.dur - 60).map(s => s[1]);
        C.hr[P.lvl] = last.reduce((a, b) => a + b, 0) / Math.max(1, last.length);
        C.lastStep = P.lvl;
      }
      C.ph++; C.t = 0; C.samples = [];
      if (C.ph >= PHASES.length) { finishCalib(false); return; }
      C.soll = PHASES[C.ph].lvl; C.reminds = 0; C.pendingAt = now();
      if (C.soll !== C.ist) announce();
    }
    renderCalib();
  }
  function curAvg() { const P = PHASES[C.ph], last = C.samples.filter(s => s[0] > C.t - 60).map(s => s[1]); return last.length ? last.reduce((a, b) => a + b, 0) / last.length : null; }
  function renderCalib() {
    if (!C || screen !== "calib") return;
    const P = PHASES[C.ph], ok = hrValid();
    $("topClock").textContent = `Gesamt ${fmtT(C.tt)} von ca. ${fmtT(CAL_TOTAL)}`;
    $("ctx").textContent = P.kind === "warm" ? "Kalibrierfahrt · Einfahren" : P.kind === "cool" ? "Kalibrierfahrt · Ausfahren" : `Kalibrierfahrt · Stufe ${PHASES.slice(1, C.ph + 1).length} von 7`;
    const { z } = paintPulse($("cPulseTile"), $("cPulse"), $("cZone"), null, hrS, ok);
    $("cAbortInfo").textContent = `Abbruch automatisch ab ${S.abort} bpm`;
    $("cPulseNote").textContent = P.kind === "step" ? (C.t < 120 ? "pendelt sich ein" : "wird gemessen") : "";
    const wechsel = C.ist !== C.soll;
    $("cPhase").textContent = P.kind === "warm" ? "Einfahren" : P.kind === "cool" ? "Ausfahren" : "Stellung";
    $("cStepNo").textContent = P.kind === "step" ? `Stufe ${C.ph} von 7` : "";
    $("cIstV").textContent = LV[C.ist]; $("cSollV").textContent = LV[C.soll];
    $("cSollBox").style.visibility = $("cArrow").style.visibility = wechsel ? "visible" : "hidden";
    $("cLeft").textContent = fmtT(P.dur - C.t);
    const nx = PHASES[C.ph + 1];
    $("cNext").textContent = wechsel ? turnText(C.ist, C.soll) + " – dann „Gedreht“ tippen" : nx ? `Danach: ${LV[nx.lvl]} · ${turnText(P.lvl, nx.lvl)}` : "Danach: fertig";
    $("cTurned").disabled = !wechsel; $("cTurned").style.opacity = wechsel ? 1 : 0.35;
    $("rpeHead").textContent = C.lastStep > 0 ? `Wie hart war Stellung ${LV[C.lastStep]}? (1–10)` : "Gefühl (1–10) – ab der 1. Stufe";
    $("rpe").querySelectorAll("button").forEach(b => b.classList.toggle("on", C.lastStep > 0 && C.rpe[C.lastStep] === +b.dataset.v));
    drawCalibChart();
    if (now() - lastRideSave > 2000) { lastRideSave = now(); persist(); }
  }
  $("cTurned").onclick = () => { if (C && C.ist !== C.soll) { C.ist = C.soll; renderCalib(); persist(); } };
  $("cIst").onclick = () => { if (C) openPicker(C.ist, i => { C.ist = i; renderCalib(); persist(); }); };
  $("cStop").onclick = () => stopCalibAsk();
  function stopCalibAsk() {
    const was = C.paused; C.paused = true;
    ask("Kalibrierung beenden?", "Gemessene Stufen werden gespeichert, fehlende geschätzt. Bitte danach locker ausfahren.", [
      ["Weiterfahren", () => { C.paused = was; }],
      ["Verwerfen", () => { clearInterval(calibTimer); clearInterval(metroTimer); C = null; drop("calibRun"); $("pauseOv").classList.remove("on"); show("calib"); }],
      ["Speichern und beenden", () => finishCalib(true), true]]);
  }
  function finishCalib(aborted) {
    clearInterval(calibTimer); clearInterval(metroTimer); $("pauseOv").classList.remove("on");
    const hr = C.hr.slice(), est = hr.map(h => !h);
    const measured = hr.map((h, i) => [i, h]).filter(([i, h]) => h > 0 && i > 0);
    if (measured.length === 0) { toast("Zu kurz – keine Stufe vollständig gemessen. Nichts gespeichert.", true, 6000); C = null; drop("calibRun"); show("calib"); return; }
    // Fehlende Stufen aus den letzten beiden Messungen hochrechnen
    const [l2, l1] = measured.length >= 2 ? [measured[measured.length - 2], measured[measured.length - 1]] : [null, measured[0]];
    const slope = l2 ? (l1[1] - l2[1]) / Math.max(0.25, TURNS[l1[0]] - TURNS[l2[0]]) : 15;
    for (let i = 1; i < 8; i++) if (!hr[i]) {
      if (i > l1[0]) hr[i] = l1[1] + slope * (TURNS[i] - TURNS[l1[0]]);
      else { const nxt = measured.find(m => m[0] > i); hr[i] = nxt ? nxt[1] - slope * (TURNS[nxt[0]] - TURNS[i]) : l1[1]; }
    }
    hr[0] = hr[1] - 6; est[0] = true;
    const cal = { date: now(), hr: hr.map(h => Math.round(h)), est, rpe: C.rpe, rec: C.rec, aborted };
    save("calib", cal);
    const hist = load("calibs", []); hist.unshift(cal); save("calibs", hist.slice(0, 30));
    C = null; drop("calibRun");
    beep(784, 160, 0.25, true); setTimeout(() => beep(1047, 400, 0.25, true), 180);
    show("calib");
    toast("Kalibrierung gespeichert – die Rennen nutzen jetzt deine Kurve.", false, 5000);
  }
  function drawCalibChart() {
    const { ctx, w, h, dpr } = fitCanvas($("calibChart"));
    if (!w || !h) return;
    ctx.clearRect(0, 0, w, h);
    const prev = load("calib", null);
    const lo = Math.max(60, Math.min(S.zones[0] - 15, ...(prev ? prev.hr : [200]))), hi = S.hf + 5;
    const pl = 46 * dpr, pr = 40 * dpr, pt = 18 * dpr, pb = 34 * dpr;
    const X = t => pl + t / 3 * (w - pl - pr), Y = v => pt + (1 - (v - lo) / (hi - lo)) * (h - pt - pb);
    ctx.font = `${14 * dpr}px system-ui, sans-serif`; ctx.fillStyle = "#b8bac2"; ctx.textAlign = "right";
    S.zones.forEach((zv, i) => {
      if (zv < lo) return;
      ctx.strokeStyle = "rgba(255,255,255,0.18)"; ctx.lineWidth = 1 * dpr; ctx.beginPath(); ctx.moveTo(pl, Y(zv)); ctx.lineTo(w - pr, Y(zv)); ctx.stroke();
      ctx.fillText("Z" + (i + 1), w - 6 * dpr, Y(zv) - 4 * dpr);
    });
    ctx.textAlign = "center";
    TURNS.forEach((t, i) => { ctx.fillStyle = C && PHASES[C.ph].lvl === i ? "#fff" : "#b8bac2"; ctx.fillText(LV[i], X(t), h - 10 * dpr); });
    ctx.textAlign = "right"; ctx.fillStyle = "#b8bac2"; ctx.fillText("bpm", pl - 8 * dpr, pt + 10 * dpr);
    // frühere Kalibrierung gestrichelt
    if (prev) {
      ctx.setLineDash([6 * dpr, 7 * dpr]); ctx.strokeStyle = "rgba(255,255,255,0.45)"; ctx.lineWidth = 2 * dpr; ctx.beginPath();
      prev.hr.forEach((v, i) => { if (i === 0) return; i === 1 ? ctx.moveTo(X(TURNS[i]), Y(v)) : ctx.lineTo(X(TURNS[i]), Y(v)); }); ctx.stroke(); ctx.setLineDash([]);
    }
    const pts = C ? C.hr.map((v, i) => [i, v]).filter(p => p[1] > 0) : [];
    ctx.strokeStyle = "#fff"; ctx.lineWidth = 3 * dpr; ctx.beginPath();
    pts.forEach(([i, v], k) => k ? ctx.lineTo(X(TURNS[i]), Y(v)) : ctx.moveTo(X(TURNS[i]), Y(v))); ctx.stroke();
    ctx.textAlign = "center"; ctx.font = `600 ${15 * dpr}px system-ui, sans-serif`;
    pts.forEach(([i, v]) => { ctx.beginPath(); ctx.arc(X(TURNS[i]), Y(v), 7 * dpr, 0, Math.PI * 2); ctx.fillStyle = "#fff"; ctx.fill(); ctx.fillText(Math.round(v), X(TURNS[i]), Y(v) + 26 * dpr); });
    if (C && PHASES[C.ph].kind === "step") {
      const a = curAvg(), i = PHASES[C.ph].lvl;
      if (a) {
        const z = zoneOf(a);
        ctx.beginPath(); ctx.arc(X(TURNS[i]), Y(a), 12 * dpr, 0, Math.PI * 2); ctx.fillStyle = z < 0 ? BELOW : ZC[z]; ctx.fill();
        ctx.lineWidth = 3 * dpr; ctx.strokeStyle = "#fff"; ctx.stroke();
        ctx.fillStyle = "#fff"; ctx.font = `800 ${16 * dpr}px system-ui, sans-serif`; ctx.fillText("läuft", X(TURNS[i]), Y(a) - 22 * dpr);
      }
    }
  }

  // ---------- Einstellungen ----------
  function renderSettings() {
    $("zList").innerHTML = S.zones.map((v, i) => `
      <div class="zrow"><div class="zsw" style="background:${ZC[i]}"></div>
        <div class="zname"><b>Zone ${i + 1}</b><span>${ZN[i]}</span></div>
        <input class="in" type="text" inputmode="numeric" maxlength="3" data-z="${i}" value="${v}" aria-label="Zone ${i + 1} ab bpm">
        <div class="zbis" id="zbis${i}"></div></div>`).join("");
    $("zList").querySelectorAll("input").forEach(inp => inp.addEventListener("input", onZoneInput));
    $("inHf").value = S.hf; $("inRp").value = S.rp; $("inZ5").value = S.z5Sec; $("inAbort").value = S.abort;
    $("simChk").checked = S.sim; $("simBox").hidden = !S.sim; $("simRange").value = S.simHr; $("simVal").textContent = S.simHr;
    $("driftChk").checked = S.drift; $("soundChk").checked = S.sound;
    setBt(wantConnected ? "Verbunden" : "Nicht verbunden");
    updateBis(S.zones.map(String));
  }
  function updateBis(vals) {
    const n = vals.map(v => /^\d{2,3}$/.test(v) ? +v : NaN);
    const bad = n.map((x, i) => isNaN(x) || x < 40 || x > 230 || (i > 0 && !(x > n[i - 1])) || (i === 4 && x >= S.hf));
    n.forEach((x, i) => {
      const nx = i < 4 ? n[i + 1] : NaN;
      $("zbis" + i).textContent = i < 4 ? (isNaN(nx) ? "–" : "bis " + (nx - 1)) : "bis " + S.hf;
      const inp = $("zList").querySelector(`input[data-z="${i}"]`); if (inp) inp.classList.toggle("bad", bad[i]);
    });
    const anyBad = bad.some(Boolean);
    $("zMsg").textContent = anyBad ? "Jede Grenze muss höher sein als die davor (und unter HFmax)" : "Gespeichert";
    $("zMsg").style.color = anyBad ? "var(--bad)" : "var(--ok)";
    return anyBad ? null : n;
  }
  function onZoneInput(e) {
    e.target.value = e.target.value.replace(/\D/g, "").slice(0, 3);
    const vals = [...$("zList").querySelectorAll("input")].map(i => i.value);
    const n = updateBis(vals);
    if (n) { S.zones = n; saveS(); }
  }
  function setZones(arr) { S.zones = arr.map(Math.round); saveS(); renderSettings(); toast("Zonen übernommen"); }
  $("zKarv").onclick = () => setZones([0.5, 0.6, 0.7, 0.8, 0.9].map(p => S.rp + (S.hf - S.rp) * p));
  $("zPct").onclick = () => setZones([0.5, 0.6, 0.7, 0.8, 0.9].map(p => S.hf * p));
  $("zAoPuls").onclick = () => {
    let z = null; try { z = JSON.parse(localStorage.getItem("piv_zones")); } catch {}
    if (Array.isArray(z) && z.length === 5 && z.every(x => typeof x === "number")) setZones(z);
    else toast("Auf diesem Gerät sind keine Zonen von ao Puls gespeichert.", true, 5000);
  };
  const numIn = (id, min, max, key, extra) => $(id).addEventListener("input", e => {
    e.target.value = e.target.value.replace(/\D/g, "").slice(0, 3);
    const v = +e.target.value, good = e.target.value !== "" && v >= min && v <= max;
    e.target.classList.toggle("bad", !good);
    if (good) { S[key] = v; if (extra) extra(); saveS(); updateBis([...$("zList").querySelectorAll("input")].map(i => i.value)); }
  });
  numIn("inHf", 120, 230, "hf", () => { S.hfEst = false; });
  numIn("inRp", 30, 110, "rp");
  numIn("inZ5", 10, 900, "z5Sec");
  numIn("inAbort", 120, 230, "abort");
  $("simChk").onchange = e => {
    S.sim = e.target.checked; saveS(); $("simBox").hidden = !S.sim;
    if (S.sim) { autoRunning = false; hrS = null; } else { hrS = null; autoConnect(); }
    updatePill();
  };
  $("simRange").oninput = e => { S.simHr = +e.target.value; $("simVal").textContent = S.simHr; saveS(); };
  $("driftChk").onchange = e => { S.drift = e.target.checked; saveS(); };
  $("soundChk").onchange = e => { S.sound = e.target.checked; saveS(); };
  $("btConnect").onclick = () => { if (wantConnected) disconnectBt(); else { S.sim = false; saveS(); $("simChk").checked = false; $("simBox").hidden = true; attemptConnect(false); } };
  $("btAll").onclick = () => attemptConnect(true);
  $("settingsDone").onclick = () => show(R ? "ride" : "start");
  $("exportBtn").onclick = () => {
    const data = {}; for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k.startsWith("aos_") && k !== "aos_race" && k !== "aos_calibRun") data[k] = localStorage.getItem(k); }
    const blob = new Blob([JSON.stringify({ app: "aoSPIN", version: APP_VERSION, date: new Date().toISOString(), data }, null, 1)], { type: "application/json" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `aospin-sicherung-${new Date().toISOString().slice(0, 10)}.json`; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  };
  $("importBtn").onclick = () => $("importFile").click();
  $("importFile").onchange = async e => {
    const f = e.target.files[0]; e.target.value = ""; if (!f) return;
    try {
      const j = JSON.parse(await f.text());
      if (!j || j.app !== "aoSPIN" || !j.data) throw new Error("x");
      ask("Sicherung einlesen?", `Stand ${new Date(j.date).toLocaleString("de-DE")}. Einstellungen, Ergebnisse und Kalibrierung werden ersetzt.`,
        [["Abbrechen"], ["Einlesen", () => { for (const [k, v] of Object.entries(j.data)) if (k.startsWith("aos_")) localStorage.setItem(k, v); location.reload(); }, true]]);
    } catch { toast("Das ist keine aoSPIN-Sicherung.", true); }
  };

  // ---------- Verlauf ----------
  function renderHistory() {
    const rs = load("results", []);
    $("hist").innerHTML = `<tr><th>Datum</th><th>Strecke</th><th>Format</th><th>Ziel</th><th>Platz</th><th>Zeit</th><th>Ø Puls</th><th>Erholung</th></tr>` +
      (rs.length ? rs.slice(0, 60).map(r => `<tr><td>${fmtDate(r.date)}</td><td>${r.name}</td><td>${FORMATS[r.fmt]}</td><td>${GOALS[r.goal].name}</td>
        <td>${r.fmt === 2 || r.of === 1 ? "–" : r.place + ". / " + r.of}</td><td class="num">${fmtT(r.time)}${r.newBest ? " ★" : ""}</td><td>${r.avg}</td><td>${r.rec != null ? "−" + r.rec : "–"}</td></tr>`).join("")
        : `<tr><td colspan="8" class="note">Noch keine Rennen gefahren.</td></tr>`);
    drawTrend();
  }
  function drawTrend() {
    const { ctx, w, h, dpr } = fitCanvas($("trendChart"));
    if (!w || !h) return;
    ctx.clearRect(0, 0, w, h);
    const cs = load("calibs", []).slice(0, 5).reverse();
    if (!cs.length) { $("trendText").textContent = "Noch keine Kalibrierung. Nach der zweiten Kalibrierfahrt siehst du hier, ob dein Puls bei gleicher Stellung sinkt."; return; }
    const all = cs.flatMap(c => c.hr.slice(1)), lo = Math.min(...all) - 8, hi = Math.max(...all) + 8;
    const pl = 42 * dpr, pr = 14 * dpr, pt = 14 * dpr, pb = 30 * dpr;
    const X = t => pl + (t - 1) / 2 * (w - pl - pr), Y = v => pt + (1 - (v - lo) / (hi - lo)) * (h - pt - pb);
    ctx.font = `${13 * dpr}px system-ui, sans-serif`; ctx.fillStyle = "#b8bac2"; ctx.textAlign = "center";
    TURNS.forEach((t, i) => { if (i) ctx.fillText(LV[i], X(t), h - 8 * dpr); });
    ctx.textAlign = "right"; [lo, (lo + hi) / 2, hi].forEach(v => ctx.fillText(Math.round(v), pl - 8 * dpr, Y(v) + 4 * dpr));
    cs.forEach((c, k) => {
      const newest = k === cs.length - 1;
      ctx.strokeStyle = newest ? "#fff" : `rgba(255,255,255,${0.2 + 0.15 * k})`; ctx.lineWidth = (newest ? 3 : 2) * dpr; ctx.beginPath();
      c.hr.forEach((v, i) => { if (!i) return; i === 1 ? ctx.moveTo(X(TURNS[i]), Y(v)) : ctx.lineTo(X(TURNS[i]), Y(v)); }); ctx.stroke();
    });
    if (cs.length >= 2) {
      const a = cs[0], b = cs[cs.length - 1], d = Math.round(b.hr[3] - a.hr[3]);
      $("trendText").textContent = `Puls bei Stellung 2: ${fmtDate(a.date)} ${a.hr[3]} bpm, ${fmtDate(b.date)} ${b.hr[3]} bpm (${d > 0 ? "+" : ""}${d}). ${d < 0 ? "Niedriger heißt fitter." : ""}`;
    } else $("trendText").textContent = `Eine Kalibrierung vom ${fmtDate(cs[0].date)}. Ab der zweiten siehst du den Vergleich.`;
  }
  $("historyDone").onclick = () => show("start");

  // ---------- Speichern und Fortsetzen ----------
  function persist() {
    if (R && !R.finished) save("race", Object.assign({}, R, { savedAt: now() }));
    if (C) save("calibRun", Object.assign({}, C, { savedAt: now() }));
  }
  window.addEventListener("pagehide", persist);
  function offerResume() {
    const r = load("race", null), c = load("calibRun", null);
    if (r && r.savedAt) {
      const resume = () => { R = r; R.paused = false; startRaceLoop(); toast("Rennen läuft weiter."); };
      if (now() - r.savedAt < 15 * 60 * 1000) resume();
      else ask("Rennen fortsetzen?", `Auf ${COURSES[r.ci].name} läuft noch ein Rennen (Fahrzeit ${fmtT(r.t)}).`,
        [["Verwerfen", () => drop("race")], ["Fortsetzen", resume, true]]);
    } else if (c && c.savedAt) {
      const resume = () => { C = c; C.paused = false; C.pendingAt = now(); startCalibLoop(); toast("Kalibrierung läuft weiter."); };
      if (now() - c.savedAt < 15 * 60 * 1000) resume();
      else ask("Kalibrierung fortsetzen?", "Eine Kalibrierfahrt wurde unterbrochen.", [["Verwerfen", () => drop("calibRun")], ["Fortsetzen", resume, true]]);
    }
  }

  // ---------- Tastatur ----------
  document.addEventListener("keydown", e => {
    if (e.target.tagName === "INPUT") return;
    if ((e.key === "ArrowUp" || e.key === "ArrowDown") && S.sim) {
      S.simHr = clamp(S.simHr + (e.key === "ArrowUp" ? 2 : -2), 50, 200); saveS();
      $("simRange").value = S.simHr; $("simVal").textContent = S.simHr; onHeartRate(S.simHr, "sim"); e.preventDefault();
    } else if (e.key === " " && R) { pauseRace(!R.paused); e.preventDefault(); }
    else if (e.key === "Enter" && R && R.ist !== R.soll) { $("btnTurned").click(); e.preventDefault(); }
    else if (e.key === "Enter" && C && C.ist !== C.soll) { $("cTurned").click(); e.preventDefault(); }
  });
  window.addEventListener("resize", () => { if (screen === "ride") renderRide(); if (screen === "calib") renderCalib(); if (screen === "history") drawTrend(); });


  // ---------- Version und Updates ----------
  $("ver").textContent = DEV ? "Entwicklungsversion" : "Version " + APP_VERSION;
  $("btnReload").onclick = () => { persist(); location.reload(); };
  let waitingWorker = null, reloading = false, silentSwap = false;
  function askVersion(w) {
    return new Promise(res => {
      try {
        const ch = new MessageChannel();
        const t = setTimeout(() => res(null), 1500);
        ch.port1.onmessage = e => { clearTimeout(t); res(e.data); };
        w.postMessage({ type: "VERSION" }, [ch.port2]);
      } catch { res(null); }
    });
  }
  async function offerUpdate(w) {
    // Ist diese Seite schon die neue Version (z. B. nach Neuladen), still übernehmen – kein Hinweis, kein Neuladen
    const v = await askVersion(w);
    if (v && v === APP_VERSION) { silentSwap = true; w.postMessage({ type: "SKIP_WAITING" }); return; }
    waitingWorker = w;
    $("updateBar").hidden = false;
  }
  $("updateBtn").onclick = () => { persist(); if (waitingWorker) waitingWorker.postMessage({ type: "SKIP_WAITING" }); else location.reload(); };
  if ("serviceWorker" in navigator && location.protocol !== "file:") {
    navigator.serviceWorker.addEventListener("controllerchange", () => { if (silentSwap) { silentSwap = false; return; } if (!reloading) { reloading = true; persist(); location.reload(); } });
    navigator.serviceWorker.register("sw.js", { updateViaCache: "none" }).then(reg => {
      if (reg.waiting && navigator.serviceWorker.controller) offerUpdate(reg.waiting);
      reg.addEventListener("updatefound", () => {
        const w = reg.installing;
        w && w.addEventListener("statechange", () => { if (w.state === "installed" && navigator.serviceWorker.controller) offerUpdate(w); });
      });
      const check = () => reg.update().catch(() => {});
      document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") check(); });
      setInterval(check, 2 * 60 * 1000);
    }).catch(() => {});
  }

  // ---------- Start ----------
  if (S.sim) S.simHr = S.simHr || 120;
  show("start");
  updatePill();
  offerResume();
  autoConnect();
})();
