/* คลังความรู้การงานอาชีพ — student app + teacher editor (no build step, no libraries) */
(function () {
  'use strict';

  // ---------- storage helpers (never throw) ----------
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } },
    del(k) { try { localStorage.removeItem(k); } catch (e) {} },
  };
  const K = { draft: 'kk.draft', student: 'kk.student', progress: 'kk.progress', pending: 'kk.pendingScores', teacher: 'kk.teacherSession' };

  const PUBLISHED = window.APP_CONTENT || { settings: {}, course: {}, units: [] };
  let draft = store.get(K.draft, null);
  // Give every unit/lesson a stable id (progress tracking keys on them)
  function normalize(c) {
    if (!c) return c;
    c.settings = c.settings || {}; c.course = c.course || {}; c.units = c.units || [];
    c.units.forEach((u, i) => {
      u.id = u.id || 'u' + (i + 1);
      (u.lessons || []).forEach((l, j) => { l.id = l.id || u.id + '-l' + (j + 1); });
    });
    return c;
  }
  normalize(PUBLISHED); normalize(draft);
  let C = draft || PUBLISHED; // content currently shown

  const isAndroid = !!window.AndroidBridge;
  const $app = document.getElementById('app');

  // ---------- small utils ----------
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const clone = o => JSON.parse(JSON.stringify(o));
  const uid = p => (p || 'id') + Math.random().toString(36).slice(2, 8);
  const THAI_KEYS = ['ก', 'ข', 'ค', 'ง', 'จ', 'ฉ'];
  // A multiple-choice item may accept several answers (like a Google Form key): answer is a number or an array
  const answerKeys = q => (Array.isArray(q.answer) ? q.answer : [q.answer]).map(Number);
  function hashPin(pin) { // light obfuscation only — the content file is public anyway
    let h = 5381; const s = 'kk-salt:' + pin;
    for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
    return 'h' + h.toString(36);
  }
  function toast(msg, ms) {
    const t = document.getElementById('toast');
    t.textContent = msg; t.hidden = false;
    clearTimeout(toast._t); toast._t = setTimeout(() => { t.hidden = true; }, ms || 2600);
  }
  function shuffle(a) { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
  const unitById = id => (C.units || []).find(u => u.id === id);
  const unitIndex = id => (C.units || []).findIndex(u => u.id === id);

  // Tiny markdown subset: ## heading, - bullet, 1. numbered, **bold**, blank-line paragraphs
  function md(src) {
    const lines = String(src || '').replace(/\r/g, '').split('\n');
    let html = '', list = null, para = [];
    const inline = s => esc(s).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    const flushPara = () => { if (para.length) { html += '<p>' + para.map(inline).join('<br>') + '</p>'; para = []; } };
    const closeList = () => { if (list) { html += '</' + list + '>'; list = null; } };
    for (const raw of lines) {
      const line = raw.trim();
      let m;
      if (!line) { flushPara(); closeList(); continue; }
      if ((m = line.match(/^#{1,4}\s+(.*)$/))) { flushPara(); closeList(); html += '<h3>' + inline(m[1]) + '</h3>'; continue; }
      if ((m = line.match(/^[-*•]\s+(.*)$/))) { flushPara(); if (list !== 'ul') { closeList(); html += '<ul>'; list = 'ul'; } html += '<li>' + inline(m[1]) + '</li>'; continue; }
      if ((m = line.match(/^\d+[.)]\s+(.*)$/))) { flushPara(); if (list !== 'ol') { closeList(); html += '<ol>'; list = 'ol'; } html += '<li>' + inline(m[1]) + '</li>'; continue; }
      closeList(); para.push(line);
    }
    flushPara(); closeList();
    return html;
  }

  function ytId(url) {
    const m = String(url || '').match(/(?:youtu\.be\/|v=|embed\/|shorts\/)([\w-]{11})/);
    return m ? m[1] : null;
  }
  function openExternal(url) {
    if (isAndroid && window.AndroidBridge.openExternal) window.AndroidBridge.openExternal(url);
    else window.open(url, '_blank', 'noopener');
  }
  function openFile(path) {
    if (/^(https?:|data:)/.test(path)) return openExternal(path);
    if (isAndroid && window.AndroidBridge.openAsset) window.AndroidBridge.openAsset(path);
    else window.open(path, '_blank', 'noopener');
  }

  // ---------- progress ----------
  const progress = () => store.get(K.progress, {});
  function setProgress(fn) { const p = progress(); fn(p); store.set(K.progress, p); }
  function unitProgress(u) {
    const p = progress()[u.id] || {};
    const read = (u.lessons || []).filter(l => (p.read || {})[l.id]).length;
    return { read, total: (u.lessons || []).length, best: p.best };
  }

  // ---------- header ----------
  function applySettings() {
    const s = C.settings || {};
    document.getElementById('brandName').textContent = s.appName || 'คลังความรู้';
    document.getElementById('brandSub').textContent = s.subtitle || '';
    document.title = s.appName || 'คลังความรู้';
    document.getElementById('draftBanner').hidden = !draft;
  }

  // Hidden teacher entry: long-press the logo (or tap it 5 times quickly)
  (function teacherGesture() {
    const brand = document.getElementById('brand');
    let timer = null, taps = 0, tapTimer = null, longFired = false;
    const start = () => { longFired = false; timer = setTimeout(() => { longFired = true; askPin(); }, 900); };
    const cancel = () => clearTimeout(timer);
    brand.addEventListener('pointerdown', start);
    ['pointerup', 'pointerleave', 'pointercancel'].forEach(e => brand.addEventListener(e, cancel));
    brand.addEventListener('contextmenu', e => e.preventDefault());
    brand.addEventListener('click', e => {
      if (longFired) { e.preventDefault(); return; }
      taps++; clearTimeout(tapTimer); tapTimer = setTimeout(() => { taps = 0; }, 1500);
      if (taps >= 5) { e.preventDefault(); taps = 0; askPin(); }
    });
  })();

  const DEFAULT_PIN = '1234';
  const pinHashOf = c => ((c && c.settings) || {}).pinHash || hashPin(DEFAULT_PIN);
  function teacherUnlocked() { return store.get(K.teacher, 0) > Date.now(); }
  function askPin() {
    if (teacherUnlocked()) { location.hash = '#/teacher'; return; }
    modal(`
      <h2>เข้าสู่หน้าครู</h2>
      <label class="field"><span>รหัส PIN</span><input id="pinInput" type="password" inputmode="numeric" autocomplete="off"></label>
      <div class="row"><button class="btn" data-close>ยกเลิก</button><span class="spacer"></span><button class="btn primary" id="pinOk">เข้าสู่ระบบ</button></div>
    `, root => {
      const inp = root.querySelector('#pinInput'); inp.focus();
      const go = () => {
        const h = hashPin(inp.value);
        if (h === pinHashOf(C) || h === pinHashOf(PUBLISHED)) {
          store.set(K.teacher, Date.now() + 1000 * 60 * 60 * 8);
          closeModal(); location.hash = '#/teacher';
        } else { toast('PIN ไม่ถูกต้อง'); inp.select(); }
      };
      root.querySelector('#pinOk').onclick = go;
      inp.onkeydown = e => { if (e.key === 'Enter') go(); };
    });
  }

  // ---------- modal ----------
  function modal(html, onMount) {
    const m = document.getElementById('modal');
    m.innerHTML = '<div class="card" role="dialog" aria-modal="true">' + html + '</div>';
    m.hidden = false;
    m.onclick = e => { if (e.target === m || e.target.closest('[data-close]')) closeModal(); };
    if (onMount) onMount(m);
  }
  function closeModal() { const m = document.getElementById('modal'); m.hidden = true; m.innerHTML = ''; }
  // In-app confirm: browsers can silently suppress window.confirm ("prevent additional dialogs")
  function askConfirm(msg, okLabel) {
    return new Promise(resolve => {
      modal(`<p style="font-weight:600">${esc(msg)}</p>
        <div class="row"><button class="btn" id="cf-no">ยกเลิก</button><span class="spacer"></span><button class="btn primary" id="cf-ok">${esc(okLabel || 'ตกลง')}</button></div>`, root => {
        const done = v => { closeModal(); resolve(v); };
        root.onclick = e => { if (e.target === root) done(false); };
        root.querySelector('#cf-no').onclick = () => done(false);
        root.querySelector('#cf-ok').onclick = () => done(true);
        root.querySelector('#cf-ok').focus();
      });
    });
  }

  // ---------- router ----------
  const routes = [];
  const route = (re, fn) => routes.push([re, fn]);
  function render() {
    applySettings();
    const h = location.hash.replace(/^#/, '') || '/';
    document.getElementById('backBtn').hidden = h === '/';
    for (const [re, fn] of routes) {
      const m = h.match(re);
      if (m) { fn.apply(null, m.slice(1)); window.scrollTo(0, 0); return; }
    }
    location.hash = '#/';
  }
  window.addEventListener('hashchange', render);
  document.getElementById('backBtn').onclick = () => {
    const h = location.hash;
    if (/^#\/quiz\//.test(h)) location.hash = h.replace('/quiz/', '/unit/') + '/exercise';
    else if (/^#\/unit\//.test(h) || h === '#/course' || h === '#/teacher') location.hash = '#/';
    else if (/^#\/teacher\//.test(h)) location.hash = '#/teacher';
    else history.back();
  };
  // Android hardware back button calls this; returns true if handled.
  window.handleBack = function () {
    if (!document.getElementById('modal').hidden) { closeModal(); return true; }
    if ((location.hash || '#/') === '#/') return false;
    document.getElementById('backBtn').click(); return true;
  };

  // ================= HOME =================
  route(/^\/$/, function home() {
    const s = C.settings || {};
    const units = C.units || [];
    $app.innerHTML = `
      <section class="hero">
        <h1>สวัสดีนักเรียน 👋</h1>
        <p class="muted">${esc(s.welcome || 'เลือกหน่วยการเรียนรู้เพื่ออ่านทบทวน ดูสไลด์ วิดีโอ และทำแบบฝึกหัดหลังเรียน')}</p>
        ${s.teacher ? `<p class="small muted">ครูผู้สอน: ${esc(s.teacher)}${s.school ? ' · ' + esc(s.school) : ''}</p>` : ''}
      </section>
      ${C.course && (C.course.description || (C.course.slides || []).length) ? `
      <a class="card course-link" href="#/course" style="margin-bottom:16px">
        <span class="u-icon">🧭</span>
        <span><strong>แนะนำรายวิชา / ปฐมนิเทศ</strong><br><span class="small muted">คำอธิบายรายวิชา ตัวชี้วัด และข้อตกลงในชั้นเรียน</span></span>
      </a>` : ''}
      <div class="unit-grid">
        ${units.map((u, i) => {
          const p = unitProgress(u);
          const pct = p.total ? Math.round(p.read / p.total * 100) : 0;
          return `<a class="unit-card" href="#/unit/${esc(u.id)}" style="--unit:${esc(u.color || '#2b4c7e')}">
            <span class="u-icon">${esc(u.icon || '📘')}</span>
            <span class="u-no">หน่วยที่ ${i + 1}</span>
            <h2>${esc(u.title)}</h2>
            <p>${esc(u.description || '')}</p>
            <div class="progress" aria-label="อ่านแล้ว ${pct}%"><span style="width:${pct}%"></span></div>
            <div class="u-meta"><span>อ่านแล้ว ${p.read}/${p.total}</span><span>${p.best ? 'คะแนนดีที่สุด ' + p.best.score + '/' + p.best.total : 'ยังไม่ทำแบบฝึกหัด'}</span></div>
          </a>`;
        }).join('')}
      </div>
      ${units.length ? '' : '<p class="muted">ยังไม่มีหน่วยการเรียนรู้</p>'}
    `;
  });

  // ================= COURSE =================
  route(/^\/course$/, function course() {
    const c = C.course || {};
    $app.innerHTML = `
      <div class="stack">
        <h1>🧭 แนะนำรายวิชา</h1>
        ${c.description ? `<div class="card prose">${md(c.description)}</div>` : ''}
        ${(c.slides || []).length ? `<div class="card"><h2>สไลด์แนะนำวิชา</h2><div id="slideHost"></div></div>` : ''}
      </div>`;
    if ((c.slides || []).length) slideViewer(document.getElementById('slideHost'), c.slides);
  });

  // ================= UNIT =================
  const TABS = [
    ['lessons', '📖 เนื้อหา'], ['slides', '🖼️ สไลด์'], ['videos', '▶️ วิดีโอ'], ['files', '📄 เอกสาร'], ['exercise', '✏️ แบบฝึกหัด'],
  ];
  route(/^\/unit\/([^/]+)(?:\/(\w+))?$/, function unit(id, tab) {
    const u = unitById(id);
    if (!u) { location.hash = '#/'; return; }
    const tabs = TABS.filter(([k]) => k === 'lessons' || k === 'exercise' || (u[k] || []).length);
    tab = tabs.some(t => t[0] === tab) ? tab : 'lessons';
    const i = unitIndex(id);
    $app.style.setProperty('--unit', u.color || '#2b4c7e');
    $app.innerHTML = `
      <div class="unit-head">
        <div class="u-icon">${esc(u.icon || '📘')}</div>
        <div><div class="muted small">หน่วยการเรียนรู้ที่ ${i + 1}</div><h1 style="margin:0">${esc(u.title)}</h1></div>
      </div>
      <nav class="tabs" role="tablist">
        ${tabs.map(([k, label]) => `<a class="tab" role="tab" href="#/unit/${esc(id)}/${k}" aria-selected="${k === tab}">${label}</a>`).join('')}
      </nav>
      <section id="tabBody"></section>`;
    const body = document.getElementById('tabBody');
    ({ lessons: tabLessons, slides: tabSlides, videos: tabVideos, files: tabFiles, exercise: tabExercise })[tab](body, u);
  });

  function tabLessons(el, u) {
    const p = (progress()[u.id] || {}).read || {};
    const lessons = u.lessons || [];
    el.innerHTML = `
      <div class="stack">
        ${(u.objectives || []).length ? `<div class="card objectives"><h3>🎯 จุดประสงค์การเรียนรู้</h3><ul>${u.objectives.map(o => `<li>${esc(o)}</li>`).join('')}</ul></div>` : ''}
        ${lessons.map((l, i) => `
          <article class="card lesson" id="l-${esc(l.id)}">
            <div class="lesson-head"><h2><span class="num">${i + 1}.</span> ${esc(l.title)}</h2></div>
            <div class="prose">${md(l.body)}</div>
            <label class="check"><input type="checkbox" data-lesson="${esc(l.id)}" ${p[l.id] ? 'checked' : ''}> อ่านเรื่องนี้แล้ว</label>
          </article>`).join('')}
        ${lessons.length ? '' : '<p class="muted">ยังไม่มีเนื้อหา</p>'}
        <div class="card row"><span>อ่านครบแล้ว? ลองทำแบบฝึกหัดหลังเรียนดูนะ</span><span class="spacer"></span><a class="btn primary" href="#/unit/${esc(u.id)}/exercise">✏️ ไปทำแบบฝึกหัด</a></div>
      </div>`;
    el.querySelectorAll('input[data-lesson]').forEach(cb => cb.onchange = () => setProgress(pr => {
      pr[u.id] = pr[u.id] || {}; pr[u.id].read = pr[u.id].read || {};
      if (cb.checked) pr[u.id].read[cb.dataset.lesson] = 1; else delete pr[u.id].read[cb.dataset.lesson];
    }));
  }

  function tabSlides(el, u) { el.innerHTML = '<div class="card"><div id="slideHost"></div></div>'; slideViewer(el.querySelector('#slideHost'), u.slides); }

  function slideViewer(host, slides) {
    let i = 0;
    host.innerHTML = `
      <div class="slide-viewer"><img alt="" id="sv-img"></div>
      <div class="slide-nav">
        <button class="btn" id="sv-prev">‹ ก่อนหน้า</button>
        <span class="muted" id="sv-count"></span>
        <button class="btn" id="sv-next">ถัดไป ›</button>
      </div>
      <details style="margin-top:10px"><summary class="small muted" style="cursor:pointer">ดูสไลด์ทั้งหมด</summary>
        <div class="thumbs">${slides.map((s, k) => `<button data-i="${k}" aria-label="สไลด์ ${k + 1}"><img loading="lazy" src="${esc(s)}" alt=""></button>`).join('')}</div>
      </details>`;
    const img = host.querySelector('#sv-img');
    const show = k => {
      i = (k + slides.length) % slides.length;
      img.src = slides[i]; img.alt = 'สไลด์ที่ ' + (i + 1);
      host.querySelector('#sv-count').textContent = (i + 1) + ' / ' + slides.length;
      host.querySelectorAll('.thumbs button').forEach(b => b.setAttribute('aria-current', +b.dataset.i === i));
    };
    host.querySelector('#sv-prev').onclick = () => show(i - 1);
    host.querySelector('#sv-next').onclick = () => show(i + 1);
    host.querySelectorAll('.thumbs button').forEach(b => b.onclick = () => { show(+b.dataset.i); host.querySelector('.slide-viewer').scrollIntoView({ behavior: 'smooth', block: 'center' }); });
    let x0 = null;
    img.addEventListener('touchstart', e => { x0 = e.touches[0].clientX; }, { passive: true });
    img.addEventListener('touchend', e => { if (x0 == null) return; const dx = e.changedTouches[0].clientX - x0; if (Math.abs(dx) > 40) show(i + (dx < 0 ? 1 : -1)); x0 = null; });
    img.onclick = () => openFile(slides[i]);
    show(0);
  }

  function tabVideos(el, u) {
    el.innerHTML = `<div class="media-list">${(u.videos || []).map((v, k) => {
      const id = ytId(v.url);
      return `<div class="card video-card">
        ${id ? `<button class="video-thumb" data-k="${k}" aria-label="เล่นวิดีโอ ${esc(v.title)}"><img loading="lazy" src="https://i.ytimg.com/vi/${id}/hqdefault.jpg" alt=""><span class="play">▶</span></button>`
             : `<button class="video-thumb" data-k="${k}"><span class="play">▶</span></button>`}
        <div class="cap">${esc(v.title)}</div></div>`;
    }).join('')}</div>
    <p class="small muted" style="margin-top:12px">ต้องเชื่อมต่ออินเทอร์เน็ตเพื่อดูวิดีโอ</p>`;
    el.querySelectorAll('.video-thumb').forEach(b => b.onclick = () => {
      const v = u.videos[+b.dataset.k], id = ytId(v.url);
      if (!id || isAndroid || location.protocol === 'file:') return openExternal(v.url);
      const f = document.createElement('iframe');
      f.src = 'https://www.youtube-nocookie.com/embed/' + id + '?autoplay=1&rel=0';
      f.allow = 'autoplay; encrypted-media; picture-in-picture; fullscreen'; f.allowFullscreen = true; f.title = v.title;
      b.replaceWith(f);
    });
  }

  function tabFiles(el, u) {
    el.innerHTML = `<div class="stack">${(u.files || []).map((f, k) => `
      <a class="card file-row" href="${esc(f.path)}" data-k="${k}" target="_blank" rel="noopener">
        <span class="ficon">${/\.(jpe?g|png|webp)$/i.test(f.path) ? '🖼️' : /\.pdf$/i.test(f.path) ? '📕' : '📄'}</span>
        <span><strong>${esc(f.title)}</strong>${f.note ? `<br><span class="small muted">${esc(f.note)}</span>` : ''}</span>
        <span class="spacer"></span><span class="pill">เปิด</span>
      </a>`).join('')}</div>`;
    el.querySelectorAll('.file-row').forEach(a => a.onclick = e => { e.preventDefault(); openFile(u.files[+a.dataset.k].path); });
  }

  function tabExercise(el, u) {
    const ex = u.exercises || [];
    const p = (progress()[u.id] || {});
    const st = store.get(K.student, null);
    const counts = ex.reduce((a, q) => (a[q.type] = (a[q.type] || 0) + 1, a), {});
    const names = { mcq: 'ปรนัย', tf: 'ถูก/ผิด', match: 'จับคู่', short: 'เขียนตอบ' };
    el.innerHTML = `<div class="card stack">
      <h2>✏️ แบบฝึกหัดหลังเรียน</h2>
      <p>${ex.length} ข้อ · ${Object.keys(counts).map(k => names[k] + ' ' + counts[k]).join(' · ')}</p>
      ${p.best ? `<p>คะแนนดีที่สุดของคุณ: <b>${p.best.score}/${p.best.total}</b> <span class="muted small">(ทำไปแล้ว ${p.attempts || 1} ครั้ง)</span></p>` : ''}
      ${st ? `<p class="small muted">ผู้ทำ: ${esc(st.name)} · ${esc(st.room)} เลขที่ ${esc(st.no)} · <a href="#" id="chgStudent">เปลี่ยน</a></p>` : ''}
      <div class="row">${ex.length ? `<a class="btn primary" href="#/quiz/${esc(u.id)}">เริ่มทำแบบฝึกหัด</a>` : '<span class="muted">ยังไม่มีแบบฝึกหัด</span>'}</div>
    </div>`;
    const c = el.querySelector('#chgStudent');
    if (c) c.onclick = e => { e.preventDefault(); studentForm(() => render()); };
  }

  // ---------- student info ----------
  function studentForm(done) {
    const s = store.get(K.student, {}) || {};
    modal(`
      <h2>ข้อมูลนักเรียน</h2>
      <p class="small muted">กรอกครั้งเดียว แอปจะจำไว้ และส่งไปพร้อมคะแนนให้ครู</p>
      <label class="field"><span>ชื่อ-นามสกุล</span><input id="st-name" value="${esc(s.name || '')}" autocomplete="name"></label>
      <div class="grid2">
        <label class="field"><span>ห้อง (เช่น ม.2/3)</span><input id="st-room" value="${esc(s.room || 'ม.2/')}"></label>
        <label class="field"><span>เลขที่</span><input id="st-no" inputmode="numeric" value="${esc(s.no || '')}"></label>
      </div>
      <label class="field"><span>เลขประจำตัวนักเรียน</span><input id="st-id" inputmode="numeric" value="${esc(s.studentId || '')}"></label>
      <div class="row"><button class="btn" data-close>ยกเลิก</button><span class="spacer"></span><button class="btn primary" id="st-ok">บันทึก</button></div>
    `, root => {
      root.querySelector('#st-name').focus();
      root.querySelector('#st-ok').onclick = () => {
        // Thai digits -> Arabic so rooms/numbers sort and group correctly in the score sheet
        const digits = s => s.replace(/[๐-๙]/g, d => String('๐๑๒๓๔๕๖๗๘๙'.indexOf(d)));
        const v = id => digits(root.querySelector(id).value.trim());
        const roomM = v('#st-room').match(/(\d+)\s*\/\s*(\d+)/);
        const st = { name: root.querySelector('#st-name').value.trim().replace(/\s+/g, ' '), room: roomM ? 'ม.' + roomM[1] + '/' + roomM[2] : '',
          no: String(parseInt(v('#st-no'), 10) || ''), studentId: v('#st-id').replace(/\D/g, '') };
        if (!st.name) { toast('กรุณากรอกชื่อ-นามสกุล'); return; }
        if (!st.room) { toast('กรุณากรอกห้องให้ครบ เช่น ม.2/3'); return; }
        if (!st.no) { toast('กรุณากรอกเลขที่เป็นตัวเลข'); return; }
        if (!st.studentId) { toast('กรุณากรอกเลขประจำตัวนักเรียนเป็นตัวเลข'); return; }
        store.set(K.student, st); closeModal(); done && done(st);
      };
    });
  }

  // ================= QUIZ =================
  route(/^\/quiz\/([^/]+)$/, function quiz(id) {
    const u = unitById(id);
    if (!u) { location.hash = '#/'; return; }
    const st = store.get(K.student, null);
    if (!st || !/^ม\.\d+\/\d+$/.test(st.room || '') || !/^\d+$/.test(st.no || '')) { $app.innerHTML = ''; studentForm(() => render()); return; }
    $app.style.setProperty('--unit', u.color || '#2b4c7e');
    const items = (u.exercises || []).map(q => q.type === 'match' ? Object.assign({}, q, { _right: shuffle(q.pairs.map(p => p[1])) }) : q);
    const ans = {};
    $app.innerHTML = `
      <h1>✏️ แบบฝึกหัด: ${esc(u.title)}</h1>
      <p class="muted small">${esc(st.name)} · ${esc(st.room)} เลขที่ ${esc(st.no)}</p>
      <form id="quizForm" class="stack" autocomplete="off">
        ${items.map((q, i) => qHtml(q, i)).join('')}
        <div class="quiz-bar"><span class="muted small" id="answered"></span><span class="spacer"></span><button class="btn primary" type="submit">ส่งคำตอบ</button></div>
      </form>`;
    const form = document.getElementById('quizForm');
    const updateCount = () => {
      const n = items.filter((q, i) => answered(q, ans[i])).length;
      document.getElementById('answered').textContent = `ตอบแล้ว ${n}/${items.length} ข้อ`;
    };
    form.addEventListener('click', e => {
      const b = e.target.closest('[data-q][data-v]');
      if (!b) return;
      const i = +b.dataset.q;
      ans[i] = b.dataset.v;
      form.querySelectorAll(`[data-q="${i}"][data-v]`).forEach(x => x.setAttribute('aria-pressed', x === b));
      updateCount();
    });
    form.addEventListener('input', e => {
      const t = e.target;
      if (t.dataset.short != null) ans[+t.dataset.short] = t.value;
      if (t.dataset.match != null) { const i = +t.dataset.match; ans[i] = ans[i] || {}; ans[i][t.dataset.row] = t.value; }
      updateCount();
    });
    form.onsubmit = async e => {
      e.preventDefault();
      const missing = items.filter((q, i) => !answered(q, ans[i])).length;
      if (missing && !(await askConfirm(`ยังไม่ได้ตอบ ${missing} ข้อ ต้องการส่งเลยหรือไม่?`, 'ส่งเลย'))) return;
      grade(u, items, ans, st);
    };
    updateCount();
  });

  function answered(q, a) {
    if (a == null || a === '') return false;
    if (q.type === 'match') return q.pairs.every((_, r) => a[r]);
    return true;
  }

  function qHtml(q, i) {
    const head = `<div class="q-num">ข้อ ${i + 1}</div><div class="q-text">${esc(q.q)}</div>`;
    let body = '';
    if (q.type === 'mcq') {
      body = `<div class="choices">${q.choices.map((c, k) => `<button type="button" class="choice" data-q="${i}" data-v="${k}" aria-pressed="false"><span class="key">${THAI_KEYS[k]}</span><span>${esc(c)}</span></button>`).join('')}</div>`;
    } else if (q.type === 'tf') {
      body = `<div class="tf"><button type="button" class="choice" data-q="${i}" data-v="true" aria-pressed="false"><span class="key">✓</span><span>ถูก</span></button><button type="button" class="choice" data-q="${i}" data-v="false" aria-pressed="false"><span class="key">✗</span><span>ผิด</span></button></div>`;
    } else if (q.type === 'match') {
      body = q.pairs.map((p, r) => `<div class="match-row"><div>${r + 1}. ${esc(p[0])}</div>
        <select data-match="${i}" data-row="${r}" aria-label="คู่ของ ${esc(p[0])}"><option value="">— เลือกคำตอบ —</option>${q._right.map(x => `<option>${esc(x)}</option>`).join('')}</select></div>`).join('');
    } else if (q.type === 'short') {
      body = `<textarea class="answer" data-short="${i}" placeholder="พิมพ์คำตอบของนักเรียน..."></textarea>`;
    }
    return `<div class="card q-card" id="q-${i}">${head}${body}<div class="fb"></div></div>`;
  }

  function scoreItem(q, a) {
    if (q.type === 'mcq') return +(a != null && answerKeys(q).includes(+a));
    if (q.type === 'tf') return +(a != null && (a === 'true') === !!q.answer);
    if (q.type === 'match') return +(!!a && q.pairs.every((p, r) => a[r] === p[1]));
    if (q.type === 'short') {
      const text = String(a || '').replace(/\s+/g, '');
      const kws = (q.keywords || []).filter(Boolean);
      if (!text) return 0;
      if (!kws.length) return 1;
      const hit = kws.filter(k => text.includes(String(k).replace(/\s+/g, ''))).length;
      return +(hit >= Math.ceil(kws.length / 2));
    }
    return 0;
  }

  function grade(u, items, ans, st) {
    let score = 0;
    const detail = [];
    const form = document.getElementById('quizForm');
    // Teacher setting: by default a wrong answer shows only "wrong", never the key (students share keys with friends)
    const reveal = !!(C.settings || {}).showAnswers;
    items.forEach((q, i) => {
      const s = scoreItem(q, ans[i]); score += s;
      const card = document.getElementById('q-' + i);
      const fb = card.querySelector('.fb');
      card.querySelectorAll('button, select, textarea').forEach(x => { x.disabled = true; });
      if (q.type === 'mcq') {
        card.querySelectorAll('.choice').forEach(b => {
          const v = +b.dataset.v, picked = String(v) === String(ans[i]);
          if (answerKeys(q).includes(v) && (reveal || picked)) b.classList.add('correct'); else if (picked) b.classList.add('wrong');
        });
        detail.push(ans[i] == null ? '-' : THAI_KEYS[+ans[i]]);
      } else if (q.type === 'tf') {
        card.querySelectorAll('.choice').forEach(b => {
          const picked = b.dataset.v === ans[i];
          if ((b.dataset.v === 'true') === !!q.answer && (reveal || picked)) b.classList.add('correct'); else if (picked) b.classList.add('wrong');
        });
        detail.push(ans[i] == null ? '-' : ans[i] === 'true' ? 'ถูก' : 'ผิด');
      } else if (q.type === 'match') {
        if (reveal) card.querySelectorAll('.match-row').forEach((row, r) => row.classList.add((ans[i] || {})[r] === q.pairs[r][1] ? 'correct' : 'wrong'));
        detail.push(q.pairs.filter((p, r) => (ans[i] || {})[r] === p[1]).length + '/' + q.pairs.length);
      } else if (q.type === 'short') {
        detail.push(String(ans[i] || '').slice(0, 500));
      }
      const show = reveal || s; // explanations/sample answers only when correct, or when the teacher enables answers
      let msg = '';
      if (q.type === 'short') {
        msg = `<b>${s ? '✓ คำตอบมีประเด็นสำคัญ' : '✗ คำตอบยังไม่ครบประเด็น'}</b>` +
          (show && q.sample ? `<br>แนวคำตอบ: ${esc(q.sample)}` : '') +
          (show && (q.keywords || []).length ? `<br><span class="small muted">คำสำคัญ: ${q.keywords.map(esc).join(', ')}</span>` : '');
      } else if (q.type === 'match') {
        msg = `<b>${s ? '✓ ถูกต้องทุกคู่' : '✗ ยังไม่ถูกทุกคู่'}</b>` + (reveal ? `<br>เฉลย: ${q.pairs.map(p => esc(p[0]) + ' → ' + esc(p[1])).join(' · ')}` : '');
      } else {
        const right = q.type === 'mcq' ? answerKeys(q).map(k => THAI_KEYS[k] + '. ' + esc(q.choices[k])).join(' หรือ ') : (q.answer ? 'ถูก' : 'ผิด');
        msg = `<b>${s ? '✓ ถูกต้อง' : '✗ ยังไม่ถูก'}</b>` + (!s && reveal ? ' · เฉลย: ' + right : '');
      }
      if (show && q.explain) msg += `<br>${esc(q.explain)}`;
      if (!show) msg += '<br><span class="small">ลองกลับไปทบทวนเนื้อหาแล้วทำใหม่อีกครั้งนะ</span>';
      fb.innerHTML = `<div class="feedback ${q.type === 'short' ? 'info' : s ? 'good' : 'bad'}">${msg}</div>`;
    });
    form.querySelector('.quiz-bar').remove();

    const total = items.length;
    const now = new Date();
    const rec = {
      timestamp: now.toISOString(), name: st.name, room: st.room, no: st.no, studentId: st.studentId,
      unitId: u.id, unit: u.title, score, total, percent: total ? Math.round(score / total * 100) : 0,
      answers: detail.join(' | '), app: isAndroid ? 'android' : 'web',
    };
    setProgress(p => {
      const e = p[u.id] = p[u.id] || {};
      e.attempts = (e.attempts || 0) + 1;
      if (!e.best || score > e.best.score) e.best = { score, total, at: rec.timestamp };
    });

    const res = document.createElement('div');
    res.className = 'card result-card';
    res.innerHTML = `
      <div class="muted">ผลแบบฝึกหัด · ${esc(u.title)}</div>
      <div class="score-big">${score}/${total}</div>
      <div>${rec.percent >= 80 ? '🎉 ยอดเยี่ยม!' : rec.percent >= 50 ? '👍 ดีแล้ว ทบทวนข้อที่ผิดอีกนิดนะ' : '📖 ลองกลับไปอ่านเนื้อหาอีกครั้งแล้วทำใหม่นะ'}</div>
      <dl class="result-meta">
        <dt>ชื่อ</dt><dd>${esc(st.name)}</dd>
        <dt>ห้อง/เลขที่</dt><dd>${esc(st.room)} เลขที่ ${esc(st.no)}</dd>
        <dt>เลขประจำตัว</dt><dd>${esc(st.studentId)}</dd>
        <dt>เวลา</dt><dd>${now.toLocaleString('th-TH')}</dd>
      </dl>
      <div id="sendStatus"></div>
      <div class="row" style="justify-content:center;margin-top:14px">
        <a class="btn" href="#/unit/${esc(u.id)}/lessons">📖 ทบทวนเนื้อหา</a>
        <button class="btn primary" id="retry">ทำใหม่</button>
      </div>
      <p class="small muted" style="margin-top:10px">${(C.settings || {}).showAnswers ? 'เลื่อนลงเพื่อดูเฉลยแต่ละข้อ' : 'เลื่อนลงเพื่อดูว่าข้อไหนถูก ข้อไหนยังไม่ถูก'}</p>`;
    form.prepend(res);
    res.querySelector('#retry').onclick = () => render();
    window.scrollTo({ top: 0, behavior: 'smooth' });
    submitScore(rec, res.querySelector('#sendStatus'));
  }

  // ---------- score submission (Google Sheets via Apps Script) ----------
  function sheetUrl() { return ((C.settings || {}).sheetUrl || '').trim(); }
  function postScore(rec) {
    return fetch(sheetUrl(), { method: 'POST', mode: 'no-cors', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(rec) });
  }
  function submitScore(rec, statusEl) {
    const show = (cls, text) => { if (statusEl) statusEl.innerHTML = `<span class="send-status ${cls}">${text}</span>`; };
    if (!sheetUrl()) { show('wait', 'ครูยังไม่ได้ตั้งค่าการส่งคะแนน — แคปหน้าจอนี้ส่งครูแทน'); return; }
    show('wait', 'กำลังส่งคะแนนให้ครู…');
    postScore(rec).then(() => show('ok', '✓ ส่งคะแนนให้ครูแล้ว'))
      .catch(() => {
        const q = store.get(K.pending, []); q.push(rec); store.set(K.pending, q);
        show('wait', 'ไม่มีอินเทอร์เน็ต — บันทึกไว้แล้ว จะส่งให้อัตโนมัติเมื่อออนไลน์');
      });
  }
  function flushPending() {
    const q = store.get(K.pending, []);
    if (!q.length || !sheetUrl()) return;
    store.set(K.pending, []);
    q.reduce((p, rec) => p.then(() => postScore(rec).catch(() => { const r = store.get(K.pending, []); r.push(rec); store.set(K.pending, r); })), Promise.resolve());
  }
  window.addEventListener('online', flushPending);

  // ================= TEACHER =================
  function requireTeacher() {
    if (teacherUnlocked()) return true;
    $app.innerHTML = '<p class="muted">หน้านี้สำหรับครู</p>'; askPin(); return false;
  }
  function ensureDraft() { if (!draft) { draft = clone(PUBLISHED); } C = draft; }
  function saveDraft(msg) {
    if (!store.set(K.draft, draft)) toast('บันทึกไม่สำเร็จ: พื้นที่เก็บข้อมูลของเบราว์เซอร์เต็ม (ลองลดขนาดรูป)', 5000);
    else if (msg !== false) toast(msg || 'บันทึกฉบับร่างแล้ว');
    applySettings();
    // keep the section counts in the unit editor in sync after add/delete
    const m = location.hash.match(/^#\/teacher\/unit\/([^/]+)$/);
    const u = m && (draft.units || []).find(x => x.id === m[1]);
    if (u) $app.querySelectorAll('[data-count]').forEach(el => { el.textContent = (u[el.dataset.count] || []).length; });
  }

  route(/^\/teacher$/, function teacher() {
    if (!requireTeacher()) return;
    ensureDraft();
    const s = draft.settings = draft.settings || {};
    const defaultPin = pinHashOf(draft) === hashPin(DEFAULT_PIN);
    $app.innerHTML = `
      <div class="stack">
        <div class="row"><h1 style="margin:0">👩‍🏫 หน้าครู</h1><span class="spacer"></span><button class="btn sm" id="logout">ออกจากหน้าครู</button></div>
        <div class="notice">การแก้ไขทั้งหมดถูกเก็บเป็น <b>ฉบับร่างในเครื่องนี้</b> และแสดงผลทันทีในเครื่องนี้เท่านั้น
          เมื่อแก้เสร็จให้กด <b>ดาวน์โหลด content.js</b> แล้วนำไปวางทับไฟล์เดิมในโฟลเดอร์ <code>web</code> ก่อนเผยแพร่ (ดูขั้นตอนในคู่มือครู)</div>
        ${defaultPin ? '<div class="notice">⚠️ ยังใช้ PIN เริ่มต้น <b>1234</b> — กรุณาเปลี่ยนในส่วน "ตั้งค่า" ด้านล่าง</div>' : ''}
        <div class="card stack">
          <h2>📦 เผยแพร่</h2>
          <div class="row">
            <button class="btn primary" id="export">⬇️ ดาวน์โหลด content.js</button>
            <label class="btn">📂 นำเข้าไฟล์ content.js<input type="file" id="import" accept=".js,.json" hidden></label>
            <button class="btn danger" id="discard">ทิ้งฉบับร่าง</button>
          </div>
        </div>

        <div class="card">
          <div class="row"><h2 style="margin:0">📚 หน่วยการเรียนรู้</h2><span class="spacer"></span><button class="btn sm" id="addUnit">+ เพิ่มหน่วย</button></div>
          <div class="t-unit-list" style="margin-top:12px">
            <a class="t-unit-row" href="#/teacher/course" style="color:inherit;text-decoration:none"><span class="u-icon">🧭</span><b>แนะนำรายวิชา / ปฐมนิเทศ</b><span class="spacer"></span><span class="pill">แก้ไข</span></a>
            ${(draft.units || []).map((u, i) => `
              <div class="t-unit-row">
                <span class="u-icon">${esc(u.icon || '📘')}</span>
                <span><b>${i + 1}. ${esc(u.title)}</b><br><span class="small muted">${(u.lessons || []).length} เรื่อง · ${(u.slides || []).length} สไลด์ · ${(u.videos || []).length} วิดีโอ · ${(u.exercises || []).length} ข้อ</span></span>
                <span class="spacer"></span>
                <button class="btn sm" data-up="${i}" aria-label="เลื่อนขึ้น" ${i ? '' : 'disabled'}>↑</button>
                <a class="btn sm primary" href="#/teacher/unit/${esc(u.id)}">แก้ไข</a>
              </div>`).join('')}
          </div>
        </div>

        <div class="card">
          <h2>⚙️ ตั้งค่า</h2>
          <label class="field"><span>ชื่อแอป</span><input id="s-appName" value="${esc(s.appName || '')}"></label>
          <label class="field"><span>ชื่อรอง (แสดงใต้ชื่อแอป)</span><input id="s-subtitle" value="${esc(s.subtitle || '')}"></label>
          <div class="grid2">
            <label class="field"><span>ครูผู้สอน</span><input id="s-teacher" value="${esc(s.teacher || '')}"></label>
            <label class="field"><span>โรงเรียน</span><input id="s-school" value="${esc(s.school || '')}"></label>
          </div>
          <label class="field"><span>ข้อความต้อนรับหน้าแรก</span><input id="s-welcome" value="${esc(s.welcome || '')}"></label>
          <label class="field"><span>ลิงก์ Web App ของ Google Apps Script (สำหรับรับคะแนน)</span><input id="s-sheetUrl" value="${esc(s.sheetUrl || '')}" placeholder="https://script.google.com/macros/s/.../exec"></label>
          <label class="check" style="margin-bottom:12px"><input type="checkbox" id="s-showAnswers" ${s.showAnswers ? 'checked' : ''}> แสดงเฉลยเมื่อนักเรียนตอบผิด <span class="muted small">(ปิดไว้ = บอกแค่ถูก/ผิด ไม่บอกคำตอบที่ถูก)</span></label>
          <div class="row"><button class="btn primary" id="saveSettings">บันทึกการตั้งค่า</button><button class="btn" id="testSheet">ทดสอบส่งคะแนน</button></div>
          <hr style="border:0;border-top:1px solid var(--line);margin:18px 0">
          <div class="grid2">
            <label class="field"><span>PIN ใหม่ (อย่างน้อย 4 ตัว)</span><input id="s-pin" type="password" inputmode="numeric" autocomplete="new-password"></label>
            <label class="field"><span>ยืนยัน PIN ใหม่</span><input id="s-pin2" type="password" inputmode="numeric" autocomplete="new-password"></label>
          </div>
          <button class="btn" id="savePin">เปลี่ยน PIN</button>
        </div>
      </div>`;
    const $ = id => document.getElementById(id);
    $('logout').onclick = () => { store.del(K.teacher); location.hash = '#/'; };
    $('export').onclick = exportContent;
    $('import').onchange = e => importContent(e.target.files[0]);
    $('discard').onclick = async () => {
      if (!(await askConfirm('ทิ้งการแก้ไขทั้งหมดในเครื่องนี้ และกลับไปใช้เนื้อหาฉบับที่เผยแพร่อยู่?', 'ทิ้งฉบับร่าง'))) return;
      store.del(K.draft); draft = null; C = PUBLISHED; toast('ทิ้งฉบับร่างแล้ว'); render();
    };
    $('addUnit').onclick = () => {
      const u = { id: uid('u'), title: 'หน่วยใหม่', icon: '📘', color: '#2b4c7e', description: '', objectives: [], lessons: [], slides: [], videos: [], files: [], exercises: [] };
      draft.units.push(u); saveDraft(); location.hash = '#/teacher/unit/' + u.id;
    };
    $app.querySelectorAll('[data-up]').forEach(b => b.onclick = () => {
      const i = +b.dataset.up; const a = draft.units; [a[i - 1], a[i]] = [a[i], a[i - 1]]; saveDraft(); render();
    });
    $('saveSettings').onclick = () => {
      ['appName', 'subtitle', 'teacher', 'school', 'welcome', 'sheetUrl'].forEach(k => { s[k] = $('s-' + k).value.trim(); });
      s.showAnswers = $('s-showAnswers').checked;
      saveDraft('บันทึกการตั้งค่าแล้ว');
    };
    $('testSheet').onclick = () => {
      s.sheetUrl = $('s-sheetUrl').value.trim();
      if (!s.sheetUrl) { toast('กรุณาใส่ลิงก์ก่อน'); return; }
      postScore({ timestamp: new Date().toISOString(), name: 'ทดสอบระบบ (ครู)', room: '-', no: '-', studentId: '-', unitId: 'test', unit: 'ทดสอบ', score: 0, total: 0, percent: 0, answers: '', app: isAndroid ? 'android' : 'web' })
        .then(() => toast('ส่งแล้ว — ลองเปิด Google Sheets ดูว่ามีแถว "ทดสอบระบบ" หรือไม่', 5000))
        .catch(() => toast('ส่งไม่สำเร็จ ตรวจสอบอินเทอร์เน็ตและลิงก์', 5000));
    };
    $('savePin').onclick = () => {
      const a = $('s-pin').value, b = $('s-pin2').value;
      if (a.length < 4) { toast('PIN ต้องมีอย่างน้อย 4 ตัว'); return; }
      if (a !== b) { toast('PIN ทั้งสองช่องไม่ตรงกัน'); return; }
      s.pinHash = hashPin(a); saveDraft('เปลี่ยน PIN แล้ว (มีผลกับนักเรียนหลังเผยแพร่ไฟล์ใหม่)'); render();
    };
  });

  function exportContent() {
    const data = clone(draft || PUBLISHED);
    data.updatedAt = new Date().toISOString();
    const text = '/* เนื้อหาแอป — สร้างจากหน้าครู ' + new Date().toLocaleString('th-TH') + ' */\nwindow.APP_CONTENT = ' + JSON.stringify(data, null, 1) + ';\n';
    const blob = new Blob([text], { type: 'text/javascript;charset=utf-8' });
    if (isAndroid && window.AndroidBridge.saveText) { window.AndroidBridge.saveText('content.js', text); return; }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = 'content.js';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    toast('ดาวน์โหลด content.js แล้ว — นำไปวางทับไฟล์เดิมในโฟลเดอร์ web', 5000);
  }
  function importContent(file) {
    if (!file) return;
    const r = new FileReader();
    r.onload = () => {
      try {
        const txt = String(r.result);
        const json = txt.slice(txt.indexOf('{'), txt.lastIndexOf('}') + 1);
        const data = JSON.parse(json);
        if (!Array.isArray(data.units)) throw new Error('no units');
        draft = normalize(data); C = draft; saveDraft('นำเข้าแล้ว (เป็นฉบับร่าง)'); render();
      } catch (e) { toast('ไฟล์ไม่ถูกต้อง', 4000); }
    };
    r.readAsText(file, 'utf-8');
  }

  // ---------- teacher: course ----------
  route(/^\/teacher\/course$/, function tCourse() {
    if (!requireTeacher()) return;
    ensureDraft();
    const c = draft.course = draft.course || { description: '', slides: [] };
    $app.innerHTML = `<div class="stack">
      <h1>🧭 แนะนำรายวิชา</h1>
      <div class="card">
        <label class="field"><span>คำอธิบาย / ข้อตกลงในชั้นเรียน (ใช้ ## หัวข้อ, - รายการ, **ตัวหนา**)</span><textarea class="tall" id="c-desc">${esc(c.description || '')}</textarea></label>
        <button class="btn primary" id="c-save">บันทึก</button>
      </div>
      <div class="card"><h2>สไลด์แนะนำวิชา</h2><div id="c-slides"></div></div>
      <a class="btn" href="#/teacher">‹ กลับหน้าครู</a>
    </div>`;
    document.getElementById('c-save').onclick = () => { c.description = document.getElementById('c-desc').value; saveDraft(); };
    slideEditor(document.getElementById('c-slides'), c, 'slides');
  });

  // ---------- teacher: unit editor ----------
  const TYPE_NAMES = { mcq: 'ปรนัย 4 ตัวเลือก', tf: 'ถูก/ผิด', match: 'จับคู่', short: 'เขียนตอบ/เติมคำ' };
  route(/^\/teacher\/unit\/([^/]+)$/, function tUnit(id) {
    if (!requireTeacher()) return;
    ensureDraft();
    const u = draft.units.find(x => x.id === id);
    if (!u) { location.hash = '#/teacher'; return; }
    ['objectives', 'lessons', 'slides', 'videos', 'files', 'exercises'].forEach(k => { u[k] = u[k] || []; });
    $app.style.setProperty('--unit', u.color || '#2b4c7e');
    $app.innerHTML = `<div class="stack">
      <div class="row"><h1 style="margin:0">${esc(u.icon)} แก้ไข: ${esc(u.title)}</h1><span class="spacer"></span><a class="btn sm" href="#/unit/${esc(u.id)}">ดูหน้านักเรียน</a></div>

      <details class="t-item" open><summary>ข้อมูลหน่วย</summary>
        <label class="field"><span>ชื่อหน่วย</span><input id="u-title" value="${esc(u.title)}"></label>
        <div class="grid2">
          <label class="field"><span>ไอคอน (อีโมจิ)</span><input id="u-icon" value="${esc(u.icon || '')}"></label>
          <label class="field"><span>สีประจำหน่วย</span><input id="u-color" type="color" value="${esc(u.color || '#2b4c7e')}" style="height:44px;padding:4px"></label>
        </div>
        <label class="field"><span>คำอธิบายสั้น (แสดงบนการ์ดหน้าแรก)</span><input id="u-desc" value="${esc(u.description || '')}"></label>
        <label class="field"><span>จุดประสงค์การเรียนรู้ (บรรทัดละ 1 ข้อ)</span><textarea id="u-obj">${esc(u.objectives.join('\n'))}</textarea></label>
        <div class="row"><button class="btn primary" id="u-save">บันทึกข้อมูลหน่วย</button><span class="spacer"></span><button class="btn danger" id="u-del">ลบหน่วยนี้</button></div>
      </details>

      <details class="t-item"><summary>📖 เนื้อหา (<span data-count="lessons">${u.lessons.length}</span> เรื่อง)</summary><div id="ed-lessons"></div></details>
      <details class="t-item"><summary>🖼️ สไลด์ (<span data-count="slides">${u.slides.length}</span> ภาพ)</summary><div id="ed-slides"></div></details>
      <details class="t-item"><summary>▶️ วิดีโอ (<span data-count="videos">${u.videos.length}</span>)</summary><div id="ed-videos"></div></details>
      <details class="t-item"><summary>📄 เอกสาร/ใบงาน (<span data-count="files">${u.files.length}</span>)</summary><div id="ed-files"></div></details>
      <details class="t-item"><summary>✏️ แบบฝึกหัด (<span data-count="exercises">${u.exercises.length}</span> ข้อ)</summary><div id="ed-ex"></div></details>
      <a class="btn" href="#/teacher">‹ กลับหน้าครู</a>
    </div>`;
    const $ = s => document.getElementById(s);
    $('u-save').onclick = () => {
      u.title = $('u-title').value.trim() || u.title; u.icon = $('u-icon').value.trim(); u.color = $('u-color').value;
      u.description = $('u-desc').value.trim(); u.objectives = $('u-obj').value.split('\n').map(x => x.trim()).filter(Boolean);
      saveDraft(); render();
    };
    $('u-del').onclick = async () => {
      if (!(await askConfirm(`ลบหน่วย "${u.title}" ทั้งหมด (เนื้อหา สไลด์ แบบฝึกหัด)?`, 'ลบหน่วย'))) return;
      draft.units = draft.units.filter(x => x !== u); saveDraft('ลบหน่วยแล้ว'); location.hash = '#/teacher';
    };
    lessonEditor($('ed-lessons'), u);
    slideEditor($('ed-slides'), u, 'slides');
    linkListEditor($('ed-videos'), u.videos, 'url', 'ลิงก์ YouTube', 'https://www.youtube.com/watch?v=...');
    linkListEditor($('ed-files'), u.files, 'path', 'ที่อยู่ไฟล์ (เช่น files/u1/xxx.pdf) หรือลิงก์ Google Drive', 'files/u1/ชื่อไฟล์.pdf');
    exerciseEditor($('ed-ex'), u);
  });

  function moveItem(arr, i, d) { const j = i + d; if (j < 0 || j >= arr.length) return; [arr[i], arr[j]] = [arr[j], arr[i]]; }
  function toolsHtml(i) {
    return `<div class="t-tools"><button class="btn sm" data-act="up" data-i="${i}">↑</button><button class="btn sm" data-act="down" data-i="${i}">↓</button><span class="spacer"></span><button class="btn sm danger" data-act="del" data-i="${i}">ลบ</button></div>`;
  }
  function wireTools(host, arr, rerender) {
    host.querySelectorAll('[data-act]').forEach(b => b.onclick = async () => {
      const i = +b.dataset.i;
      if (b.dataset.act === 'up') moveItem(arr, i, -1);
      if (b.dataset.act === 'down') moveItem(arr, i, 1);
      if (b.dataset.act === 'del') { if (!(await askConfirm('ลบรายการนี้?', 'ลบ'))) return; arr.splice(i, 1); }
      saveDraft(false); rerender();
    });
  }

  function lessonEditor(host, u) {
    const draw = () => {
      host.innerHTML = `<p class="small muted">รูปแบบข้อความ: <code>## หัวข้อย่อย</code> · <code>- รายการ</code> · <code>1. ลำดับ</code> · <code>**ตัวหนา**</code> · เว้นบรรทัดว่างเพื่อขึ้นย่อหน้าใหม่</p>
        ${u.lessons.map((l, i) => `<details class="t-item"><summary>${i + 1}. ${esc(l.title)}</summary>
          <label class="field"><span>ชื่อเรื่อง</span><input data-f="title" data-i="${i}" value="${esc(l.title)}"></label>
          <label class="field"><span>เนื้อหา</span><textarea class="tall" data-f="body" data-i="${i}">${esc(l.body)}</textarea></label>
          <details><summary class="small">ดูตัวอย่างการแสดงผล</summary><div class="preview-box prose" data-prev="${i}">${md(l.body)}</div></details>
          <div class="row" style="margin-top:8px"><button class="btn primary sm" data-save="${i}">บันทึกเรื่องนี้</button></div>
          ${toolsHtml(i)}</details>`).join('')}
        <button class="btn" id="addLesson">+ เพิ่มเรื่อง</button>`;
      host.querySelectorAll('textarea[data-f="body"]').forEach(t => t.oninput = () => { host.querySelector(`[data-prev="${t.dataset.i}"]`).innerHTML = md(t.value); });
      host.querySelectorAll('[data-save]').forEach(b => b.onclick = () => {
        const i = +b.dataset.save, l = u.lessons[i];
        l.title = host.querySelector(`[data-f="title"][data-i="${i}"]`).value.trim() || l.title;
        l.body = host.querySelector(`[data-f="body"][data-i="${i}"]`).value;
        saveDraft();
      });
      host.querySelector('#addLesson').onclick = () => { u.lessons.push({ id: uid('l'), title: 'เรื่องใหม่', body: '' }); saveDraft(false); draw(); host.querySelector('details.t-item:last-of-type').open = true; };
      wireTools(host, u.lessons, draw);
    };
    draw();
  }

  function slideEditor(host, obj, key) {
    obj[key] = obj[key] || [];
    const arr = obj[key];
    const draw = () => {
      host.innerHTML = `
        <div class="img-list">${arr.map((s, i) => `<figure><img loading="lazy" src="${esc(s)}" alt="สไลด์ ${i + 1}"><figcaption>
          <button data-a="l" data-i="${i}" aria-label="เลื่อนซ้าย">‹</button><span class="small">${i + 1}</span><button data-a="r" data-i="${i}" aria-label="เลื่อนขวา">›</button><button data-a="x" data-i="${i}" aria-label="ลบ">✕</button></figcaption></figure>`).join('')}</div>
        <div class="row" style="margin-top:10px">
          <label class="btn sm">+ เพิ่มรูปจากเครื่อง<input type="file" accept="image/*" multiple hidden id="sl-up"></label>
          <button class="btn sm" id="sl-path">+ เพิ่มจากที่อยู่ไฟล์/ลิงก์</button>
        </div>
        <p class="small muted">รูปที่เพิ่มจากเครื่องจะถูกย่อขนาดและฝังไว้ใน content.js (ไฟล์จะใหญ่ขึ้น ควรเพิ่มทีละไม่มาก) หรือนำไฟล์รูปไปวางในโฟลเดอร์ <code>web/media/...</code> แล้วเพิ่มด้วยที่อยู่ไฟล์</p>`;
      host.querySelectorAll('[data-a]').forEach(b => b.onclick = async () => {
        const i = +b.dataset.i;
        if (b.dataset.a === 'l') moveItem(arr, i, -1);
        if (b.dataset.a === 'r') moveItem(arr, i, 1);
        if (b.dataset.a === 'x') { if (!(await askConfirm('ลบสไลด์นี้?', 'ลบ'))) return; arr.splice(i, 1); }
        saveDraft(false); draw();
      });
      host.querySelector('#sl-path').onclick = () => {
        const p = prompt('ที่อยู่ไฟล์รูป เช่น media/u1/slide45.jpg หรือลิงก์ https://...');
        if (p) { arr.push(p.trim()); saveDraft(); draw(); }
      };
      host.querySelector('#sl-up').onchange = async e => {
        for (const f of e.target.files) arr.push(await shrinkImage(f));
        saveDraft(); draw();
      };
    };
    draw();
  }
  function shrinkImage(file) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const max = 1280, k = Math.min(1, max / Math.max(img.width, img.height));
        const c = document.createElement('canvas'); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(img.src); resolve(c.toDataURL('image/jpeg', 0.78));
      };
      img.onerror = reject;
      img.src = URL.createObjectURL(file);
    });
  }

  function linkListEditor(host, arr, field, label, ph) {
    const draw = () => {
      host.innerHTML = arr.map((v, i) => `<div class="t-item">
          <label class="field"><span>ชื่อ</span><input data-k="title" data-i="${i}" value="${esc(v.title)}"></label>
          <label class="field"><span>${label}</span><input data-k="${field}" data-i="${i}" value="${esc(v[field])}" placeholder="${esc(ph)}"></label>
          ${toolsHtml(i)}</div>`).join('') +
        `<div class="row"><button class="btn sm" id="ll-add">+ เพิ่ม</button><button class="btn sm primary" id="ll-save">บันทึก</button></div>`;
      host.querySelector('#ll-add').onclick = () => { arr.push({ title: '', [field]: '' }); draw(); };
      host.querySelector('#ll-save').onclick = () => {
        host.querySelectorAll('input[data-k]').forEach(inp => { arr[+inp.dataset.i][inp.dataset.k] = inp.value.trim(); });
        for (let i = arr.length - 1; i >= 0; i--) if (!arr[i][field]) arr.splice(i, 1);
        saveDraft(); draw();
      };
      wireTools(host, arr, draw);
    };
    draw();
  }

  function exerciseEditor(host, u) {
    const arr = u.exercises;
    const draw = () => {
      host.innerHTML = arr.map((q, i) => `<details class="t-item" data-qi="${i}"><summary>${i + 1}. [${TYPE_NAMES[q.type]}] ${esc(q.q).slice(0, 70)}</summary>
          ${qEditHtml(q, i)}
          <div class="row" style="margin-top:8px"><button class="btn primary sm" data-qsave="${i}">บันทึกข้อนี้</button></div>
          ${toolsHtml(i)}</details>`).join('') +
        `<div class="row" style="margin-top:8px"><span class="small">เพิ่มข้อใหม่:</span>${Object.keys(TYPE_NAMES).map(t => `<button class="btn sm" data-add="${t}">+ ${TYPE_NAMES[t]}</button>`).join('')}</div>`;
      host.querySelectorAll('[data-add]').forEach(b => b.onclick = () => {
        const t = b.dataset.add;
        const blank = { mcq: { type: 'mcq', q: '', choices: ['', '', '', ''], answer: 0, explain: '' }, tf: { type: 'tf', q: '', answer: true, explain: '' },
          match: { type: 'match', q: 'จับคู่ให้ถูกต้อง', pairs: [['', ''], ['', ''], ['', ''], ['', '']], explain: '' }, short: { type: 'short', q: '', keywords: [], sample: '', explain: '' } }[t];
        arr.push(blank); draw();
        const last = host.querySelector(`[data-qi="${arr.length - 1}"]`); last.open = true; last.scrollIntoView({ block: 'center' });
      });
      host.querySelectorAll('[data-qsave]').forEach(b => b.onclick = () => {
        const i = +b.dataset.qsave, el = host.querySelector(`[data-qi="${i}"]`), q = arr[i];
        const val = n => (el.querySelector(`[name="${n}"]`) || {}).value;
        q.q = val('q').trim(); q.explain = (val('explain') || '').trim();
        if (q.type === 'mcq') {
          q.choices = [0, 1, 2, 3].map(k => val('c' + k).trim());
          const ks = [...el.querySelectorAll('input[data-key]:checked')].map(x => +x.value);
          q.answer = ks.length > 1 ? ks : (ks.length ? ks[0] : 0);
        }
        if (q.type === 'tf') q.answer = (el.querySelector('input[data-tf]:checked') || {}).value !== 'false';
        if (q.type === 'match') q.pairs = [...el.querySelectorAll('.pair')].map(p => [p.children[0].value.trim(), p.children[1].value.trim()]).filter(p => p[0] && p[1]);
        if (q.type === 'short') { q.keywords = val('kw').split(',').map(x => x.trim()).filter(Boolean); q.sample = val('sample').trim(); }
        const bad = !q.q || (q.type === 'mcq' && q.choices.some(c => !c)) || (q.type === 'match' && q.pairs.length < 2);
        saveDraft(bad ? 'บันทึกแล้ว แต่ข้อนี้ยังกรอกไม่ครบ' : 'บันทึกข้อนี้แล้ว'); draw();
      });
      host.querySelectorAll('[data-addpair]').forEach(b => b.onclick = () => {
        const wrap = b.previousElementSibling;
        wrap.insertAdjacentHTML('beforeend', '<div class="pair grid2" style="margin-bottom:6px"><input placeholder="ด้านซ้าย"><input placeholder="คู่ที่ถูกต้อง"></div>');
      });
      wireTools(host, arr, draw);
    };
    draw();
  }
  function qEditHtml(q, i) {
    const r = 'r' + i;
    let h = `<label class="field"><span>คำถาม</span><textarea name="q">${esc(q.q)}</textarea></label>`;
    if (q.type === 'mcq') {
      h += q.choices.map((c, k) => `<div class="row" style="margin-bottom:6px;flex-wrap:nowrap"><label class="check"><input type="checkbox" data-key value="${k}" ${answerKeys(q).includes(k) ? 'checked' : ''}> ${THAI_KEYS[k]}</label><input name="c${k}" value="${esc(c)}" style="flex:1;min-height:40px;border:1px solid var(--line);border-radius:10px;padding:6px 10px;background:var(--surface)"></div>`).join('');
      h += '<p class="small muted">ติ๊กช่องหน้าตัวเลือกที่ถูกต้อง (ติ๊กได้มากกว่า 1 ข้อ ถ้ายอมรับคำตอบได้หลายแบบ)</p>';
    }
    if (q.type === 'tf') h += `<div class="row"><label class="check"><input type="radio" data-tf name="ans-${i}" value="true" ${q.answer ? 'checked' : ''}> ถูก</label><label class="check"><input type="radio" data-tf name="ans-${i}" value="false" ${!q.answer ? 'checked' : ''}> ผิด</label></div>`;
    if (q.type === 'match') h += `<div class="small" style="margin:6px 0">คู่ที่ถูกต้อง (ด้านขวาจะถูกสลับลำดับให้นักเรียนอัตโนมัติ)</div><div>${q.pairs.map(p => `<div class="pair grid2" style="margin-bottom:6px"><input value="${esc(p[0])}" placeholder="ด้านซ้าย"><input value="${esc(p[1])}" placeholder="คู่ที่ถูกต้อง"></div>`).join('')}</div><button class="btn sm" type="button" data-addpair>+ เพิ่มคู่</button>`;
    if (q.type === 'short') h += `<label class="field"><span>คำสำคัญที่ควรมีในคำตอบ (คั่นด้วยจุลภาค ,)</span><input name="kw" value="${esc((q.keywords || []).join(', '))}"></label>
      <label class="field"><span>แนวคำตอบ</span><textarea name="sample">${esc(q.sample || '')}</textarea></label>
      <p class="small muted">แอปให้คะแนนอัตโนมัติเมื่อคำตอบมีคำสำคัญอย่างน้อยครึ่งหนึ่ง และส่งข้อความคำตอบเข้า Google Sheets ให้ครูตรวจซ้ำได้</p>`;
    h += `<label class="field"><span>คำอธิบายเฉลย (ไม่บังคับ)</span><input name="explain" value="${esc(q.explain || '')}"></label>`;
    return h;
  }

  // ---------- boot ----------
  if (!(C.units || []).length && !draft) $app.innerHTML = '<p>ไม่พบไฟล์เนื้อหา content.js</p>';
  render();
  flushPending();
})();
