/* Ferro Index — motore del quiz. Legge la configurazione di lingua da window.FERRO
   (domande, stringhe, verdetti). Nessuna richiesta di rete, nessun dato salvato:
   punteggio, nome dell'hotel e motivazione viaggiano solo nel link. */

(function () {
  'use strict';

  var F = window.FERRO;
  if (!F) return;

  var app = document.getElementById('app');
  var hero = document.getElementById('hero');
  var progress = document.getElementById('progress');
  var announcer = document.getElementById('announce');
  var startBtns = document.querySelectorAll('[data-start]');

  var state = { i: -1, answers: {}, meta: { h: '', n: '' } };
  var renderedAt = 0;

  function setURL(u) {
    try { if (history.replaceState) history.replaceState(null, '', u); } catch (e) {}
  }
  function pushURL(st) {
    try { if (history.pushState) history.pushState(st, ''); } catch (e) {}
  }
  function announce(text) {
    if (announcer) announcer.textContent = text;
  }
  function focusTitle(scope) {
    var h = scope.querySelector('.q-text') || scope.querySelector('.res-num');
    if (h) {
      h.setAttribute('tabindex', '-1');
      try { h.focus({ preventScroll: true }); } catch (e) {}
    }
  }

  /* ---------- punteggio ---------- */

  function pillarTotals(answers) {
    var per = {};
    F.pillars.forEach(function (p) { per[p.key] = { earned: 0, max: 0 }; });

    F.questions.forEach(function (q) {
      if (!q.pillar) return;
      var a = answers[q.id];
      if (q.type === 'yn') {
        per[q.pillar].max += q.w;
        if (a === 1) per[q.pillar].earned += q.w;
      } else if (q.type === 'yn3') {
        if (a === 2) return; /* non applicabile: il peso esce dal pilastro */
        per[q.pillar].max += q.w;
        if (a === 1) per[q.pillar].earned += q.w;
      } else if (q.type === 'scale') {
        per[q.pillar].max += q.w;
        if (a >= 1) per[q.pillar].earned += q.w * (Math.min(a, 5) - 1) / 4;
      }
    });

    /* riscala ogni pilastro al suo peso nominale (gestisce il caso N/A) */
    F.pillars.forEach(function (p) {
      var t = per[p.key];
      t.scaled = t.max > 0 ? (t.earned / t.max) * p.w : 0;
      t.pct = t.max > 0 ? t.earned / t.max : 0;
    });
    return per;
  }

  function computeResult(answers) {
    var per = pillarTotals(answers);

    /* il totale si rinormalizza sui soli pilastri messi alla prova:
       un ristorante mai provato non deve togliere punti all'hotel */
    var raw = 0, avail = 0;
    F.pillars.forEach(function (p) {
      var t = per[p.key];
      if (t.max > 0) { raw += t.scaled; avail += p.w; }
    });
    var base = avail > 0 ? (raw / avail) * 100 : 0;

    var flags = answers.flags || [];
    var score = Math.max(0, Math.round(base) - flags.length * 4);

    var cap = 100;
    var capReasons = [];
    if (per.attenzioni.max > 0 && per.attenzioni.pct < 0.5) { cap = Math.min(cap, 64); capReasons.push('attenzioni'); }
    if (per.pulizia.max > 0 && per.pulizia.pct < 0.5) { cap = Math.min(cap, 64); capReasons.push('pulizia'); }
    if (flags.length > 0) { cap = Math.min(cap, 84); }
    score = Math.min(score, cap);

    var band = F.bands.filter(function (b) { return score >= b.min; })[0];
    return { score: score, per: per, flags: flags, band: band, capReasons: capReasons, emotion: answers.emo || 0 };
  }

  /* ---------- codifica risultato nel link ---------- */

  function encode(answers) {
    var s = '1';
    F.questions.forEach(function (q) {
      if (q.type === 'flags') {
        var mask = 0;
        (answers.flags || []).forEach(function (fi) { mask |= (1 << fi); });
        s += mask.toString(16);
      } else {
        var a = answers[q.id];
        s += (a === undefined ? '0' : String(a));
      }
    });
    return s;
  }

  function decode(r) {
    if (!r || r.charAt(0) !== '1' || r.length !== F.questions.length + 1) return null;
    var answers = {};
    for (var k = 0; k < F.questions.length; k++) {
      var q = F.questions[k];
      var c = r.charAt(k + 1);
      if (q.type === 'flags') {
        var mask = parseInt(c, 16);
        if (isNaN(mask)) return null;
        var arr = [];
        for (var b = 0; b < 4; b++) if (mask & (1 << b)) arr.push(b);
        answers.flags = arr;
      } else {
        var v = parseInt(c, 10);
        if (isNaN(v)) return null;
        if (q.type === 'yn' && v > 1) return null;
        if (q.type === 'yn3' && v > 2) return null;
        if (q.type === 'scale' && v > 5) return null;
        answers[q.id] = v;
      }
    }
    return answers;
  }

  function shareQuery(rcode) {
    var q = '?r=' + rcode;
    if (state.meta.h) q += '&h=' + encodeURIComponent(state.meta.h);
    if (state.meta.n) q += '&n=' + encodeURIComponent(state.meta.n);
    return q;
  }

  /* ---------- render ---------- */

  function el(tag, cls, html) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (html !== undefined) n.innerHTML = html;
    return n;
  }

  function setProgress(i) {
    var pct = i < 0 ? 0 : Math.round(((i + 1) / F.questions.length) * 100);
    progress.style.width = pct + '%';
  }

  function showQuestion(i, fromPop) {
    state.i = i;
    setProgress(i);
    document.body.classList.add('in-quiz');
    if (!fromPop) pushURL({ q: i });
    var q = F.questions[i];
    app.innerHTML = '';
    renderedAt = Date.now();
    var screenDone = false;

    var s = el('div', 'screen');
    s.appendChild(el('p', 'occhiello', q.section));
    s.appendChild(el('p', 'q-count', (i + 1) + ' / ' + F.questions.length));
    s.appendChild(el('h2', 'q-text', q.text));
    if (q.note) s.appendChild(el('p', 'q-note', q.note));

    var box = el('div', 'answers');
    box.setAttribute('role', 'group');

    if (q.type === 'flags') {
      var chosen = (state.answers.flags || []).slice();
      var flagBtns = [];
      function commitFlags() {
        state.answers.flags = chosen.slice().sort();
      }
      q.options.forEach(function (opt, idx) {
        var b = el('button', 'answer', opt + '<span class="k">' + (idx + 1) + '</span>');
        b.type = 'button';
        var on = chosen.indexOf(idx) > -1;
        if (on) b.classList.add('selected');
        b.setAttribute('aria-pressed', on ? 'true' : 'false');
        b.addEventListener('click', function () {
          if (Date.now() - renderedAt < 300) return;
          var p = chosen.indexOf(idx);
          if (p > -1) { chosen.splice(p, 1); b.classList.remove('selected'); b.setAttribute('aria-pressed', 'false'); }
          else { chosen.push(idx); b.classList.add('selected'); b.setAttribute('aria-pressed', 'true'); }
          commitFlags();
        });
        flagBtns.push(b);
        box.appendChild(b);
      });
      var none = el('button', 'answer', q.none);
      none.type = 'button';
      none.addEventListener('click', function () {
        if (Date.now() - renderedAt < 300) return;
        if (chosen.length > 0) {
          /* con selezioni attive il bottone le azzera soltanto, senza avanzare:
             cliccarlo per sbaglio non deve gonfiare il punteggio in silenzio */
          chosen.length = 0;
          flagBtns.forEach(function (fb) { fb.classList.remove('selected'); fb.setAttribute('aria-pressed', 'false'); });
          commitFlags();
          return;
        }
        if (screenDone) return;
        screenDone = true;
        state.answers.flags = [];
        advance();
      });
      box.appendChild(none);
      s.appendChild(box);

      var go = el('button', 'btn', F.ui.continua);
      go.type = 'button';
      go.style.marginTop = '26px';
      go.setAttribute('data-flags-continue', '');
      go.addEventListener('click', function () {
        if (screenDone) return;
        screenDone = true;
        commitFlags();
        advance();
      });
      s.appendChild(go);
    } else {
      q.options.forEach(function (opt, idx) {
        var val = q.type === 'scale' ? idx + 1 : opt.v;
        var label = q.type === 'scale' ? opt : opt.t;
        var b = el('button', 'answer', label + '<span class="k">' + (idx + 1) + '</span>');
        b.type = 'button';
        if (state.answers[q.id] === val) b.classList.add('selected');
        b.addEventListener('click', function () {
          if (Date.now() - renderedAt < 300) return;
          if (screenDone) return;
          screenDone = true;
          state.answers[q.id] = val;
          b.classList.add('selected');
          setTimeout(advance, 150);
        });
        box.appendChild(b);
      });
      s.appendChild(box);
    }

    var nav = el('div', 'q-nav');
    var back = el('button', 'q-back', i === 0 ? F.ui.annulla : F.ui.indietro);
    back.type = 'button';
    back.addEventListener('click', function () {
      if (i === 0) { reset(); } else { showQuestion(i - 1, true); }
    });
    nav.appendChild(back);
    s.appendChild(nav);

    app.appendChild(s);
    announce(F.ui.domandaDi(i + 1, F.questions.length));
    focusTitle(s);
    app.scrollIntoView({ block: 'start' });
  }

  function advance() {
    if (state.i + 1 < F.questions.length) {
      showQuestion(state.i + 1);
    } else {
      finish();
    }
  }

  function reset() {
    state = { i: -1, answers: {}, meta: { h: '', n: '' } };
    setProgress(-1);
    app.innerHTML = '';
    document.body.classList.remove('in-quiz');
    hero.classList.remove('hidden');
    setURL(location.pathname);
    window.scrollTo({ top: 0 });
  }

  function startOwn() {
    state = { i: -1, answers: {}, meta: { h: '', n: '' } };
    hero.classList.add('hidden');
    setURL(location.pathname);
    if (gateOK()) { showQuestion(0); } else { showGate(); }
  }

  function finish() {
    var r = encode(state.answers);
    renderResult(computeResult(state.answers), r, false);
    setURL(location.pathname + shareQuery(r));
  }

  /* ---------- radar ---------- */

  function radarSVG(per) {
    var n = F.pillars.length;
    var cx = 190, cy = 175, R = 108;
    var pt = function (idx, radius) {
      var ang = -Math.PI / 2 + (idx * 2 * Math.PI) / n;
      return [(cx + radius * Math.cos(ang)).toFixed(1), (cy + radius * Math.sin(ang)).toFixed(1)];
    };
    var ring = function (radius, cls) {
      var d = '';
      for (var k = 0; k < n; k++) { var p = pt(k, radius); d += (k ? 'L' : 'M') + p[0] + ' ' + p[1]; }
      return '<path d="' + d + 'Z" fill="none" stroke="currentColor" stroke-opacity="' + (cls || 0.18) + '" stroke-width="1"/>';
    };
    var svg = '<svg viewBox="0 0 380 350" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" style="color:var(--ink)">';
    svg += ring(R * 0.33) + ring(R * 0.66) + ring(R);
    for (var k = 0; k < n; k++) {
      var o = pt(k, R);
      svg += '<line x1="' + cx + '" y1="' + cy + '" x2="' + o[0] + '" y2="' + o[1] + '" stroke="currentColor" stroke-opacity="0.12" stroke-width="1"/>';
    }
    var d = '';
    F.pillars.forEach(function (p, idx) {
      var v = per[p.key].pct;
      var q = pt(idx, Math.max(4, R * v));
      d += (idx ? 'L' : 'M') + q[0] + ' ' + q[1];
    });
    svg += '<path d="' + d + 'Z" fill="var(--brass)" fill-opacity="0.22" stroke="var(--brass)" stroke-width="1.5"/>';
    F.pillars.forEach(function (p, idx) {
      var lp = pt(idx, R + 26);
      var anchor = 'middle';
      if (lp[0] - cx > 30) anchor = 'start';
      if (cx - lp[0] > 30) anchor = 'end';
      svg += '<text x="' + lp[0] + '" y="' + lp[1] + '" text-anchor="' + anchor + '" font-family="' +
        '-apple-system, system-ui, sans-serif" font-size="13" letter-spacing="0.5" fill="currentColor" fill-opacity="0.68">' +
        p.short.toUpperCase() + '</text>';
    });
    svg += '</svg>';
    return svg;
  }

  /* ---------- pagina risultato ---------- */

  function renderResult(res, rcode, isShared) {
    hero.classList.add('hidden');
    document.body.classList.remove('in-quiz');
    progress.style.width = '100%';
    app.innerHTML = '';

    var s = el('div', 'screen');

    var head = el('div', 'res-head');
    head.appendChild(el('p', 'occhiello', F.ui.esito));

    var hotelP = el('p', 'res-hotel');
    hotelP.textContent = state.meta.h;
    if (!state.meta.h) hotelP.classList.add('hidden');
    head.appendChild(hotelP);

    head.appendChild(el('div', 'res-num', res.score + '<span class="su">/100</span>'));
    head.appendChild(el('p', 'res-band', res.band.label));
    head.appendChild(el('p', 'res-verdict', res.band.verdict));
    head.appendChild(el('p', 'res-sub', res.band.sub));

    var emoLine = emotionLine(res);
    if (emoLine) head.appendChild(el('p', 'res-sub', '<em>' + emoLine + '</em>'));

    var noteBox = el('div', 'res-note');
    var noteQ = el('p', 'res-note-text');
    noteQ.textContent = state.meta.n;
    noteBox.appendChild(noteQ);
    noteBox.appendChild(el('p', 'micro', F.ui.notaLabel));
    if (!state.meta.n) noteBox.classList.add('hidden');
    head.appendChild(noteBox);

    if (res.capReasons.length) {
      head.appendChild(el('p', 'res-cap', F.ui.capNote(res.capReasons)));
    }

    /* l'azione principale a portata di verdetto, senza scrollare */
    var pub;
    if (isShared) {
      var own = el('button', 'btn', F.ui.faiTuo);
      own.type = 'button';
      own.style.marginTop = '26px';
      own.addEventListener('click', startOwn);
      head.appendChild(own);
    } else {
      var quick = el('button', 'btn-quiet', F.ui.condividi);
      quick.type = 'button';
      quick.style.marginTop = '24px';
      quick.addEventListener('click', function () {
        if (pub) { pub.scrollIntoView({ block: 'center' }); }
      });
      head.appendChild(quick);
    }
    s.appendChild(head);

    var rb = el('div', 'radar-box');
    rb.innerHTML = radarSVG(res.per);
    s.appendChild(rb);

    var ps = el('div', 'pillars');
    F.pillars.forEach(function (p) {
      var t = res.per[p.key];
      var na = t.max === 0;
      var pct = Math.round(t.pct * 100);
      var d = el('div', 'pillar');
      d.innerHTML =
        '<div class="p-row"><span class="p-name">' + p.name + '</span>' +
        '<span class="p-val">' + (na ? F.ui.na : Math.round(t.scaled) + ' / ' + p.w) + '</span></div>' +
        '<div class="p-bar"><div class="p-fill" style="width:' + Math.min(pct, 100) + '%"></div></div>' +
        '<p class="p-note">' + (na ? F.ui.naNote : (t.pct >= 0.75 ? p.high : t.pct >= 0.4 ? p.mid : p.low)) + '</p>';
      ps.appendChild(d);
    });
    s.appendChild(ps);

    if (res.flags.length) {
      var fl = el('div', 'res-flags');
      fl.appendChild(el('p', 'occhiello', F.ui.flagsTitle));
      var ul = el('ul');
      res.flags.forEach(function (fi) { ul.appendChild(el('li', null, F.flagEcho[fi])); });
      fl.appendChild(ul);
      s.appendChild(fl);
    }

    function currentURL() { return F.baseURL + '/' + shareQuery(rcode); }
    function currentText() { return F.ui.shareText(res.score, res.band.label, state.meta.h); }

    if (!isShared) {
      /* nome e motivazione: entrano nel link, li pubblica chi condivide */
      pub = el('div', 'pub-block');
      pub.appendChild(el('p', 'occhiello', F.ui.pubOcchiello));
      pub.appendChild(el('h3', 'pub-title', F.ui.pubTitolo));
      pub.appendChild(el('p', 'pub-testo', F.ui.pubTesto));

      var inName = document.createElement('input');
      inName.type = 'text';
      inName.className = 'pub-input';
      inName.maxLength = 60;
      inName.placeholder = F.ui.pubNome;
      inName.value = state.meta.h;

      var inNote = document.createElement('textarea');
      inNote.className = 'pub-input';
      inNote.maxLength = 280;
      inNote.rows = 3;
      inNote.placeholder = F.ui.pubNota;
      inNote.value = state.meta.n;

      var urlTimer;
      function syncMeta() {
        state.meta.h = inName.value.trim();
        state.meta.n = inNote.value.trim();
        hotelP.textContent = state.meta.h;
        hotelP.classList.toggle('hidden', !state.meta.h);
        noteQ.textContent = state.meta.n;
        noteBox.classList.toggle('hidden', !state.meta.n);
        clearTimeout(urlTimer);
        urlTimer = setTimeout(function () {
          setURL(location.pathname + shareQuery(rcode));
        }, 400);
      }
      inName.addEventListener('input', syncMeta);
      inNote.addEventListener('input', syncMeta);
      pub.appendChild(inName);
      pub.appendChild(inNote);
      s.appendChild(pub);

      /* Registro dei Santuari: si candida solo la fascia più alta */
      if (res.score >= 85) {
        var reg = el('div', 'reg-block');
        reg.appendChild(el('p', 'occhiello', F.ui.reg.occhiello));
        reg.appendChild(el('h3', 'pub-title', F.ui.reg.titolo));
        reg.appendChild(el('p', 'pub-testo', F.ui.reg.testo));

        var form = document.createElement('form');
        form.action = 'https://formsubmit.co/vimanaholidays@gmail.com';
        form.method = 'POST';

        function hiddenField(name, value) {
          var h = document.createElement('input');
          h.type = 'hidden'; h.name = name; h.value = value;
          form.appendChild(h);
          return h;
        }
        hiddenField('_subject', 'Candidatura Registro dei Santuari - Ferro Index');
        hiddenField('_captcha', 'false');
        hiddenField('_next', F.registroURL + '?grazie=1');
        var hLink = hiddenField('link', '');
        hiddenField('lingua', document.documentElement.lang);

        var rHotel = document.createElement('input');
        rHotel.type = 'text'; rHotel.name = 'hotel'; rHotel.required = true;
        rHotel.className = 'pub-input'; rHotel.maxLength = 60;
        rHotel.placeholder = F.ui.reg.hotel;
        rHotel.value = state.meta.h;

        var rMail = document.createElement('input');
        rMail.type = 'email'; rMail.name = 'email'; rMail.required = true;
        rMail.className = 'pub-input';
        rMail.placeholder = F.ui.reg.email;

        var rWhy = document.createElement('textarea');
        rWhy.name = 'motivazione'; rWhy.required = true;
        rWhy.className = 'pub-input'; rWhy.maxLength = 600; rWhy.rows = 3;
        rWhy.placeholder = F.ui.reg.motivazione;
        rWhy.value = state.meta.n;

        var rSend = el('button', 'btn', F.ui.reg.invia);
        rSend.type = 'submit';
        rSend.style.marginTop = '14px';

        form.addEventListener('submit', function () {
          if (!state.meta.h && rHotel.value.trim()) {
            state.meta.h = rHotel.value.trim();
          }
          hLink.value = currentURL();
        });

        form.appendChild(rHotel);
        form.appendChild(rMail);
        form.appendChild(rWhy);
        form.appendChild(rSend);
        reg.appendChild(form);
        reg.appendChild(el('p', 'micro', F.ui.reg.nota));
        s.appendChild(reg);
      } else {
        s.appendChild(el('p', 'reg-hint micro', F.ui.reg.solo));
      }
    }

    var act = el('div', 'res-actions');
    var shareBtn = el('button', 'btn', F.ui.condividi);
    shareBtn.type = 'button';
    shareBtn.addEventListener('click', function () {
      if (navigator.share) {
        navigator.share({ title: 'Ferro Index', text: currentText(), url: currentURL() }).catch(function () {});
      } else {
        copyLink();
      }
    });
    act.appendChild(shareBtn);

    var copyBtn = el('button', 'btn-quiet', F.ui.copia);
    copyBtn.type = 'button';
    copyBtn.style.justifySelf = 'center';
    function copyLink() {
      var full = currentText() + ' ' + currentURL();
      function done() {
        copyBtn.textContent = F.ui.copiato;
        setTimeout(function () { copyBtn.textContent = F.ui.copia; }, 1800);
      }
      function legacy() {
        var ta = document.createElement('textarea');
        ta.value = full;
        ta.setAttribute('readonly', '');
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        var ok = false;
        try { ok = document.execCommand('copy'); } catch (e) {}
        document.body.removeChild(ta);
        if (ok) { done(); } else { window.prompt(F.ui.copia, full); }
      }
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(full).then(done, legacy);
      } else {
        legacy();
      }
    }
    copyBtn.addEventListener('click', copyLink);
    act.appendChild(copyBtn);

    var redo = el('button', 'btn-quiet', isShared ? F.ui.faiTuo : F.ui.rifai);
    redo.type = 'button';
    redo.style.justifySelf = 'center';
    redo.addEventListener('click', function () {
      if (isShared) { startOwn(); } else { reset(); }
    });
    act.appendChild(redo);
    s.appendChild(act);

    var cta = el('div', 'res-cta');
    cta.appendChild(el('p', 'occhiello', F.ui.ctaOcchiello));
    cta.appendChild(el('p', null, F.ui.ctaTesto));
    var a = el('a', 'btn', F.ui.ctaBottone);
    a.href = 'https://mattiaferro.com';
    a.style.marginTop = '20px';
    cta.appendChild(a);
    cta.appendChild(el('p', 'micro', F.ui.ctaSecondaria));
    cta.style.textAlign = 'left';
    s.appendChild(cta);

    app.appendChild(s);
    announce(F.ui.esito + ': ' + res.score + '/100, ' + res.band.label);
    focusTitle(s);
    app.scrollIntoView({ block: 'start' });
  }

  function emotionLine(res) {
    var e = res.emotion;
    if (!e) return '';
    var factsHigh = res.score >= 65;
    if (factsHigh && e >= 4) return F.ui.emo.concordaAlto;
    if (factsHigh && e <= 2) return F.ui.emo.freddo;
    if (!factsHigh && e >= 4) return F.ui.emo.scenografia;
    if (!factsHigh && e <= 2) return F.ui.emo.concordaBasso;
    return '';
  }

  /* ---------- cancello newsletter ---------- */

  function gateOK() {
    try { return localStorage.getItem('ferroGate') === '1'; } catch (e) { return true; }
  }
  function gatePass() {
    try { localStorage.setItem('ferroGate', '1'); } catch (e) {}
  }

  function showGate() {
    document.body.classList.add('in-quiz');
    app.innerHTML = '';
    var s = el('div', 'screen');
    s.appendChild(el('p', 'occhiello', F.ui.gate.occhiello));
    s.appendChild(el('h2', 'q-text', F.ui.gate.titolo));
    s.appendChild(el('p', 'q-note', F.ui.gate.testo));

    var box = el('div', 'gate-box');
    var ifr = document.createElement('iframe');
    ifr.src = 'https://mattiaferro.com/embed';
    ifr.title = 'Newsletter di Mattia Ferro';
    ifr.loading = 'lazy';
    box.appendChild(ifr);
    s.appendChild(box);

    var go = el('button', 'btn', F.ui.gate.fatto);
    go.type = 'button';
    go.style.marginTop = '22px';
    go.addEventListener('click', function () { gatePass(); showQuestion(0); });
    s.appendChild(go);

    var already = el('button', 'q-back', F.ui.gate.gia);
    already.type = 'button';
    already.style.marginTop = '10px';
    already.addEventListener('click', function () { gatePass(); showQuestion(0); });
    s.appendChild(already);

    s.appendChild(el('p', 'micro', F.ui.gate.micro));
    app.appendChild(s);
    focusTitle(s);
    app.scrollIntoView({ block: 'start' });
  }

  /* ---------- tastiera ---------- */

  document.addEventListener('keydown', function (ev) {
    if (state.i < 0) return;
    var t = ev.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
    var q = F.questions[state.i];
    if (!q) return;
    if (q.type === 'flags' && ev.key === 'Enter') {
      /* Enter su una stonatura focalizzata la seleziona; Continua scatta solo altrove */
      if (t && t.closest && t.closest('.answer')) return;
      var go = app.querySelector('[data-flags-continue]');
      if (go) { ev.preventDefault(); go.click(); }
      return;
    }
    var idx = parseInt(ev.key, 10) - 1;
    var buttons = app.querySelectorAll('.answer');
    if (!isNaN(idx) && idx >= 0 && idx < buttons.length) buttons[idx].click();
  });

  /* il back del telefono torna alla domanda precedente, non fuori dal sito */
  window.addEventListener('popstate', function () {
    if (state.i > 0) { showQuestion(state.i - 1, true); }
    else if (state.i === 0) { reset(); }
  });

  /* ---------- avvio ---------- */

  startBtns.forEach(function (b) {
    b.addEventListener('click', function (ev) {
      ev.preventDefault();
      startOwn();
    });
  });

  var params = new URLSearchParams(location.search);
  var shared = decode(params.get('r'));
  if (shared) {
    state.answers = shared;
    state.meta = {
      h: (params.get('h') || '').slice(0, 60),
      n: (params.get('n') || '').slice(0, 280)
    };
    renderResult(computeResult(shared), params.get('r'), true);
  }
})();
