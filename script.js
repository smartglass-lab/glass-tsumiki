/* グラスつみき — Glass Tsumiki
 * 入力: D-pad（矢印キー）とタップ（Enter）のみ。Escape は PC 確認用の補助。
 * 依存ライブラリなし。Canvas + DOM。アイソメ風の擬似3Dで描画する。
 * ?auto=1 で自動プレイ（デモ録画用。PERFECTを連発しつつ時々ずらし、最後に失敗する。記録は保存しない）。
 * ?miss=N で自動プレイが失敗する段を指定。
 */
(function () {
  'use strict';

  var el = function (id) { return document.getElementById(id); };
  var qs = location.search;
  var AUTO = /[?&]auto=1/.test(qs);
  var MISS_AT = (function () { var m = /[?&]miss=(\d+)/.exec(qs); return m ? Math.max(2, +m[1]) : 17; })();

  // ---------- 定数 ----------
  var C30 = Math.cos(Math.PI / 6);
  var BASE = 150;      // 初期ブロックの一辺
  var H = 20;          // 1段の高さ
  var R = 190;         // 往復の振れ幅
  var PERF = 7;        // これ以内のずれは PERFECT
  var BASE_DEPTH = 320;
  var FONT = '"Hiragino Sans","Noto Sans JP",sans-serif';

  // ---------- 状態 ----------
  var mode = 'title', menuIdx = 0, menuItems = [], menuEl = 'title-list', howtoFrom = 'title';
  var stack = [], cur = null, debris = [], fx = [];
  var state = 'play', combo = 0, maxCombo = 0, perfects = 0, hue0 = 190;
  var pop = { t: 9, text: '' };
  var view = { S: 1, camY: -40, AY: 380 }, camTarget = -40;
  var overT = 0, zoomT = -1, zoomFrom = null, zoomTo = null, sweepT = 0, resultShown = false, isNewBest = false;
  var best = 0, bestCombo = 0;
  var lastT = 0;

  // ---------- 保存 ----------
  var KEY = 'glass-tsumiki-v1';
  function save() {
    if (AUTO) return;
    try { localStorage.setItem(KEY, JSON.stringify({ best: best, combo: bestCombo })); }
    catch (e) { /* 保存できなくても動作には影響しない */ }
  }
  function load() {
    try {
      var s = JSON.parse(localStorage.getItem(KEY) || 'null');
      if (!s) return;
      if (typeof s.best === 'number' && s.best >= 0) best = Math.floor(s.best);
      if (typeof s.combo === 'number' && s.combo >= 0) bestCombo = Math.floor(s.combo);
    } catch (e) { /* 壊れていたら初期値のまま */ }
  }

  // ---------- 描画ユーティリティ ----------
  var cv = el('cv'), ctx = cv.getContext('2d');
  function P(x, y, z) {
    return [300 + (x - z) * C30 * view.S, view.AY + (x + z) * 0.5 * view.S - (y - view.camY) * view.S];
  }
  function hsl(h, s, l, a) { return 'hsla(' + (((h % 360) + 360) % 360) + ',' + s + '%,' + l + '%,' + (a == null ? 1 : a) + ')'; }
  function poly(c, pts, fill) {
    c.beginPath(); c.moveTo(pts[0][0], pts[0][1]);
    for (var i = 1; i < pts.length; i++) c.lineTo(pts[i][0], pts[i][1]);
    c.closePath(); c.fillStyle = fill; c.fill();
  }
  // b: {cx,cz,w,d,y0,y1}  opt: {glow, fade, alpha}
  function drawBox(c, proj, b, hue, opt) {
    opt = opt || {};
    var x0 = b.cx - b.w / 2, x1 = b.cx + b.w / 2, z0 = b.cz - b.d / 2, z1 = b.cz + b.d / 2;
    var t00 = proj(x0, b.y1, z0), t10 = proj(x1, b.y1, z0), t11 = proj(x1, b.y1, z1), t01 = proj(x0, b.y1, z1);
    var b10 = proj(x1, b.y0, z0), b11 = proj(x1, b.y0, z1), b01 = proj(x0, b.y0, z1);
    var g = opt.glow || 0, a = opt.alpha == null ? 1 : opt.alpha;
    var right = hsl(hue, 90, 44 + g * 18, a), left = hsl(hue, 90, 32 + g * 16, a);
    if (opt.fade) {
      var gr = c.createLinearGradient(0, t11[1], 0, b11[1]);
      gr.addColorStop(0, right); gr.addColorStop(1, '#000000'); right = gr;
      var gl = c.createLinearGradient(0, t11[1], 0, b11[1]);
      gl.addColorStop(0, left); gl.addColorStop(1, '#000000'); left = gl;
    }
    poly(c, [t10, t11, b11, b10], right);
    poly(c, [t01, t11, b11, b01], left);
    poly(c, [t00, t10, t11, t01], hsl(hue, 95, 60 + g * 22, a));
    c.strokeStyle = 'rgba(255,255,255,' + (0.3 + g * 0.5) * a + ')';
    c.lineWidth = 1;
    c.beginPath(); c.moveTo(t00[0], t00[1]); c.lineTo(t10[0], t10[1]); c.lineTo(t11[0], t11[1]); c.lineTo(t01[0], t01[1]); c.closePath(); c.stroke();
  }
  function hueOf(k) { return hue0 + k * 8; }

  // ---------- ゲーム ----------
  function topBlock() {
    return stack.length ? stack[stack.length - 1] : { cx: 0, cz: 0, w: BASE, d: BASE, y0: -BASE_DEPTH, y1: 0 };
  }
  function speedOf(k) { return Math.min(440, 170 + k * 7) * (AUTO ? 1.1 : 1); }
  function spawn() {
    var t = topBlock(), k = stack.length;
    cur = { cx: t.cx, cz: t.cz, w: t.w, d: t.d, y0: t.y1, y1: t.y1 + H, k: k, axis: k % 2 ? 'z' : 'x', off: -R, dir: 1 };
    cur.autoTarget = autoTargetFor(k, cur.axis === 'x' ? cur.w : cur.d);
    placeCur();
  }
  function placeCur() {
    var t = topBlock();
    cur.cx = t.cx + (cur.axis === 'x' ? cur.off : 0);
    cur.cz = t.cz + (cur.axis === 'z' ? cur.off : 0);
  }
  var AUTO_PLAN = { 3: 26, 6: -20, 9: 32, 13: -16 };
  function autoTargetFor(k, size) {
    if (!AUTO) return null;
    if (k === MISS_AT) return size + 14;
    if (AUTO_PLAN[k] !== undefined) return AUTO_PLAN[k];
    return (Math.random() - 0.5) * 6;
  }

  function startGame() {
    stack = []; debris = []; fx = [];
    combo = 0; maxCombo = 0; perfects = 0;
    hue0 = AUTO ? 175 : Math.floor(Math.random() * 360);
    view = { S: 1, camY: -40, AY: 380 }; camTarget = -40;
    state = 'play'; overT = 0; zoomT = -1; resultShown = false; isNewBest = false;
    pop = { t: 9, text: '' };
    spawn();
    openGame();
  }

  function addDebris(b, hue, sign, axis) {
    var v = 60 + Math.random() * 40;
    var spin = (axis === 'x' ? 1 : -1) * sign * (1.6 + Math.random() * 1.6);
    debris.push({
      cx: b.cx, cz: b.cz, w: b.w, d: b.d, y0: b.y0, y1: b.y1, hue: hue,
      vx: axis === 'x' ? sign * v : 0, vz: axis === 'z' ? sign * v : 0, vy: 40,
      rot: 0, vr: spin, front: sign > 0, life: 0
    });
  }

  function drop() {
    if (state !== 'play' || !cur) return;
    var t = topBlock(), ax = cur.axis, size = ax === 'x' ? t.w : t.d, delta = cur.off;
    var perfect = Math.abs(delta) <= PERF;
    if (perfect) delta = 0;
    var overlap = size - Math.abs(delta);
    var hue = hueOf(cur.k);
    if (overlap <= 0) { // まったく重ならない → おしまい
      addDebris(cur, hue, delta > 0 ? 1 : -1, ax);
      cur = null;
      gameOver();
      return;
    }
    var nb = { cx: t.cx, cz: t.cz, w: t.w, d: t.d, y0: cur.y0, y1: cur.y1 };
    var sign = delta > 0 ? 1 : -1;
    if (perfect) {
      combo++; perfects++;
      if (combo > maxCombo) maxCombo = combo;
      var grow = Math.min(8, 1 + combo * 2);
      if (ax === 'x') nb.w = Math.min(BASE, nb.w + grow); else nb.d = Math.min(BASE, nb.d + grow);
      fx.push({ b: { cx: nb.cx, cz: nb.cz, w: nb.w, d: nb.d, y1: nb.y1 }, t: 0 });
      pop = { t: 0, text: combo >= 2 ? 'PERFECT ×' + combo : 'PERFECT' };
    } else {
      combo = 0;
      var tc = ax === 'x' ? t.cx : t.cz;
      var newC = tc + delta / 2;
      var cutC = tc + sign * (size / 2 + Math.abs(delta) / 2);
      var cut = { cx: nb.cx, cz: nb.cz, w: nb.w, d: nb.d, y0: nb.y0, y1: nb.y1 };
      if (ax === 'x') { nb.cx = newC; nb.w = overlap; cut.cx = cutC; cut.w = Math.abs(delta); }
      else { nb.cz = newC; nb.d = overlap; cut.cz = cutC; cut.d = Math.abs(delta); }
      addDebris(cut, hue, sign, ax);
      pop = { t: 0, text: '' };
    }
    stack.push(nb);
    camTarget = nb.y1 - 40;
    spawn();
    renderHud();
  }

  function gameOver() {
    state = 'fall'; overT = 0;
    el('hint').classList.add('hidden');
    var n = stack.length;
    isNewBest = n > best && n > 0;
    if (!AUTO) {
      if (n > best) best = n;
      if (maxCombo > bestCombo) bestCombo = maxCombo;
      save();
    }
    renderHud();
  }
  function startZoom() {
    var top = stack.length * H;
    zoomT = 0;
    zoomFrom = { S: view.S, camY: view.camY, AY: view.AY };
    zoomTo = { S: Math.min(1, 370 / (top + 270)), camY: (top - 120) / 2, AY: 232 };
  }

  function update(dt) {
    if (state === 'play' && cur) {
      var sp = speedOf(cur.k);
      var prev = cur.off;
      cur.off += cur.dir * sp * dt;
      if (cur.off > R) { cur.off = R; cur.dir = -1; }
      if (cur.off < -R) { cur.off = -R; cur.dir = 1; }
      if (AUTO && cur.autoTarget != null) {
        var tg = cur.autoTarget;
        if ((prev - tg) * (cur.off - tg) <= 0 && prev !== cur.off) {
          cur.off = tg;
          placeCur();
          drop();
          return;
        }
      }
      placeCur();
    }
    // カメラ
    if (state === 'play' || state === 'fall') view.camY += (camTarget - view.camY) * Math.min(1, dt * 6);
    if (state === 'fall') {
      overT += dt;
      if (overT > 0.9) { state = 'over'; startZoom(); }
    }
    if (state === 'over') {
      if (zoomT < 1) {
        zoomT = Math.min(1, zoomT + dt / 1.4);
        var e = zoomT < 0.5 ? 2 * zoomT * zoomT : 1 - Math.pow(-2 * zoomT + 2, 2) / 2;
        view.S = zoomFrom.S + (zoomTo.S - zoomFrom.S) * e;
        view.camY = zoomFrom.camY + (zoomTo.camY - zoomFrom.camY) * e;
        view.AY = zoomFrom.AY + (zoomTo.AY - zoomFrom.AY) * e;
        if (zoomT >= 1 && !resultShown) { resultShown = true; sweepT = 0; openResult(); }
      } else sweepT += dt;
    }
    // 破片
    for (var i = debris.length - 1; i >= 0; i--) {
      var d = debris[i];
      d.life += dt;
      d.vy -= 900 * dt;
      d.y0 += d.vy * dt; d.y1 += d.vy * dt;
      d.cx += d.vx * dt; d.cz += d.vz * dt;
      d.rot += d.vr * dt;
      if (d.life > 3.5) debris.splice(i, 1);
    }
    for (i = fx.length - 1; i >= 0; i--) { fx[i].t += dt; if (fx[i].t > 0.6) fx.splice(i, 1); }
    pop.t += dt;
  }

  function drawDebris(front) {
    for (var i = 0; i < debris.length; i++) {
      var d = debris[i];
      if (d.front !== front) continue;
      var c = P(d.cx, (d.y0 + d.y1) / 2, d.cz);
      ctx.save();
      ctx.translate(c[0], c[1]); ctx.rotate(d.rot); ctx.translate(-c[0], -c[1]);
      drawBox(ctx, P, d, d.hue, { alpha: Math.max(0, Math.min(1, 3.5 - d.life)) });
      ctx.restore();
    }
  }

  function draw() {
    ctx.clearRect(0, 0, 600, 600);
    var n = stack.length;
    drawDebris(false);
    // 土台
    drawBox(ctx, P, { cx: 0, cz: 0, w: BASE, d: BASE, y0: -BASE_DEPTH, y1: 0 }, hue0 - 8, { fade: true, alpha: 0.5 });
    // タワー
    var sweep = -99;
    if (state === 'over' && zoomT >= 1) {
      var period = Math.max(2.2, n * 0.07 + 1.4);
      sweep = ((sweepT % period) / (period - 0.8)) * (n + 6) - 3;
    }
    for (var k = 0; k < n; k++) {
      var b = stack[k];
      var sy = P(b.cx, b.y1, b.cz)[1];
      if (sy > 700 || sy < -200) continue;
      var glow = sweep > -50 ? Math.max(0, 1 - Math.abs(sweep - k) / 3) : 0;
      drawBox(ctx, P, b, hueOf(k), { glow: glow });
    }
    // PERFECT のリング
    for (var i = 0; i < fx.length; i++) {
      var f = fx[i], s = 1 + f.t * 0.7, fb = f.b;
      var w = fb.w * s / 2, dd = fb.d * s / 2;
      var p1 = P(fb.cx - w, fb.y1, fb.cz - dd), p2 = P(fb.cx + w, fb.y1, fb.cz - dd), p3 = P(fb.cx + w, fb.y1, fb.cz + dd), p4 = P(fb.cx - w, fb.y1, fb.cz + dd);
      ctx.strokeStyle = 'rgba(255,255,255,' + Math.max(0, 1 - f.t / 0.6) + ')';
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(p1[0], p1[1]); ctx.lineTo(p2[0], p2[1]); ctx.lineTo(p3[0], p3[1]); ctx.lineTo(p4[0], p4[1]); ctx.closePath(); ctx.stroke();
    }
    // 動いているブロック
    if (cur && state === 'play') drawBox(ctx, P, cur, hueOf(cur.k), { glow: 0.15 });
    drawDebris(true);

    // 段数（大）
    var numA = state === 'over' ? Math.max(0, 1 - zoomT * 2) : 1;
    if (numA > 0) {
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillStyle = 'rgba(255,255,255,' + 0.92 * numA + ')';
      ctx.font = '900 68px ' + FONT;
      ctx.fillText(String(n), 300, 108);
      if (pop.t < 1 && pop.text) {
        var pa = Math.max(0, 1 - pop.t) * numA;
        ctx.fillStyle = 'rgba(255,209,102,' + pa + ')';
        ctx.font = '900 ' + Math.round(28 + (1 - Math.min(1, pop.t * 5)) * 8) + 'px ' + FONT;
        ctx.fillText(pop.text, 300, 166 - pop.t * 10);
      }
    }
  }

  function renderHud() {
    var shown = Math.max(best, stack.length);
    el('hud-right').textContent = 'ベスト ' + shown + '段' + (combo >= 2 ? '　コンボ ' + combo : '');
  }

  // ---------- タイトルのロゴ ----------
  function drawLogo() {
    var lc = el('logo').getContext('2d');
    lc.clearRect(0, 0, 160, 110);
    var proj = function (x, y, z) { return [80 + (x - z) * C30 * 0.34, 64 + (x + z) * 0.5 * 0.34 - y * 0.34]; };
    var offs = [0, 10, -6, 14, 4, -4];
    var sizes = [150, 140, 128, 118, 104, 92];
    for (var i = 0; i < 6; i++) {
      var b = { cx: i % 2 ? 0 : offs[i], cz: i % 2 ? offs[i] : 0, w: sizes[i], d: i % 2 ? sizes[i] : 150 - i * 6, y0: i * 20 - 40, y1: i * 20 - 20 };
      drawBox(lc, proj, b, 175 + i * 16, {});
    }
  }

  // ---------- 画面 ----------
  var SCREENS = ['title', 'menu', 'howto'];
  function show(id) {
    for (var i = 0; i < SCREENS.length; i++) el(SCREENS[i]).classList.toggle('hidden', SCREENS[i] !== id);
    el('hud').classList.toggle('hidden', id === 'title');
    el('result').classList.toggle('hidden', id !== 'result');
    el('hint').classList.toggle('hidden', !(id === 'game' && state === 'play'));
  }
  function renderList() {
    var box = el(menuEl);
    box.innerHTML = '';
    menuItems.forEach(function (it, i) {
      var b = document.createElement('div');
      b.className = 'rail-btn' + (i === menuIdx ? ' cur' : '');
      b.innerHTML = '<span>' + it.label + '</span>' + (it.sub ? '<small>' + it.sub + '</small>' : '');
      b.addEventListener('click', function () { menuIdx = i; renderList(); it.act(); });
      box.appendChild(b);
    });
  }
  function openTitle() {
    mode = 'title'; menuEl = 'title-list'; menuIdx = 0;
    menuItems = [
      { label: '▶ スタート', sub: best ? 'ベスト ' + best + '段' : '', act: startGame },
      { label: 'つかいかた', act: function () { openHowto('title'); } }
    ];
    ctx.clearRect(0, 0, 600, 600);
    show('title'); renderList(); drawLogo();
  }
  function openGame() {
    mode = 'game'; menuItems = [];
    el('hint').textContent = 'タップで落とす　← ↑ ↓ 一時停止';
    show('game'); renderHud();
  }
  function openMenu() {
    mode = 'menu'; menuEl = 'menu-list'; menuIdx = 0;
    el('menu-sub').textContent = 'いま ' + stack.length + '段　／　ベスト ' + Math.max(best, stack.length) + '段';
    menuItems = [
      { label: '← もどる', act: openGame },
      { label: 'やりなおす', act: startGame },
      { label: 'つかいかた', act: function () { openHowto('menu'); } },
      { label: 'タイトルへ', act: openTitle }
    ];
    show('menu'); renderList();
  }
  function openResult() {
    mode = 'result'; menuEl = 'result-list'; menuIdx = 0;
    el('r-num').textContent = stack.length;
    el('r-new').classList.toggle('hidden', !isNewBest);
    el('r-sub').innerHTML = 'PERFECT <b>' + perfects + '</b> 回　最大コンボ <b>' + maxCombo + '</b>　ベスト <b>' + Math.max(best, stack.length) + '</b>段';
    menuItems = [
      { label: '▶ もう一度', act: startGame },
      { label: 'タイトルへ', act: openTitle }
    ];
    show('result'); renderList();
  }
  function openHowto(from) {
    mode = 'howto'; menuEl = 'howto-list'; menuIdx = 0; howtoFrom = from;
    menuItems = [{ label: '← もどる', act: function () { from === 'menu' ? openMenu() : openTitle(); } }];
    show('howto'); renderList();
  }

  // ---------- ループ ----------
  function loop(t) {
    if (!lastT) lastT = t;
    var dt = Math.min(0.05, (t - lastT) / 1000);
    lastT = t;
    if (mode === 'game' || mode === 'result') { update(dt); draw(); }
    requestAnimationFrame(loop);
  }

  // ---------- 入力 ----------
  function move(dir) {
    if (!menuItems.length) return;
    menuIdx = (menuIdx + dir + menuItems.length) % menuItems.length;
    renderList();
  }
  document.addEventListener('keydown', function (e) {
    var k = e.key;
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Enter', ' ', 'Escape'].indexOf(k) < 0) return;
    e.preventDefault();
    if (k === ' ') k = 'Enter';
    if (mode === 'game') {
      if (state !== 'play') { if (k === 'Escape') openTitle(); return; }
      if (k === 'Enter') { if (!e.repeat && !AUTO) drop(); }
      else if (k === 'ArrowLeft' || k === 'ArrowUp' || k === 'ArrowDown' || k === 'Escape') { if (!AUTO) openMenu(); }
      return;
    }
    // リスト画面（title / menu / howto / result）
    if (k === 'ArrowUp' || k === 'ArrowLeft') move(-1);
    else if (k === 'ArrowDown' || k === 'ArrowRight') move(1);
    else if (k === 'Enter') { if (!e.repeat) menuItems[menuIdx].act(); }
    else if (k === 'Escape') {
      if (mode === 'menu') openGame();
      else if (mode === 'howto') (howtoFrom === 'menu' ? openMenu : openTitle)();
      else if (mode === 'result') openTitle();
    }
  });
  // PC 確認用: キャンバスのクリックで落とす
  cv.addEventListener('click', function () { if (mode === 'game' && state === 'play' && !AUTO) drop(); });

  // ---------- 起動 ----------
  load();
  openTitle();
  requestAnimationFrame(loop);
})();
