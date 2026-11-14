/* Interactive figures for the fibre specklegram bed sensor page.
 * Rodriguez-Cuevas et al., J. Biomed. Opt. 22(3), 037001 (2017).
 * The live traces come from a simple model of the frame-to-frame intensity
 * change; the heart rate and movement shown are computed from them with the
 * three methods and the movement detector described in the paper.
 * Every number in the result charts is from Tables 1 and 2 of the paper.
 */
(function () {
  "use strict";

  var INK = "#0e2233", INK_SOFT = "#4c5d6d", RULE = "#cfd7df", GRID = "#e6ebf0";
  var M_COLORS = { 1: "#2a5fd6", 2: "#1f8a3a", 3: "#d6302a" };
  var AMBER = "#f7b267", ALARM = "#d6302a";
  var FS = 30, BUF = 300;
  var REDUCED = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ---------------------------------------------------------------- utils */
  function $(id) { return document.getElementById(id); }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function mean(a, i0, i1) {
    i0 = i0 || 0; i1 = i1 === undefined ? a.length : i1;
    var s = 0; for (var i = i0; i < i1; i++) s += a[i];
    return s / (i1 - i0);
  }
  function median(a) {
    var b = a.slice().sort(function (x, y) { return x - y; });
    var m = b.length >> 1;
    return b.length % 2 ? b[m] : (b[m - 1] + b[m]) / 2;
  }
  function movAvg(x, n) {
    var out = new Array(x.length), s = 0;
    for (var i = 0; i < x.length; i++) {
      s += x[i]; if (i >= n) s -= x[i - n];
      out[i] = s / Math.min(i + 1, n);
    }
    return out;
  }
  function setupCanvas(cv) {
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    var w = cv.clientWidth, h = cv.clientHeight;
    if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) {
      cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
    }
    var ctx = cv.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { ctx: ctx, w: w, h: h };
  }
  var SVGNS = "http://www.w3.org/2000/svg";
  function el(name, attrs, text) {
    var e = document.createElementNS(SVGNS, name);
    for (var k in attrs) if (attrs[k] !== undefined) e.setAttribute(k, attrs[k]);
    if (text !== undefined) e.textContent = text;
    return e;
  }
  function toggleGroup(group, onChange) {
    var buttons = group.querySelectorAll("button");
    buttons.forEach(function (b) {
      b.addEventListener("click", function () {
        buttons.forEach(function (o) { o.setAttribute("aria-pressed", o === b ? "true" : "false"); });
        onChange(b.dataset.k);
      });
    });
  }
  function setToggle(group, k) {
    group.querySelectorAll("button").forEach(function (o) { o.setAttribute("aria-pressed", o.dataset.k === k ? "true" : "false"); });
  }
  /* Runs fn(dt) on animation frames while the element is on screen. */
  function whileVisible(elm, fn) {
    var visible = false, raf = 0, last = 0;
    function loop(ts) {
      var dt = last ? Math.min((ts - last) / 1000, 0.1) : 0;
      last = ts; fn(dt);
      if (visible) raf = requestAnimationFrame(loop);
    }
    var io = new IntersectionObserver(function (es) {
      var v = es[0].isIntersecting;
      if (v && !visible) { visible = true; last = 0; raf = requestAnimationFrame(loop); }
      if (!v) { visible = false; cancelAnimationFrame(raf); }
    }, { threshold: 0.05 });
    io.observe(elm);
  }

  /* Seeded random numbers, so the traces look the same at every visit. */
  function rng(seed) {
    var s = seed >>> 0;
    var r = function () {
      s = (s + 0x6D2B79F5) >>> 0;
      var t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    r.gauss = function () {
      var u = r() || 1e-9, v = r();
      return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
    };
    return r;
  }

  /* =====================================================================
   * Signal model: frame-to-frame intensity change of a fibre under a person.
   * A baseline with camera noise, a sharp jolt at every heartbeat followed by
   * a smaller rebound, breathing, and large irregular bursts while moving.
   * ==================================================================== */
  function SignalModel(seed, hr, quality) {
    this.r = rng(seed);
    this.t = 0;
    this.hr = hr;
    this.quality = quality;
    this.nextBeat = 0.3;
    this.beats = [];
    this.moveUntil = -1;
    this.moveStart = -1;
    this.level = 5;
    this.breathPhase = 0;
  }
  SignalModel.prototype.move = function (dur) {
    this.moveStart = this.t; this.moveUntil = this.t + (dur || 2.6);
  };
  SignalModel.prototype.moving = function () { return this.t < this.moveUntil; };
  SignalModel.prototype.sample = function () {
    var r = this.r, t = this.t, q = this.quality;
    var beatNow = false;
    if (t >= this.nextBeat) {
      var rr = 60 / this.hr * (1 + 0.035 * r.gauss());
      this.beats.push({ t: this.nextBeat, a: 0.75 + 0.5 * r() });
      this.nextBeat += rr;
      beatNow = true;
    }
    while (this.beats.length && t - this.beats[0].t > 1) this.beats.shift();
    var v = this.level;
    var amp = 0.9 + 1.3 * q;
    for (var i = 0; i < this.beats.length; i++) {
      var d = t - this.beats[i].t, a = this.beats[i].a * amp;
      v += a * Math.exp(-0.5 * Math.pow(d / 0.045, 2));
      v += 0.35 * a * Math.exp(-0.5 * Math.pow((d - 0.24) / 0.06, 2));
    }
    this.breathPhase += 2 * Math.PI * 0.24 / FS;
    var poor = 1 - q;
    v += (0.15 + 1.1 * poor) * Math.max(0, Math.sin(this.breathPhase)) * (1 + 0.6 * Math.sin(this.breathPhase * 2.3));
    v += (0.18 + 0.75 * poor) * Math.abs(r.gauss());
    if (r() < 0.012 * (0.3 + poor)) v += (1 + 2.5 * poor) * r();
    if (this.moving()) {
      var k = (t - this.moveStart) / (this.moveUntil - this.moveStart);
      var env = Math.sin(Math.PI * clamp(k, 0, 1));
      v += env * (3 + 6 * Math.abs(r.gauss()));
      if (Math.abs(k - 0.5) < 1 / (FS * (this.moveUntil - this.moveStart))) this.level = 4.4 + 1.2 * r();
    }
    this.t += 1 / FS;
    return { v: Math.max(0, v), beat: beatNow, moving: this.moving() };
  };

  /* =====================================================================
   * The processing of the paper, on a 10 s buffer at 30 frames per second.
   * ==================================================================== */
  var Proc = {
    movement: function (buf) {
      var n = buf.length, cut = Math.round(n * 0.8);
      var old = mean(buf, 0, cut), rec = mean(buf, cut, n);
      var ratio = rec / old;
      return { ratio: ratio, flag: Math.abs(ratio - 1) > 0.1, oldMean: old, recMean: rec, cut: cut };
    },
    method1: function (buf) {
      var s = movAvg(movAvg(buf, 10), 6);
      var m = mean(s), peaks = [], minGap = Math.round(0.33 * FS);
      for (var i = 2; i < s.length - 2; i++) {
        if (s[i] > m && s[i] >= s[i - 1] && s[i] >= s[i + 1] && s[i] >= s[i - 2] && s[i] >= s[i + 2]) {
          if (peaks.length && i - peaks[peaks.length - 1] < minGap) {
            if (s[i] > s[peaks[peaks.length - 1]]) peaks[peaks.length - 1] = i;
          } else peaks.push(i);
        }
      }
      var gaps = [];
      for (var j = 1; j < peaks.length; j++) gaps.push((peaks[j] - peaks[j - 1]) / FS);
      var bpm = gaps.length >= 2 ? 60 / median(gaps) : null;
      return { bpm: bpm, smooth: s, peaks: peaks };
    },
    spectrum: function (x, nfft) {
      var re = new Float64Array(nfft), im = new Float64Array(nfft);
      for (var i = 0; i < x.length; i++) re[i] = x[i];
      // iterative radix-2 FFT
      for (var a = 1, b = 0; a < nfft; a++) {
        var bit = nfft >> 1;
        for (; b & bit; bit >>= 1) b ^= bit;
        b ^= bit;
        if (a < b) { var tr = re[a]; re[a] = re[b]; re[b] = tr; var ti = im[a]; im[a] = im[b]; im[b] = ti; }
      }
      for (var len = 2; len <= nfft; len <<= 1) {
        var ang = -2 * Math.PI / len, wr = Math.cos(ang), wi = Math.sin(ang);
        for (var s0 = 0; s0 < nfft; s0 += len) {
          var cr = 1, ci = 0;
          for (var k = 0; k < len / 2; k++) {
            var ur = re[s0 + k], ui = im[s0 + k];
            var vr = re[s0 + k + len / 2] * cr - im[s0 + k + len / 2] * ci;
            var vi = re[s0 + k + len / 2] * ci + im[s0 + k + len / 2] * cr;
            re[s0 + k] = ur + vr; im[s0 + k] = ui + vi;
            re[s0 + k + len / 2] = ur - vr; im[s0 + k + len / 2] = ui - vi;
            var nr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = nr;
          }
        }
      }
      var mag = new Array(nfft / 2);
      for (var q = 0; q < nfft / 2; q++) mag[q] = Math.hypot(re[q], im[q]) / x.length;
      return mag;
    },
    method2: function (buf) {
      var s = movAvg(buf, 10), d = [];
      for (var i = 1; i < s.length; i++) d.push(s[i] - s[i - 1]);
      d = movAvg(d, 3);
      var nfft = 2048, mag = this.spectrum(d, nfft);
      var bpmAxis = [], amp = [], best = -1, bestBpm = null;
      for (var k = 0; k < nfft / 2; k++) {
        var bpm = k * FS / nfft * 60;
        if (bpm > 300) break;
        bpmAxis.push(bpm); amp.push(mag[k]);
        if (bpm >= 20 && bpm <= 240 && mag[k] > best) { best = mag[k]; bestBpm = bpm; }
      }
      return { bpm: bestBpm, x: bpmAxis, y: amp };
    },
    method3: function (buf) {
      var s = movAvg(buf, 10), m = mean(s), x = s.map(function (v) { return v - m; });
      var bpmAxis = [], resp = [], best = -1, bestBpm = null;
      for (var bpm = 20; bpm <= 240; bpm += 1) {
        var w = 2 * Math.PI * bpm / 60 / FS, c = 0, sn = 0;
        for (var i = 0; i < x.length; i++) { c += x[i] * Math.cos(w * i); sn += x[i] * Math.sin(w * i); }
        var rsp = Math.hypot(c, sn);
        bpmAxis.push(bpm); resp.push(rsp);
        if (rsp > best) { best = rsp; bestBpm = bpm; }
      }
      return { bpm: bestBpm, x: bpmAxis, y: resp };
    }
  };

  /* =====================================================================
   * 1. Hero monitor
   * ==================================================================== */
  var sprite = new Image();
  sprite.src = "assets/media/speckle_frames.jpg";

  (function monitor() {
    var root = $("monitor"); if (!root) return;
    var cvS = $("mon-speckle"), cvT = $("mon-trace");
    var model = new SignalModel(7, 60, 0.85);
    var buf = [], flags = [], beats = [];
    var acc = 0, running = !REDUCED, clockT = 0, shownBpm = null, bpmTimer = 0, holdUntil = 0;
    var frameA = 0, frameB = 1, blend = 1, wobble = 0;
    var bpmEl = $("mon-bpm"), moveEl = $("mon-move");
    var hrDrift = 0;

    function step() {
      hrDrift += 0.004 * (model.r() - 0.5);
      hrDrift = clamp(hrDrift, -0.06, 0.06);
      model.hr = 60 * (1 + hrDrift + 0.03 * Math.sin(model.t / 19));
      var smp = model.sample();
      buf.push(smp.v); if (buf.length > BUF) buf.shift();
      beats.push(smp.beat); if (beats.length > BUF) beats.shift();
      var mv = buf.length >= BUF ? Proc.movement(buf).flag : false;
      flags.push(mv); if (flags.length > BUF) flags.shift();
      if (smp.beat || (smp.moving && model.r() < 0.35)) {
        frameA = frameB; frameB = (frameB + 1 + Math.floor(model.r() * 3)) % 5; blend = 0;
      }
      clockT += 1 / FS;
    }
    // Pre-fill so the page opens on a full trace.
    for (var i = 0; i < BUF + 30; i++) step();

    function drawSpeckle() {
      var g = setupCanvas(cvS), ctx = g.ctx, w = g.w, h = g.h;
      ctx.fillStyle = "#0a000c"; ctx.fillRect(0, 0, w, h);
      if (!sprite.complete || !sprite.naturalWidth) return;
      var fw = sprite.naturalWidth / 5, fh = sprite.naturalHeight;
      var j = 1.5 * Math.sin(wobble * 7), jy = 1.5 * Math.cos(wobble * 5);
      ctx.globalAlpha = 1;
      ctx.drawImage(sprite, frameA * fw, 0, fw, fh, j, jy, w, h);
      ctx.globalAlpha = clamp(blend, 0, 1);
      ctx.drawImage(sprite, frameB * fw, 0, fw, fh, 0, 0, w, h);
      ctx.globalAlpha = 1;
    }

    function drawTrace() {
      var g = setupCanvas(cvT), ctx = g.ctx, w = g.w, h = g.h;
      ctx.fillStyle = "#0b1622"; ctx.fillRect(0, 0, w, h);
      var n = buf.length; if (!n) return;
      var top = 10, bot = h - 18;
      var sorted = buf.slice().sort(function (a, b) { return a - b; });
      var max = Math.max(sorted[Math.floor(n * 0.985)] * 1.25, 6);
      ctx.strokeStyle = "rgba(255,255,255,0.07)"; ctx.lineWidth = 1;
      for (var s = 0; s <= 10; s += 2) {
        var gx = w - (s / 10) * w;
        ctx.beginPath(); ctx.moveTo(gx, top); ctx.lineTo(gx, bot); ctx.stroke();
      }
      // movement flags
      ctx.fillStyle = "rgba(214,48,42,0.35)";
      for (var i = 0; i < n; i++) {
        if (!flags[i]) continue;
        var j0 = i; while (i + 1 < n && flags[i + 1]) i++;
        var xa = Math.floor(j0 / (BUF - 1) * w), xb = Math.ceil((i + 1) / (BUF - 1) * w);
        ctx.fillRect(xa, top, xb - xa, bot - top);
      }
      ctx.strokeStyle = AMBER; ctx.lineWidth = 1.4; ctx.lineJoin = "round";
      ctx.beginPath();
      for (var k = 0; k < n; k++) {
        var x = k / (BUF - 1) * w, y = bot - clamp(buf[k] / max, 0, 1.08) * (bot - top);
        if (k) ctx.lineTo(x, y); else ctx.moveTo(x, y);
      }
      ctx.stroke();
      ctx.fillStyle = "rgba(255,255,255,0.5)"; ctx.font = "500 11px Archivo, sans-serif";
      ctx.textBaseline = "alphabetic";
      ctx.fillText("−10 s", 4, h - 5);
      ctx.textAlign = "right"; ctx.fillText("now", w - 4, h - 5); ctx.textAlign = "left";
    }

    function updateVitals(dt) {
      var mv = flags[flags.length - 1];
      bpmTimer += dt;
      if (mv) {
        moveEl.textContent = "moving"; moveEl.classList.add("on");
        holdUntil = clockT + 0.4;
      } else if (clockT > holdUntil) {
        moveEl.textContent = "still"; moveEl.classList.remove("on");
      }
      if (bpmTimer > 0.5) {
        bpmTimer = 0;
        if (mv) { bpmEl.textContent = "--"; shownBpm = null; }
        else {
          var r = Proc.method1(buf);
          if (r.bpm) { shownBpm = r.bpm; bpmEl.textContent = Math.round(r.bpm); }
        }
      }
      $("mon-clock").textContent = Math.floor(clockT) + " s";
    }

    function frame(dt) {
      if (running) {
        acc += dt;
        while (acc >= 1 / FS) { step(); acc -= 1 / FS; }
        blend += dt * 9; wobble += dt;
        updateVitals(dt);
      }
      drawSpeckle(); drawTrace();
    }
    sprite.addEventListener("load", function () { drawSpeckle(); });
    whileVisible(root, frame);
    drawTrace();
    updateVitals(1);

    $("mon-toggle").addEventListener("click", function () {
      running = !running; this.textContent = running ? "Pause" : "Play";
    });
    if (!running) $("mon-toggle").textContent = "Play";
    $("mon-shift").addEventListener("click", function () {
      model.move(2.4 + model.r());
      if (!running) { running = true; $("mon-toggle").textContent = "Pause"; }
    });
    window.addEventListener("resize", function () { drawSpeckle(); drawTrace(); });
  })();

  /* =====================================================================
   * 2. Frame strip (Fig. 1)
   * ==================================================================== */
  (function frames() {
    var strip = $("frame-strip"), pairs = $("frame-pairs"); if (!strip) return;
    var vals = [24.5, 27.9, 38.0, 30.1], shots = [];
    "abcde".split("").forEach(function (l, i) {
      var li = document.createElement("li");
      var shot = document.createElement("span");
      shot.className = "shot"; shot.style.backgroundPosition = (i * 25) + "% 0";
      shot.setAttribute("role", "img"); shot.setAttribute("aria-label", "Specklegram " + l);
      var lbl = document.createElement("span"); lbl.className = "lbl"; lbl.textContent = "Frame " + (i + 1);
      li.appendChild(shot); li.appendChild(lbl); strip.appendChild(li); shots.push(shot);
    });
    var btns = vals.map(function (v, i) {
      var b = document.createElement("button");
      b.type = "button"; b.innerHTML = "ΔI<sub>D</sub> = " + v.toFixed(1);
      b.setAttribute("aria-label", "Frames " + (i + 1) + " and " + (i + 2) + ": change " + v.toFixed(1));
      b.addEventListener("click", function () { select(i); });
      pairs.appendChild(b); return b;
    });
    function select(i) {
      btns.forEach(function (b, j) { b.setAttribute("aria-pressed", j === i ? "true" : "false"); });
      shots.forEach(function (s, j) { s.classList.toggle("sel", j === i || j === i + 1); });
    }
    select(2);
  })();

  /* =====================================================================
   * 3. Photo stepper
   * ==================================================================== */
  (function photos() {
    var frame = $("photo-frame"); if (!frame) return;
    var imgs = frame.querySelectorAll("img"), btns = $("photo-steps").querySelectorAll("button");
    btns.forEach(function (b, i) {
      b.addEventListener("click", function () {
        btns.forEach(function (o, j) { o.setAttribute("aria-pressed", j === i ? "true" : "false"); });
        imgs.forEach(function (im, j) { im.classList.toggle("on", j === i); });
      });
    });
  })();

  /* =====================================================================
   * 4. Processing lab
   * ==================================================================== */
  (function lab() {
    var root = $("lab"); if (!root) return;
    var cv1 = $("lab-signal"), cv2 = $("lab-second");
    var hrIn = $("lab-hr"), qIn = $("lab-q");
    var model = new SignalModel(21, +hrIn.value, +qIn.value);
    var buf = [], acc = 0, method = "1", calcTimer = 1, last = null, flagNow = false, held = null;
    var COST = { 1: "0.25 ms per frame", 2: "0.35 ms per frame", 3: "38.0 ms per frame" };
    var TITLE = { 1: "Smoothed signal and detected beats", 2: "Spectrum of the derivative", 3: "Match with each sinusoid" };

    for (var i = 0; i < BUF; i++) { buf.push(model.sample().v); }

    function qLabel(q) { return q > 0.8 ? "very good" : q > 0.6 ? "good" : q > 0.4 ? "fair" : q > 0.2 ? "poor" : "very poor"; }

    function compute() {
      var mv = Proc.movement(buf);
      var res = method === "1" ? Proc.method1(buf) : method === "2" ? Proc.method2(buf) : Proc.method3(buf);
      flagNow = mv.flag;
      if (!flagNow && res.bpm) held = res.bpm;
      last = { mv: mv, res: res };
      $("lab-ratio").textContent = mv.ratio.toFixed(2);
      $("lab-ratio").style.color = mv.flag ? ALARM : "";
      var truth = model.hr;
      $("lab-true").textContent = Math.round(truth) + " BPM";
      if (flagNow) {
        $("lab-est").textContent = held ? Math.round(held) + " BPM, held" : "--";
        $("lab-err").textContent = "--";
        $("lab-note").textContent = "Movement detected: the recent part of the buffer differs from the older part by more than 10 %, so the last good value is held.";
      } else if (res.bpm) {
        var err = res.bpm - truth;
        $("lab-est").textContent = Math.round(res.bpm) + " BPM";
        $("lab-err").textContent = (err >= 0 ? "+" : "−") + Math.abs(err).toFixed(1) + " BPM";
        var rel = Math.abs(err) / truth;
        $("lab-err").style.color = rel > 0.1 ? ALARM : "";
        $("lab-note").textContent = rel > 0.1
          ? "More than 10 % off. With a poor signal, breathing and stray jolts can look like beats, or a harmonic can win."
          : "Within 10 % of the true rate.";
      } else {
        $("lab-est").textContent = "--"; $("lab-err").textContent = "--";
        $("lab-note").textContent = "Not enough beats in the buffer yet.";
      }
    }

    function axes(ctx, w, h, pad) {
      ctx.strokeStyle = RULE; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(pad.l, h - pad.b + 0.5); ctx.lineTo(w - pad.r, h - pad.b + 0.5); ctx.stroke();
    }

    function drawSignal() {
      var g = setupCanvas(cv1), ctx = g.ctx, w = g.w, h = g.h;
      ctx.clearRect(0, 0, w, h);
      var pad = { l: 8, r: 8, t: 10, b: 20 };
      var sorted = buf.slice().sort(function (a, b) { return a - b; });
      var max = Math.max(sorted[Math.floor(BUF * 0.99)] * 1.15, 6);
      var X = function (i) { return pad.l + i / (BUF - 1) * (w - pad.l - pad.r); };
      var Y = function (v) { return h - pad.b - clamp(v / max, 0, 1.04) * (h - pad.t - pad.b); };
      if (last) {
        var mv = last.mv;
        ctx.fillStyle = flagNow ? "rgba(214,48,42,0.12)" : "rgba(42,95,214,0.10)";
        ctx.fillRect(X(mv.cut), pad.t, X(BUF - 1) - X(mv.cut), h - pad.t - pad.b);
        ctx.setLineDash([5, 4]); ctx.lineWidth = 1.5;
        ctx.strokeStyle = INK; ctx.beginPath(); ctx.moveTo(X(0), Y(mv.oldMean)); ctx.lineTo(X(mv.cut), Y(mv.oldMean)); ctx.stroke();
        ctx.strokeStyle = flagNow ? ALARM : M_COLORS[1]; ctx.beginPath(); ctx.moveTo(X(mv.cut), Y(mv.recMean)); ctx.lineTo(X(BUF - 1), Y(mv.recMean)); ctx.stroke();
        ctx.setLineDash([]);
      }
      ctx.strokeStyle = "#7d8a96"; ctx.lineWidth = 1; ctx.beginPath();
      buf.forEach(function (v, i) { if (i) ctx.lineTo(X(i), Y(v)); else ctx.moveTo(X(i), Y(v)); });
      ctx.stroke();
      axes(ctx, w, h, pad);
      ctx.fillStyle = INK_SOFT; ctx.font = "500 11px Archivo, sans-serif";
      ctx.fillText("old window, 80 %", X(4), h - 6);
      ctx.textAlign = "right"; ctx.fillText("recent, 20 %", X(BUF - 2), h - 6); ctx.textAlign = "left";
    }

    function drawSecond() {
      var g = setupCanvas(cv2), ctx = g.ctx, w = g.w, h = g.h;
      ctx.clearRect(0, 0, w, h);
      if (!last) return;
      var res = last.res, pad = { l: 8, r: 8, t: 12, b: 20 }, col = M_COLORS[method];
      ctx.font = "500 11px Archivo, sans-serif";
      if (method === "1") {
        var s = res.smooth, s0 = 14, tail = s.slice(s0), lo = Math.min.apply(null, tail), hi = Math.max.apply(null, tail);
        var X = function (i) { return pad.l + i / (BUF - 1) * (w - pad.l - pad.r); };
        var Y = function (v) { return h - pad.b - (v - lo) / (hi - lo || 1) * (h - pad.t - pad.b); };
        ctx.strokeStyle = col; ctx.lineWidth = 2; ctx.beginPath();
        for (var i0 = s0; i0 < s.length; i0++) { if (i0 > s0) ctx.lineTo(X(i0), Y(s[i0])); else ctx.moveTo(X(i0), Y(s[i0])); }
        ctx.stroke();
        ctx.fillStyle = ALARM;
        res.peaks.forEach(function (p) { ctx.beginPath(); ctx.arc(X(p), Y(clamp(s[p], lo, hi)), 4, 0, 7); ctx.fill(); });
        ctx.fillStyle = INK_SOFT;
        for (var j = 1; j < res.peaks.length; j++) {
          var a = res.peaks[j - 1], b = res.peaks[j];
          ctx.textAlign = "center";
          ctx.fillText(((b - a) / FS).toFixed(2), (X(a) + X(b)) / 2, h - 6);
        }
        ctx.textAlign = "left";
        $("lab-second-note").textContent = res.peaks.length + " beats, intervals in s";
      } else {
        var xs = res.x, ys = res.y, xmax = method === "2" ? 300 : 240, xmin = method === "2" ? 0 : 20;
        var ymax = Math.max.apply(null, ys.filter(function (_, i) { return xs[i] >= 20; })) * 1.1 || 1;
        var X2 = function (b) { return pad.l + (b - xmin) / (xmax - xmin) * (w - pad.l - pad.r); };
        var Y2 = function (v) { return h - pad.b - clamp(v / ymax, 0, 1.05) * (h - pad.t - pad.b); };
        ctx.fillStyle = "rgba(14,34,51,0.04)";
        if (method === "2") ctx.fillRect(X2(0), pad.t, X2(20) - X2(0), h - pad.t - pad.b);
        ctx.strokeStyle = col; ctx.lineWidth = 1.8; ctx.beginPath();
        xs.forEach(function (b, i) { if (i) ctx.lineTo(X2(b), Y2(ys[i])); else ctx.moveTo(X2(b), Y2(ys[i])); });
        ctx.stroke();
        axes(ctx, w, h, pad);
        ctx.fillStyle = INK_SOFT; ctx.textAlign = "center";
        for (var t = 50; t <= xmax; t += 50) ctx.fillText(t, X2(t), h - 6);
        ctx.textAlign = "left";
        if (res.bpm) {
          var bi = xs.indexOf(res.bpm);
          ctx.fillStyle = ALARM; ctx.beginPath(); ctx.arc(X2(res.bpm), Y2(ys[bi]), 5, 0, 7); ctx.fill();
          ctx.strokeStyle = "rgba(14,34,51,0.35)"; ctx.setLineDash([3, 3]);
          ctx.beginPath(); ctx.moveTo(X2(model.hr), pad.t); ctx.lineTo(X2(model.hr), h - pad.b); ctx.stroke(); ctx.setLineDash([]);
        }
        $("lab-second-note").textContent = "BPM, dashed line at the true rate";
      }
    }

    function frame(dt) {
      if (!REDUCED || dt) {
        acc += dt;
        while (acc >= 1 / FS) { buf.push(model.sample().v); buf.shift(); acc -= 1 / FS; }
      }
      calcTimer += dt;
      if (calcTimer > (method === "3" ? 0.25 : 0.12)) { calcTimer = 0; compute(); }
      drawSignal(); drawSecond();
      $("lab-time").textContent = "t = " + Math.floor(model.t) + " s";
    }
    whileVisible(root, frame);

    toggleGroup($("lab-method"), function (k) {
      method = k; $("lab-cost").textContent = COST[k]; $("lab-second-title").textContent = TITLE[k];
      compute(); drawSecond();
    });
    hrIn.addEventListener("input", function () { model.hr = +hrIn.value; $("lab-hr-out").textContent = hrIn.value + " BPM"; });
    qIn.addEventListener("input", function () { model.quality = +qIn.value; $("lab-q-out").textContent = qLabel(+qIn.value); });
    $("lab-q-out").textContent = qLabel(+qIn.value);
    $("lab-move").addEventListener("click", function () { model.move(2.5 + model.r()); });
    compute(); drawSignal(); drawSecond();
    window.addEventListener("resize", function () { drawSignal(); drawSecond(); });
  })();

  /* =====================================================================
   * 5. Results: Table 1 explorer and heat map
   * ==================================================================== */
  // Share of the time with more than 10 % error, %, Table 1. [ring, band]
  var TPE = {
    head_side:   { 1: [2.48, 2.09],   2: [7.41, 6.45],   3: [4.15, 2.91] },
    head_back:   { 1: [27.78, 20.21], 2: [31.02, 22.66], 3: [27.14, 18.58] },
    coccyx_side: { 1: [30.89, 24.60], 2: [33.95, 26.00], 3: [25.69, 20.64] },
    coccyx_back: { 1: [38.19, 49.67], 2: [45.53, 59.29], 3: [40.68, 52.90] }
  };
  var LOC = { head: "under the head", coccyx: "under the coccyx" }, POST = { side: "on the side", back: "on the back" };
  var SENS = { ring: "Ring", band: "Band" };
  var state = { sensor: "band", loc: "head", post: "side" };
  var setExplorer = function () {};

  (function explorer() {
    var root = $("explorer"); if (!root) return;
    var hrImg = $("ex-hr"), maeImg = $("ex-mae"), bars = $("ex-bars"), note = $("ex-note");
    $("ex-legend").innerHTML = [1, 2, 3].map(function (m) {
      return '<li><span class="line" style="border-top-color:' + M_COLORS[m] + ';border-top-width:3px"></span>Method ' + m + "</li>";
    }).join("") + '<li><span class="shape circle" style="background:#fff;border:2.5px solid #111;width:.7rem;height:.7rem"></span>Pulse oximeter</li>';

    function drawBars() {
      var key = state.loc + "_" + state.post, si = state.sensor === "ring" ? 0 : 1;
      var W = 560, rowH = 30, H = rowH * 3 + 26, L = 92, R = 60;
      bars.innerHTML = "";
      var svg = el("svg", { viewBox: "0 0 " + W + " " + H, role: "img", "aria-label": "Bar chart of the share of time with more than 10 % error for the three methods" });
      var X = function (v) { return L + v / 60 * (W - L - R); };
      [0, 20, 40, 60].forEach(function (t) {
        svg.appendChild(el("line", { x1: X(t), x2: X(t), y1: 0, y2: rowH * 3, stroke: GRID }));
        svg.appendChild(el("text", { x: X(t), y: rowH * 3 + 16, "text-anchor": "middle", class: "tick" }, t + " %"));
      });
      [1, 2, 3].forEach(function (m, i) {
        var v = TPE[key][m][si], other = TPE[key][m][1 - si];
        var y = i * rowH + 6;
        svg.appendChild(el("text", { x: 0, y: y + 13, class: "lab" }, "Method " + m));
        svg.appendChild(el("rect", { x: X(0), y: y + 15, width: X(other) - X(0), height: 4, fill: RULE, rx: 2 }));
        svg.appendChild(el("rect", { x: X(0), y: y, width: Math.max(1, X(v) - X(0)), height: 13, fill: M_COLORS[m], rx: 2 }));
        svg.appendChild(el("text", { x: X(v) + 6, y: y + 11, class: "lab" }, v.toFixed(1) + " %"));
      });
      bars.appendChild(svg);
      var best = [1, 2, 3].reduce(function (a, m) { return TPE[key][m][si] < TPE[key][a][si] ? m : a; }, 1);
      note.textContent = SENS[state.sensor] + " sensor " + LOC[state.loc] + ", " + POST[state.post] +
        ": the best method here, method " + best + ", is within 10 % of the pulse oximeter " +
        (100 - TPE[key][best][si]).toFixed(1) + " % of the time. The thin grey bars show the " +
        (state.sensor === "ring" ? "band" : "ring") + " sensor in the same place, for comparison. Each dot in the left panel is one volunteer’s pulse oximeter average.";
    }
    setExplorer = function (s) {
      for (var k in s) state[k] = s[k];
      setToggle($("ex-sensor"), state.sensor); setToggle($("ex-loc"), state.loc); setToggle($("ex-post"), state.post);
      var tag = state.sensor + "_" + state.loc + "_" + state.post;
      hrImg.src = "assets/media/panels/hr_" + tag + ".png";
      maeImg.src = "assets/media/panels/mae_" + tag + ".png";
      var desc = SENS[state.sensor] + " sensor " + LOC[state.loc] + ", " + POST[state.post];
      hrImg.alt = "Mean heart rate of each of the 20 volunteers from the three methods and the pulse oximeter. " + desc + ".";
      maeImg.alt = "Mean absolute error of each volunteer for the three methods. " + desc + ".";
      drawBars(); drawHeat();
    };
    toggleGroup($("ex-sensor"), function (k) { setExplorer({ sensor: k }); });
    toggleGroup($("ex-loc"), function (k) { setExplorer({ loc: k }); });
    toggleGroup($("ex-post"), function (k) { setExplorer({ post: k }); });
  })();

  function drawHeat() {
    var host = $("heatmap"); if (!host) return;
    host.innerHTML = "";
    var cols = [];
    ["ring", "band"].forEach(function (s) {
      ["head", "coccyx"].forEach(function (l) {
        ["side", "back"].forEach(function (p) { cols.push({ s: s, l: l, p: p }); });
      });
    });
    var W = 760, L = 84, cw = (W - L) / 8, rh = 40, T = 62, H = T + rh * 3 + 6;
    var svg = el("svg", { viewBox: "0 0 " + W + " " + H, role: "img", "aria-label": "Heat map of Table 1: share of time with more than 10 % error for three methods in eight configurations" });
    [["Ring sensor", 0], ["Band sensor", 4]].forEach(function (g) {
      svg.appendChild(el("text", { x: L + (g[1] + 2) * cw, y: 14, "text-anchor": "middle", class: "axis" }, g[0]));
      svg.appendChild(el("line", { x1: L + g[1] * cw + 6, x2: L + (g[1] + 4) * cw - 6, y1: 21, y2: 21, stroke: INK_SOFT }));
    });
    cols.forEach(function (c, i) {
      if (i % 2 === 0) svg.appendChild(el("text", { x: L + (i + 1) * cw, y: 37, "text-anchor": "middle", class: "lab" }, c.l === "head" ? "Head" : "Coccyx"));
      svg.appendChild(el("text", { x: L + (i + 0.5) * cw, y: 54, "text-anchor": "middle", class: "lab soft" }, c.p === "side" ? "side" : "back"));
    });
    [1, 2, 3].forEach(function (m, r) {
      svg.appendChild(el("text", { x: 0, y: T + r * rh + rh / 2 + 4, class: "lab" }, "Method " + m));
      cols.forEach(function (c, i) {
        var v = TPE[c.l + "_" + c.p][m][c.s === "ring" ? 0 : 1];
        var f = clamp(v / 60, 0, 1);
        var g = el("g", { class: "cell" + (c.s === state.sensor && c.l === state.loc && c.p === state.post ? " sel" : ""), tabindex: 0, role: "button",
          "aria-label": SENS[c.s] + " " + LOC[c.l] + " " + POST[c.p] + ", method " + m + ": " + v.toFixed(1) + " %" });
        g.appendChild(el("rect", { x: L + i * cw + 2, y: T + r * rh + 2, width: cw - 4, height: rh - 4, rx: 3,
          fill: "rgb(" + Math.round(255 - f * 241) + "," + Math.round(255 - f * 221) + "," + Math.round(255 - f * 204) + ")" }));
        g.appendChild(el("text", { x: L + (i + 0.5) * cw, y: T + r * rh + rh / 2 + 4, "text-anchor": "middle", class: "lab",
          style: "fill:" + (f > 0.45 ? "#fff" : INK) }, v.toFixed(1)));
        var go = function () { setExplorer({ sensor: c.s, loc: c.l, post: c.p }); $("explorer").scrollIntoView({ behavior: REDUCED ? "auto" : "smooth", block: "start" }); };
        g.addEventListener("click", go);
        g.addEventListener("keydown", function (ev) { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); go(); } });
        svg.appendChild(g);
      });
    });
    host.appendChild(svg);
  }
  setExplorer({});

  /* =====================================================================
   * 6. A night's sleep (Table 2)
   * ==================================================================== */
  (function night() {
    var t = $("night-toggle"); if (!t) return;
    var notes = {
      all: "Red bands are the moments the movement detector flagged. Between them, the specklegram estimates stay in the same band as the pulse oximeter, around 55 BPM, all night.",
      zoom: "Six minutes of the same night. Three movements in a row: the estimates are unreliable while flagged and for a few seconds after, then settle back on the reference at about 55 BPM."
    };
    toggleGroup(t, function (k) {
      $("night-all").classList.toggle("on", k === "all");
      $("night-zoom").classList.toggle("on", k === "zoom");
      $("night-note").textContent = notes[k];
    });
    var stats = [
      ["56.1", "BPM, mean heart rate from the pulse oximeter"],
      ["54.0", "BPM from the specklegram, method 1 (53.0 and 53.6 with methods 2 and 3)"],
      ["4.9", "BPM mean absolute error, method 1 (5.4 and 4.9 with methods 2 and 3)"],
      ["20.7 %", "of the time more than 10 % off, method 1 (22.2 % and 21.1 %)"]
    ];
    $("night-stats").innerHTML = stats.map(function (s) {
      return '<div class="stat"><b>' + s[0] + "</b><span>" + s[1] + "</span></div>";
    }).join("");
  })();

  /* ------------------------------------------------------------- BibTeX */
  var cb = $("copy-bibtex");
  if (cb) cb.addEventListener("click", function () {
    var txt = $("bibtex").textContent;
    (navigator.clipboard ? navigator.clipboard.writeText(txt) : Promise.reject()).then(function () {
      cb.textContent = "Copied";
      setTimeout(function () { cb.textContent = "Copy BibTeX"; }, 1800);
    }).catch(function () {
      var r = document.createRange(); r.selectNodeContents($("bibtex")); var s = window.getSelection(); s.removeAllRanges(); s.addRange(r);
    });
  });
})();
