// Formulaire d'enquête : construit à partir de questions.js, envoie la réponse anonyme à la base.
// Sans réseau, la réponse attend sur le téléphone et part seule au retour du réseau.
(() => {
  const code = document.body.dataset.enquete;
  const enquete = window.ENQUETES[code];
  const BROUILLON = `enquete-${code}-brouillon`;
  const ATTENTE = 'enquetes-en-attente';
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const lire = (cle, defaut) => { try { return JSON.parse(localStorage.getItem(cle)) ?? defaut; } catch { return defaut; } };
  const ecrire = (cle, v) => { try { v === null ? localStorage.removeItem(cle) : localStorage.setItem(cle, JSON.stringify(v)); } catch { /* stockage indisponible */ } };

  // --- Construction ---
  const questions = enquete.blocs.flatMap((b) => b.questions);
  const ident = (q) => q.col || (q.type === 'pieces' ? 'pieces' : q.champs[0].col);
  let n = 0;
  const radios = (nom, options) => `<div class="choix" role="radiogroup" aria-labelledby="t-${nom}">${options.map(([v, t]) =>
    `<label><input type="radio" name="${nom}" value="${v}" id="${nom}-${v}"><span>${esc(t)}</span></label>`).join('')}</div>`;
  function question(q) {
    const principale = !q.si;
    const num = principale ? String(++n) : `${n}b`;
    const id = ident(q);
    const attrs = `class="question" data-q="${id}"${q.si ? ` data-si="${q.si.join('')}" hidden` : ''}`;
    const titre = (lien) => `<div class="intitule"><span class="num">${num}</span>${lien}</div>`;
    if (q.type === 'choix') return `<div ${attrs}>${titre(`<span id="t-${q.col}">${esc(q.texte)}</span>`)}<div class="retrait">${radios(q.col, q.options)}</div></div>`;
    if (q.type === 'pieces') return `<div ${attrs}>${titre(`<span>${esc(q.texte)}</span>`)}<div class="pieces retrait">${q.lignes.map(([col, t]) =>
      `<div class="ligne"><span class="petit" id="t-${col}">${esc(t)}</span>${radios(col, q.options)}</div>`).join('')}</div></div>`;
    const champ = (c) => `<input id="${c.col}" name="${c.col}" type="number" inputmode="decimal" min="${c.min}" max="${c.max}" step="${c.step}">`;
    if (q.type === 'nombre') return `<div ${attrs}>${titre(`<label for="${q.col}">${esc(q.texte)}</label>`)}<div class="champ retrait">${champ(q)}</div></div>`;
    if (q.type === 'nombres') return `<div ${attrs}>${titre(`<span>${esc(q.texte)}</span>`)}<div class="champ deux retrait">${q.champs.map((c) =>
      `<label class="petit">${esc(c.label)}${champ(c)}</label>`).join('')}</div></div>`;
    if (q.type === 'texte') return `<div ${attrs}>${titre(`<label for="${q.col}">${esc(q.texte)}</label>`)}${q.aide ? `<p class="aide retrait">${esc(q.aide)}</p>` : ''}
      <div class="champ retrait">${q.multiligne ? `<textarea id="${q.col}" name="${q.col}" rows="3" maxlength="${q.max}"></textarea>` : `<input id="${q.col}" name="${q.col}" maxlength="${q.max}" autocomplete="off">`}</div></div>`;
    return '';
  }
  $('#questions').innerHTML = enquete.blocs.map((b) => `<fieldset class="bloc"><legend>${esc(b.titre)}</legend>${b.questions.map(question).join('')}</fieldset>`).join('');

  // --- Lecture des réponses ---
  const form = $('#formulaire');
  function reponses() {
    const fd = new FormData(form);
    const r = {};
    for (const q of questions) {
      if (q.si && !visible(q, r)) continue;
      if (q.type === 'choix' && fd.get(q.col)) r[q.col] = fd.get(q.col);
      if (q.type === 'pieces') for (const [col] of q.lignes) if (fd.get(col)) r[col] = Number(fd.get(col));
      const nombres = q.type === 'nombre' ? [q] : q.type === 'nombres' ? q.champs : [];
      for (const c of nombres) {
        const v = fd.get(c.col);
        if (v !== null && v !== '' && Number.isFinite(Number(v)) && Number(v) >= c.min && Number(v) <= c.max) r[c.col] = Number(v);
      }
      if (q.type === 'texte') { const v = String(fd.get(q.col) || '').trim(); if (v) r[q.col] = v.slice(0, q.max); }
    }
    return r;
  }
  function visible(q, r) {
    const [col, op, val] = q.si;
    return op === '=' ? r[col] === val : r[col] !== undefined && r[col] !== val;
  }
  function conditions() {
    const r = reponses();
    const fd = new FormData(form);
    for (const q of questions.filter((x) => x.si)) {
      const el = document.querySelector(`.question[data-q="${ident(q)}"]`);
      const [col, op, val] = q.si;
      const v = r[col] ?? fd.get(col);
      el.hidden = op === '=' ? v !== val : !v || v === val;
    }
  }
  function manquants(r) {
    const m = [];
    for (const q of questions) {
      if (q.requis === false || q.si) continue;
      if (q.type === 'choix' && r[q.col] === undefined) m.push(q.col);
      if (q.type === 'pieces' && q.lignes.some(([col]) => r[col] === undefined)) m.push('pieces');
    }
    return m;
  }

  // --- Brouillon sur le téléphone ---
  form.addEventListener('input', (e) => {
    e.target.closest('.question')?.classList.remove('manque');
    conditions();
    ecrire(BROUILLON, Object.fromEntries(new FormData(form)));
  });
  const b = lire(BROUILLON, null);
  if (b) for (const [k, v] of Object.entries(b)) {
    const radio = document.getElementById(`${k}-${v}`);
    if (radio) radio.checked = true;
    else if (document.getElementById(k)) document.getElementById(k).value = v;
  }
  conditions();

  // --- Envoi ---
  async function deposer(reponse) {
    const jeton = await window.jetonAnonyme();
    const res = await fetch(`${window.NEON.api}/reponses`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jeton}`, Prefer: 'return=minimal' },
      body: JSON.stringify(reponse),
    });
    // 409 : cette réponse est déjà arrivée (envoi répété après une coupure) ; elle compte une seule fois.
    if (res.status === 201 || res.status === 409) return;
    const detail = await res.json().catch(() => ({}));
    throw Object.assign(new Error(detail.message || `Refus ${res.status}`), { refus: true });
  }
  async function envoyerAttente() {
    const file = lire(ATTENTE, []);
    if (!file.length || !navigator.onLine) return;
    const reste = [];
    for (const r of file) {
      try { await deposer(r); } catch (e) { if (!e.refus) reste.push(r); }
    }
    ecrire(ATTENTE, reste.length ? reste : null);
    if (reste.length < file.length && !$('#merci').hidden) { $('#merci-attente').hidden = true; $('#merci-ok').hidden = false; }
  }
  window.addEventListener('online', envoyerAttente);
  envoyerAttente();

  const idReponse = () => (Date.now().toString(36) + Math.random().toString(36).slice(2, 10)).slice(0, 20);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const r = reponses();
    const m = manquants(r);
    document.querySelectorAll('.question.manque').forEach((q) => q.classList.remove('manque'));
    if (m.length) {
      m.forEach((k) => document.querySelector(`.question[data-q="${k}"]`)?.classList.add('manque'));
      $('#erreur').textContent = `${m.length} question(s) sans réponse, encadrée(s) en rouge.`;
      document.querySelector('.question.manque')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    $('#erreur').textContent = '';
    const bouton = $('#envoyer');
    bouton.disabled = true;
    bouton.textContent = 'Envoi…';
    const reponse = { id: idReponse(), enquete: code, ...r };
    let etat = 'ok';
    try { await deposer(reponse); }
    catch (err) {
      if (err.refus) { $('#erreur').textContent = `La réponse n'a pas été acceptée : ${err.message}`; bouton.disabled = false; bouton.textContent = 'Envoyer mes réponses'; return; }
      // Pas de réseau : la réponse attend sur le téléphone.
      ecrire(ATTENTE, [...lire(ATTENTE, []), reponse]);
      etat = 'attente';
    }
    ecrire(BROUILLON, null);
    form.hidden = true;
    $('#merci').hidden = false;
    $('#merci-ok').hidden = etat !== 'ok';
    $('#merci-attente').hidden = etat !== 'attente';
    bouton.disabled = false;
    bouton.textContent = 'Envoyer mes réponses';
    window.scrollTo({ top: 0 });
  });
  $('#nouvelle').addEventListener('click', () => {
    form.reset();
    conditions();
    $('#merci').hidden = true;
    form.hidden = false;
    window.scrollTo({ top: 0 });
  });
})();
