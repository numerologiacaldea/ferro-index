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

  /* ---------- segni dei pilastri ----------
     Disegni a tratto, uno per pilastro: servono a distinguere i sette blocchi
     mentre si scorre, non a decorare. Stessa gabbia 24x24 e stesso spessore. */

  var SEGNI = {
    attenzioni: '<path d="M12 4.5a3.2 3.2 0 1 1 0 6.4 3.2 3.2 0 0 1 0-6.4Z"/><path d="M5 19.5c0-3.3 3.1-5.6 7-5.6s7 2.3 7 5.6"/><path d="M17.6 6.6c1.4.8 1.4 3 0 3.8"/>',
    comfort:    '<path d="M3.5 17.5v-4.2a2 2 0 0 1 2-2h13a2 2 0 0 1 2 2v4.2"/><path d="M3.5 17.5h17"/><path d="M6.5 11.3V8.6a1.8 1.8 0 0 1 1.8-1.8h7.4a1.8 1.8 0 0 1 1.8 1.8v2.7"/>',
    privacy:    '<path d="M12 3.8c2.6 1.6 4.6 2.2 6.8 2.3.2 5.9-1.9 10-6.8 12.1-4.9-2.1-7-6.2-6.8-12.1 2.2-.1 4.2-.7 6.8-2.3Z"/><path d="M9.6 11.6l1.7 1.7 3.3-3.4"/>',
    cibo:       '<path d="M6.6 4v6.4a2 2 0 0 0 2 2h.2a2 2 0 0 0 2-2V4"/><path d="M8.7 12.4V20"/><path d="M16.6 4c-1.4 1-2.1 2.7-2.1 5s.7 3.2 2.1 3.4V20"/>',
    pulizia:    '<path d="M12 3.6l1.9 1.9-1.9 1.9-1.9-1.9 1.9-1.9Z"/><path d="M8.4 12.5h7.2l1 7.9H7.4l1-7.9Z"/><path d="M12 7.4v5.1"/>',
    design:     '<path d="M4.2 19.8L9 7.2a3.2 3.2 0 0 1 6 0l4.8 12.6"/><path d="M7.6 15.8h8.8"/>',
    arte:       '<rect x="4.2" y="4.6" width="15.6" height="12.4" rx="1.4"/><path d="M6.8 17V4.6M12 20.2v-3.2"/><path d="M8.6 13.4l2.6-3.2 2 2.4 1.6-1.8 2.4 2.6"/>'
  };

  function segno(chiave) {
    var d = SEGNI[chiave];
    if (!d) return '';
    return '<svg class="p-segno" viewBox="0 0 24 24" aria-hidden="true" fill="none" ' +
      'stroke="currentColor" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round">' +
      d + '</svg>';
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
    svg += '<path class="radar-dati" d="' + d + 'Z" fill="var(--brass)" fill-opacity="0.18" ' +
      'stroke="var(--brass)" stroke-width="1.8" stroke-linejoin="round"/>';
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

    var s = el('div', 'screen res-screen');

    var head = el('div', 'res-head');
    head.appendChild(el('p', 'occhiello', F.ui.esito));

    var hotelP = el('p', 'res-hotel');
    hotelP.textContent = state.meta.h;
    if (!state.meta.h) hotelP.classList.add('hidden');
    head.appendChild(hotelP);

    var numero = el('div', 'res-num', '<span class="cifra">0</span><span class="su">/100</span>');
    head.appendChild(numero);
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

    /* grafico e dettaglio viaggiano insieme: su schermo largo diventano
       la colonna di lettura, e restano attaccati senza buchi in mezzo */
    var lettura = el('div', 'res-lettura');

    var rb = el('div', 'radar-box');
    rb.innerHTML = radarSVG(res.per);
    lettura.appendChild(rb);

    var ps = el('div', 'pillars');
    F.pillars.forEach(function (p) {
      var t = res.per[p.key];
      var na = t.max === 0;
      var pct = Math.round(t.pct * 100);
      var d = el('div', 'pillar');
      d.innerHTML =
        '<div class="p-row"><span class="p-name">' + segno(p.key) + p.name + '</span>' +
        '<span class="p-val">' + (na ? F.ui.na : Math.round(t.scaled) + ' / ' + p.w) + '</span></div>' +
        '<div class="p-bar"><div class="p-fill" data-largh="' + Math.min(pct, 100) + '%" style="width:0"></div></div>' +
        '<p class="p-note">' + (na ? F.ui.naNote : (t.pct >= 0.75 ? p.high : t.pct >= 0.4 ? p.mid : p.low)) + '</p>';
      ps.appendChild(d);
    });
    lettura.appendChild(ps);
    s.appendChild(lettura);

    /* tutto ciò che segue è azione, non lettura: sta in un blocco solo, così la
       griglia ha esattamente tre figli e non può generare righe vuote */
    var azioni = el('div', 'res-azioni');

    if (res.flags.length) {
      var fl = el('div', 'res-flags');
      fl.appendChild(el('p', 'occhiello', F.ui.flagsTitle));
      var ul = el('ul');
      res.flags.forEach(function (fi) { ul.appendChild(el('li', null, F.flagEcho[fi])); });
      fl.appendChild(ul);
      azioni.appendChild(fl);
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
      azioni.appendChild(pub);

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
        azioni.appendChild(reg);
      } else {
        azioni.appendChild(el('p', 'reg-hint micro', F.ui.reg.solo));
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

    /* nella vista condivisa l'invito a fare il proprio test sta già in testa,
       accanto al verdetto: ripeterlo qui sarebbe un doppione */
    if (!isShared) {
      var redo = el('button', 'btn-quiet', F.ui.rifai);
      redo.type = 'button';
      redo.style.justifySelf = 'center';
      redo.addEventListener('click', reset);
      act.appendChild(redo);
    }
    azioni.appendChild(act);

    var cta = el('div', 'res-cta');
    cta.appendChild(el('p', 'occhiello', F.ui.ctaOcchiello));
    cta.appendChild(el('p', null, F.ui.ctaTesto));
    var a = el('a', 'btn', F.ui.ctaBottone);
    a.href = 'https://mattiaferro.com';
    a.style.marginTop = '20px';
    cta.appendChild(a);
    cta.appendChild(el('p', 'micro', F.ui.ctaSecondaria));
    cta.style.textAlign = 'left';
    azioni.appendChild(cta);
    s.appendChild(azioni);

    app.appendChild(s);
    announce(F.ui.esito + ': ' + res.score + '/100, ' + res.band.label);
    focusTitle(s);
    app.scrollIntoView({ block: 'start' });
    rivela(s, res, numero, rb);
  }

  /* ---------- la rivelazione del verdetto ----------
     Il punteggio non compare: si forma. Il numero sale, il poligono si disegna,
     le barre si riempiono una dopo l'altra. È il momento per cui si fa il test. */

  /* le animazioni partono solo quando la pagina è davvero sotto gli occhi:
     in secondo piano il browser congela tutto e il verdetto resterebbe a metà */
  function quandoVisibile(fn) {
    if (document.visibilityState === 'visible') { fn(); return; }
    var h = function () {
      if (document.visibilityState !== 'visible') return;
      document.removeEventListener('visibilitychange', h);
      fn();
    };
    document.addEventListener('visibilitychange', h);
  }

  function rivela(scope, res, numero, radarBox) {
    quandoVisibile(function () { rivelaOra(scope, res, numero, radarBox); });
  }

  function rivelaOra(scope, res, numero, radarBox) {
    var pigro = matchMedia('(prefers-reduced-motion: reduce)').matches;
    var cifra = numero.querySelector('.cifra');

    if (pigro) {
      cifra.textContent = res.score;
      scope.querySelectorAll('.p-fill').forEach(function (b) {
        b.style.width = b.dataset.largh; b.style.transition = 'none';
      });
      var pth = radarBox.querySelector('.radar-dati');
      if (pth) { pth.style.strokeDashoffset = '0'; pth.style.fillOpacity = '0.18'; }
      return;
    }

    /* il numero sale con una decelerazione, come un contachilometri che si ferma */
    var durata = 1100 + Math.min(res.score, 100) * 4;
    var avvio = null;
    function conta(t) {
      if (avvio === null) avvio = t;
      var q = Math.min((t - avvio) / durata, 1);
      var eased = 1 - Math.pow(1 - q, 3);
      cifra.textContent = Math.round(res.score * eased);
      if (q < 1) requestAnimationFrame(conta);
      else cifra.textContent = res.score;
    }
    requestAnimationFrame(conta);

    /* se l'animazione non gira, per esempio a scheda in secondo piano, il numero
       non deve restare a zero: dopo il tempo previsto si scrive comunque */
    setTimeout(function () { cifra.textContent = res.score; }, durata + 500);

    /* il poligono si disegna, poi si riempie */
    var path = radarBox.querySelector('.radar-dati');
    if (path && path.getTotalLength) {
      var L = path.getTotalLength();
      path.style.strokeDasharray = L;
      path.style.strokeDashoffset = L;
      path.style.fillOpacity = '0';
      requestAnimationFrame(function () {
        path.style.transition = 'stroke-dashoffset 1.5s cubic-bezier(0.33,1,0.68,1), fill-opacity 0.9s ease 1s';
        path.style.strokeDashoffset = '0';
        path.style.fillOpacity = '0.18';
      });
    }

    /* le barre partono in cascata, nell'ordine dei pilastri */
    scope.querySelectorAll('.p-fill').forEach(function (b, i) {
      setTimeout(function () { b.style.width = b.dataset.largh; }, 700 + i * 110);
    });
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

    /* Il modulo ufficiale di Substack, che mostra la conferma vera dentro di sé.
       Sotto resta il nostro, perché su alcuni telefoni la tastiera non entra nei
       riquadri di altri domini e senza alternativa la persona resterebbe bloccata. */
    var box = el('div', 'gate-box');
    var ifr = document.createElement('iframe');
    ifr.src = 'https://www.mattiaferro.com/embed';
    ifr.title = F.ui.gate.titoloRiquadro;
    ifr.setAttribute('frameborder', '0');
    ifr.setAttribute('scrolling', 'no');
    box.appendChild(ifr);
    s.appendChild(box);

    var oppure = el('p', 'gate-oppure micro', F.ui.gate.oppure);
    s.appendChild(oppure);

    if (!document.getElementById('ferro-sink')) {
      var sink = document.createElement('iframe');
      sink.name = 'ferro-sink';
      sink.id = 'ferro-sink';
      sink.className = 'sink';
      sink.setAttribute('aria-hidden', 'true');
      sink.tabIndex = -1;
      document.body.appendChild(sink);
    }

    var form = document.createElement('form');
    form.className = 'gate-form';
    form.action = 'https://www.mattiaferro.com/api/v1/free';
    form.method = 'POST';
    form.target = 'ferro-sink';

    var mail = document.createElement('input');
    mail.type = 'email';
    mail.name = 'email';
    mail.required = true;
    mail.className = 'pub-input gate-mail';
    mail.placeholder = F.ui.gate.email;
    mail.autocomplete = 'email';
    mail.inputMode = 'email';

    var hid = document.createElement('input');
    hid.type = 'hidden'; hid.name = 'first_url'; hid.value = F.baseURL + '/';
    var hid2 = document.createElement('input');
    hid2.type = 'hidden'; hid2.name = 'source'; hid2.value = 'ferro-index';

    var send = el('button', 'btn', F.ui.gate.iscrivi);
    send.type = 'submit';
    send.style.marginTop = '12px';

    form.appendChild(mail);
    form.appendChild(hid);
    form.appendChild(hid2);
    form.appendChild(send);
    s.appendChild(form);

    var esito = el('p', 'gate-esito micro', F.ui.gate.attesa);
    s.appendChild(esito);

    form.addEventListener('submit', function () {
      gatePass();
      esito.textContent = F.ui.gate.inviato;
      esito.classList.add('confermato');
      send.disabled = true;
      mail.disabled = true;
      send.textContent = F.ui.gate.apro;
      setTimeout(function () { showQuestion(0); }, 1500);
    });

    var already = el('button', 'q-back', F.ui.gate.gia);
    already.type = 'button';
    already.style.marginTop = '16px';
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

  /* ---------- entrata dei blocchi allo scorrimento ---------- */

  function osserva(nodi) {
    /* toglie proprio la classe invece di aggiungere quella di arrivo: se una
       transizione resta congelata, per esempio a scheda in secondo piano,
       l'elemento torna comunque al suo stato naturale e resta leggibile */
    function mostraTutti() {
      nodi.forEach(function (n) { n.classList.remove('reveal'); n.classList.add('visto'); });
    }

    if (!('IntersectionObserver' in window) ||
        matchMedia('(prefers-reduced-motion: reduce)').matches) {
      mostraTutti();
      return;
    }

    var io = new IntersectionObserver(function (voci) {
      voci.forEach(function (v) {
        if (!v.isIntersecting) return;
        var n = v.target;
        var ritardo = parseInt(n.dataset.ritardo || '0', 10);
        setTimeout(function () { n.classList.add('visto'); }, ritardo);
        io.unobserve(n);
      });
    }, { rootMargin: '0px 0px -12% 0px', threshold: 0.08 });

    nodi.forEach(function (n, i) {
      n.classList.add('reveal');
      /* i primi elementi di ogni gruppo entrano a scalare, poi il ritardo si azzera:
         serve il ritmo, non l'attesa */
      n.dataset.ritardo = String(Math.min(i, 3) * 70);

      /* chi è già nel viewport o l'ha superato non deve aspettare l'osservatore:
         succede quando si arriva con un'ancora o si ricarica a metà pagina */
      var r = n.getBoundingClientRect();
      if (r.top < window.innerHeight * 1.05) {
        n.classList.add('visto');
        return;
      }
      io.observe(n);
    });

    /* rete di sicurezza: nessun contenuto può restare invisibile,
       qualunque cosa succeda all'osservatore */
    setTimeout(mostraTutti, 2500);
  }

  /* i titoli non compaiono: salgono parola per parola, come se venissero scritti.
     È l'unico punto in cui vale la pena spendere movimento, perché è dove
     l'occhio si ferma quando smette di scorrere. */
  function preparaTitoli() {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    document.querySelectorAll('section.blocco h2').forEach(function (h) {
      if (h.dataset.pronto) return;
      h.dataset.pronto = '1';
      var parole = h.textContent.split(/\s+/);
      h.textContent = '';
      parole.forEach(function (w, i) {
        var s = document.createElement('span');
        s.className = 'parola';
        s.style.setProperty('--w', i);
        var dentro = document.createElement('span');
        dentro.textContent = w;
        s.appendChild(dentro);
        h.appendChild(s);
        if (i < parole.length - 1) h.appendChild(document.createTextNode(' '));
      });
    });
  }

  function animaSezioni() {
    preparaTitoli();
    var nodi = [];
    document.querySelectorAll('section.blocco').forEach(function (sez) {
      var figli = sez.querySelectorAll(':scope > *');
      if (figli.length) { figli.forEach(function (f) { nodi.push(f); }); }
      else { nodi.push(sez); }
    });
    var piede = document.querySelector('footer .wrap');
    if (piede) nodi.push(piede);
    osserva(nodi);
  }

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

  /* ---------- lo strumento in funzione, nella prima schermata ----------
     Il radar si disegna da solo e i sette vertici si accendono uno alla volta.
     Non è decorazione: è quello che il visitatore otterrà, mostrato invece che
     promesso, e dice in due secondi cosa fa questo sito. */

  function radarVivo() {
    var casa = document.getElementById('radar-vivo');
    if (!casa) return;

    /* tre esiti veri, calcolati con le stesse regole del test: si vede cosa
       restituisce lo strumento prima ancora di cominciarlo */
    var ESEMPI = F.anteprima || [];
    var schedaNum = document.querySelector('.anteprima-num .cifra');
    var schedaFascia = document.querySelector('.anteprima-fascia');
    var schedaNota = document.querySelector('.anteprima-nota');

    var n = F.pillars.length, cx = 130, cy = 130, R = 96;
    var pt = function (i, r) {
      var a = -Math.PI / 2 + (i * 2 * Math.PI) / n;
      return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
    };
    var anello = function (f) {
      var d = '';
      for (var k = 0; k < n; k++) { var p = pt(k, R * f); d += (k ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1); }
      return '<path d="' + d + 'Z" fill="none" stroke="currentColor" stroke-opacity="0.14" stroke-width="1"/>';
    };
    /* un profilo credibile, non perfetto: un albergo forte sulle persone */
    var valori = [0.97, 0.80, 0.92, 0.74, 0.88, 0.55, 0.42];
    var d = '';
    valori.forEach(function (v, i) {
      var q = pt(i, R * v);
      d += (i ? 'L' : 'M') + q[0].toFixed(1) + ' ' + q[1].toFixed(1);
    });
    var raggi = '';
    for (var k = 0; k < n; k++) {
      var o = pt(k, R);
      raggi += '<line x1="' + cx + '" y1="' + cy + '" x2="' + o[0].toFixed(1) + '" y2="' + o[1].toFixed(1) +
        '" stroke="currentColor" stroke-opacity="0.1" stroke-width="1"/>';
    }
    var punti = '';
    valori.forEach(function (v, i) {
      var q = pt(i, R * v);
      punti += '<circle class="v" style="--i:' + i + '" cx="' + q[0].toFixed(1) + '" cy="' + q[1].toFixed(1) +
        '" r="3.4" fill="var(--brass)"/>';
    });

    casa.innerHTML = '<svg viewBox="0 0 260 260" aria-hidden="true">' +
      anello(1) + anello(0.66) + anello(0.33) + raggi +
      '<path class="traccia" d="' + d + 'Z" fill="var(--brass)" fill-opacity="0" ' +
      'stroke="var(--brass)" stroke-width="1.8" stroke-linejoin="round"/>' + punti + '</svg>';

    var tracc = casa.querySelector('.traccia');
    if (!tracc.getTotalLength || matchMedia('(prefers-reduced-motion: reduce)').matches) {
      tracc.style.fillOpacity = '0.16';
      casa.classList.add('acceso');
      return;
    }
    var L = tracc.getTotalLength();
    tracc.style.strokeDasharray = L;
    tracc.style.strokeDashoffset = L;

    function profilo(vals) {
      var s = '';
      vals.forEach(function (v, i) {
        var q = pt(i, R * v);
        s += (i ? 'L' : 'M') + q[0].toFixed(1) + ' ' + q[1].toFixed(1);
      });
      return s + 'Z';
    }

    quandoVisibile(function () {
      setTimeout(function () {
        tracc.style.transition = 'stroke-dashoffset 2.2s cubic-bezier(0.33,1,0.68,1), fill-opacity 1.2s ease 1.4s';
        tracc.style.strokeDashoffset = '0';
        tracc.style.fillOpacity = '0.16';
        casa.classList.add('acceso');

        /* poi la scheda cambia esito: alto, medio, basso. Ogni volta il numero
           risale e il poligono cambia forma, così si capisce che misura davvero */
        if (!ESEMPI.length || !schedaNum || matchMedia('(prefers-reduced-motion: reduce)').matches) return;

        var idx = 0;
        setInterval(function () {
          if (document.visibilityState !== 'visible') return;
          idx = (idx + 1) % ESEMPI.length;
          var e = ESEMPI[idx];

          casa.classList.add('cambio');
          setTimeout(function () {
            tracc.setAttribute('d', profilo(e.valori));
            var punti = casa.querySelectorAll('.v');
            e.valori.forEach(function (v, i) {
              if (!punti[i]) return;
              var q = pt(i, R * v);
              punti[i].setAttribute('cx', q[0].toFixed(1));
              punti[i].setAttribute('cy', q[1].toFixed(1));
            });
            var da = parseInt(schedaNum.textContent, 10) || 0, t0 = null, scritta = false;
            function sali(t) {
              if (t0 === null) t0 = t;
              var q = Math.min((t - t0) / 700, 1);
              var eased = 1 - Math.pow(1 - q, 3);
              schedaNum.textContent = Math.round(da + (e.punteggio - da) * eased);
              /* la fascia cambia mentre il numero è già in viaggio: così non si
                 legge mai un punteggio accanto al verdetto sbagliato */
              if (!scritta && q > 0.5) {
                scritta = true;
                schedaFascia.textContent = e.fascia;
                if (schedaNota) schedaNota.textContent = e.nota;
              }
              if (q < 1) requestAnimationFrame(sali);
              else schedaNum.textContent = e.punteggio;
            }
            requestAnimationFrame(sali);
            casa.classList.remove('cambio');
          }, 340);
        }, 4200);
      }, 420);
    });
  }

  radarVivo();
  animaSezioni();

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
