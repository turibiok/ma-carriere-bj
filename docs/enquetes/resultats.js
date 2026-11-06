// Résultats en direct : lecture de la vue publique `statistiques` toutes les 30 secondes,
// graphiques mis à jour sur place.
(() => {
  const $ = (s) => document.querySelector(s);
  const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
  const nf = (n, d = 0) => Number(n).toLocaleString('fr-FR', { maximumFractionDigits: d, minimumFractionDigits: d });
  const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);
  const mediane = (v) => { if (!v.length) return null; const s = [...v].sort((a, b) => a - b); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // Libellés des réponses, repris des questionnaires.
  const options = (code, col) => window.ENQUETES[code].blocs.flatMap((b) => b.questions).find((q) => q.col === col)?.options ?? [];
  const PIECES = [['pieces_naissance', 'Acte de naissance'], ['pieces_diplomes', 'Diplômes'], ['pieces_prise_service', 'Certificat de prise de service'], ['pieces_arretes', 'Arrêtés ou contrats']];
  const VAL_DEP = { '0': 0, '1': 1, '2-3': 2.5, '4+': 4 };

  let lignes = [];
  let code = location.hash === '#enseignants' ? 'enseignants' : 'sante';
  const graphiques = new Map();

  function couleurs() {
    return { vert: css('--vert'), jaune: '#d4a800', rouge: css('--rouge'), info: css('--info'), doux: css('--doux'), ligne: css('--ligne'), texte: css('--texte') };
  }
  function themeChart() {
    const c = couleurs();
    Chart.defaults.color = c.doux;
    Chart.defaults.borderColor = c.ligne;
    Chart.defaults.font.family = '"Atkinson Hyperlegible", "Segoe UI", system-ui, sans-serif';
    Chart.defaults.font.size = 13;
    Chart.defaults.plugins.legend.labels.boxWidth = 12;
  }

  // --- Lecture en direct ---
  async function charger() {
    try {
      const jeton = await window.jetonAnonyme();
      const res = await fetch(`${window.NEON.api}/statistiques?select=*`, { headers: { Authorization: `Bearer ${jeton}` } });
      if (!res.ok) throw new Error(String(res.status));
      lignes = await res.json();
      $('#pastille').classList.remove('hors');
      $('#etat-direct').textContent = `En direct · mis à jour à ${new Date().toLocaleTimeString('fr-FR')} · actualisation toutes les 30 secondes`;
      afficher();
    } catch {
      $('#pastille').classList.add('hors');
      $('#etat-direct').textContent = 'Connexion à la base impossible pour l’instant : nouvel essai dans 30 secondes.';
    }
  }

  // --- Calculs ---
  function calculer(R) {
    const n = R.length;
    const compte = (k, v) => R.filter((r) => r[k] === v).length;
    const num = (k) => R.map((r) => r[k]).filter((v) => v !== null && v !== undefined).map(Number);
    const sd = R.filter((r) => r.sans_demande === 'oui' || r.sans_demande === 'non');
    const piecesMoy = n ? R.reduce((s, r) => s + PIECES.reduce((t, [k]) => t + (r[k] ?? 0), 0) / PIECES.length, 0) / n : 0;
    const absNb = num('absences_nb');
    return {
      n,
      sansDemande: pct(compte('sans_demande', 'oui'), sd.length), sdBase: sd.length,
      reclame: compte('sans_demande', 'non'),
      plus1an: R.filter((r) => ['1a2ans', 'plus2ans', 'pasEncore'].includes(r.delai)).length,
      piecesMoy, redemande2: pct(R.filter((r) => PIECES.some(([k]) => (r[k] ?? 0) >= 2)).length, n),
      depMoy: n ? R.reduce((s, r) => s + (VAL_DEP[r.deplacements] ?? 0), 0) / n : 0,
      dureeMed: mediane(num('duree_h')), coutMed: mediane(num('cout_f')),
      absence: pct(compte('absence', 'oui'), n), absMoy: absNb.length ? absNb.reduce((a, b) => a + b, 0) / absNb.length : null,
      ficheNon: pct(R.filter((r) => r.fiche === 'non' || r.fiche === 'nsp').length, n),
      neConnaitPas: pct(compte('connait_date', 'non'), n),
      transfertBase: R.filter((r) => r.transfert === 'oui' || r.transfert === 'non').length, transfert: 0,
      mutationBase: R.filter((r) => r.mutation === 'suivie' || r.mutation === 'nonSuivie').length,
      heuresMed: mediane(num('heures_notation')),
      utiliserait: pct(compte('utiliserait', 'oui'), n), peutEtre: pct(compte('utiliserait', 'peutEtre'), n),
      compte,
    };
  }

  function phrases(s) {
    const sante = code === 'sante';
    const public_ = sante ? 'personnels de santé' : 'enseignants';
    const mois = new Date().toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
    const absence = sante ? 'quitter leur service ou faire remplacer une garde' : 's’absenter de leur classe';
    const unite = sante ? 'fois' : 'demi-journée(s)';
    return [
      `Questionnaire anonyme auprès de ${s.n} ${public_}, ${mois}.`,
      s.sdBase ? `${100 - s.sansDemande} % des répondants ont dû réclamer leur dernier avancement ou ne l’ont pas obtenu d’office${s.reclame ? ` ; pour ${s.plus1an} d’entre eux, l’attente a dépassé un an` : ''}.` : '',
      `Une même pièce leur a été redemandée en moyenne ${nf(s.piecesMoy, 1)} fois en deux ans ; ${s.redemande2} % ont dû fournir au moins une pièce deux fois ou plus.`,
      `Chaque répondant a fait en moyenne ${nf(s.depMoy, 1)} déplacement(s) dans l’année pour sa carrière${s.dureeMed !== null ? `, d’une durée médiane de ${nf(s.dureeMed, 1)} heure(s)` : ''}${s.coutMed !== null ? ` et d’un coût médian de ${nf(s.coutMed)} FCFA` : ''}.`,
      `${s.absence} % ont déjà dû ${absence} pour une démarche administrative${s.absMoy !== null ? ` (${nf(s.absMoy, 1)} ${unite} en moyenne l’an dernier)` : ''}.`,
      `${s.ficheNon} % ne savent pas si leur fiche de notation a été remplie, ou disent qu’elle ne l’a pas été ; ${s.neConnaitPas} % ne connaissent pas la date de leur prochain avancement.`,
      sante && s.transfertBase ? `Parmi les ${s.transfertBase} répondant(s) dont la gestion est passée de l’État à une commune, ${pct(s.compte('transfert', 'oui'), s.transfertBase)} % se sont vu redemander des pièces déjà fournies.` : '',
      !sante && s.mutationBase ? `Parmi les ${s.mutationBase} enseignant(s) ayant demandé une mutation, ${pct(s.compte('mutation', 'nonSuivie'), s.mutationBase)} % n’ont pas pu suivre l’examen de leur demande.` : '',
      s.heuresMed !== null ? `Les responsables d’équipe consacrent un temps médian de ${nf(s.heuresMed, 1)} heure(s) à la notation annuelle.` : '',
      `${s.utiliserait} % utiliseraient une plateforme de suivi de carrière sur téléphone, ${s.peutEtre} % peut-être.`,
    ].filter(Boolean);
  }

  // --- Graphiques ---
  function definir() {
    const sante = code === 'sante';
    const c = couleurs();
    const repart = (col) => ({ type: 'barres', col, options: options(code, col) });
    return [
      { id: 'jours', titre: 'Réponses reçues, en cumul', type: 'cumul' },
      { id: 'metier', titre: 'Profession des répondants', ...repart('metier') },
      { id: 'sans_demande', titre: 'Dernier avancement obtenu sans le demander', type: 'anneau', col: 'sans_demande', options: options(code, 'sans_demande'), palette: [c.vert, c.rouge, c.doux] },
      { id: 'delai', titre: 'Avancement réclamé : délai d’obtention', ...repart('delai'), couleur: c.rouge },
      { id: 'pieces', titre: 'Pièces redemandées en deux ans (fois en moyenne)', type: 'pieces' },
      { id: 'deplacements', titre: 'Déplacements pour une démarche, sur un an', ...repart('deplacements') },
      { id: 'attestation', titre: 'Attente de la dernière attestation', ...repart('attestation') },
      { id: 'absence', titre: sante ? 'A dû quitter son service ou faire remplacer une garde' : 'A dû s’absenter de sa classe', type: 'anneau', col: 'absence', options: options(code, 'absence'), palette: [c.rouge, c.vert] },
      { id: 'fiche', titre: 'Fiche de notation remplie et communiquée', type: 'anneau', col: 'fiche', options: options(code, 'fiche'), palette: [c.vert, c.rouge, c.doux] },
      sante ? { id: 'transfert', titre: 'Passage à une commune : pièces redemandées', ...repart('transfert'), couleur: c.jaune }
        : { id: 'mutation', titre: 'Demande de mutation', ...repart('mutation'), couleur: c.jaune },
      { id: 'utiliserait', titre: 'Utiliserait une plateforme sur téléphone', type: 'anneau', col: 'utiliserait', options: options(code, 'utiliserait'), palette: [c.vert, c.jaune, c.rouge] },
    ];
  }

  function donnees(g, R) {
    const c = couleurs();
    if (g.type === 'cumul') {
      const jours = [...new Set(R.map((r) => r.jour))].sort();
      let total = 0;
      const valeurs = jours.map((j) => (total += R.filter((r) => r.jour === j).length));
      return { type: 'line', labels: jours.map((j) => j.split('-').reverse().slice(0, 2).join('/')), data: valeurs, base: R.length,
        dataset: { borderColor: c.vert, backgroundColor: c.vert + '33', fill: true, tension: .25, pointRadius: 3 } };
    }
    if (g.type === 'pieces') {
      return { type: 'bar', axe: 'y', labels: PIECES.map(([, t]) => t), data: PIECES.map(([k]) => R.length ? +(R.reduce((s, r) => s + (r[k] ?? 0), 0) / R.length).toFixed(2) : 0),
        base: R.length, max: 3, dataset: { backgroundColor: c.info, borderRadius: 6 } };
    }
    const base = R.filter((r) => r[g.col] !== null && r[g.col] !== undefined);
    const data = g.options.map(([v]) => base.filter((r) => r[g.col] === v).length);
    if (g.type === 'anneau') return { type: 'doughnut', labels: g.options.map(([, t]) => t), data, base: base.length, dataset: { backgroundColor: g.palette, borderColor: css('--surface'), borderWidth: 2 } };
    return { type: 'bar', axe: 'y', labels: g.options.map(([, t]) => t), data, base: base.length, dataset: { backgroundColor: g.couleur || c.vert, borderRadius: 6 } };
  }

  function dessiner(R) {
    const defs = definir();
    const zone = $('#graphiques');
    const cle = code + defs.map((g) => g.id).join();
    if (zone.dataset.cle !== cle) {
      graphiques.forEach((ch) => ch.destroy());
      graphiques.clear();
      zone.dataset.cle = cle;
      zone.innerHTML = defs.map((g) => `<figure class="graphique" style="margin:0"><h3>${esc(g.titre)}</h3><div class="zone"><canvas id="g-${g.id}" role="img" aria-label="${esc(g.titre)}"></canvas></div><figcaption class="base" id="b-${g.id}"></figcaption></figure>`).join('');
    }
    for (const g of defs) {
      const d = donnees(g, R);
      $(`#b-${g.id}`).textContent = d.base ? `Sur ${d.base} réponse(s).` : 'Pas encore de réponse à cette question.';
      const ancien = graphiques.get(g.id);
      if (ancien) {
        ancien.data.labels = d.labels;
        ancien.data.datasets[0].data = d.data;
        ancien.update();
        continue;
      }
      const lineaire = d.type !== 'doughnut';
      graphiques.set(g.id, new Chart($(`#g-${g.id}`), {
        type: d.type,
        data: { labels: d.labels, datasets: [{ data: d.data, ...d.dataset }] },
        options: {
          responsive: true, maintainAspectRatio: false, indexAxis: d.axe === 'y' ? 'y' : 'x',
          animation: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? false : { duration: 500 },
          plugins: {
            legend: { display: d.type === 'doughnut', position: 'bottom' },
            tooltip: { callbacks: { label: (ctx) => {
              const v = ctx.parsed.x ?? ctx.parsed.y ?? ctx.parsed;
              if (g.type === 'pieces') return ` ${nf(v, 2)} fois en moyenne`;
              if (g.type === 'cumul') return ` ${v} réponse(s)`;
              const total = ctx.dataset.data.reduce((a, b) => a + b, 0);
              return ` ${ctx.raw} réponse(s), ${pct(ctx.raw, total)} %`;
            } } },
          },
          scales: lineaire ? {
            x: { beginAtZero: true, ...(d.max && d.axe === 'y' ? { max: d.max } : {}), ticks: { precision: g.type === 'pieces' ? undefined : 0 }, grid: { display: d.axe !== 'y' ? false : true } },
            y: { beginAtZero: true, ticks: { precision: 0 }, grid: { display: d.axe === 'y' ? false : true } },
          } : undefined,
        },
      }));
    }
  }

  function afficher() {
    $('#onglet-sante').setAttribute('aria-current', code === 'sante' ? 'page' : 'false');
    $('#onglet-enseignants').setAttribute('aria-current', code === 'enseignants' ? 'page' : 'false');
    $('#lien-repondre').href = `${code}.html`;
    const R = lignes.filter((r) => r.enquete === code);
    const totalAutre = lignes.length - R.length;
    $('#onglet-sante').textContent = `Personnels de santé (${lignes.filter((r) => r.enquete === 'sante').length})`;
    $('#onglet-enseignants').textContent = `Enseignants (${lignes.filter((r) => r.enquete === 'enseignants').length})`;
    void totalAutre;
    $('#vide').hidden = R.length > 0;
    $('#contenu').hidden = R.length === 0;
    if (!R.length) return;
    const s = calculer(R);
    const kpi = (val, lib) => `<div class="kpi"><span class="val">${val}</span><span class="lib">${lib}</span></div>`;
    $('#kpis').innerHTML = [
      kpi(nf(s.n), 'réponses'),
      kpi(`${s.sansDemande} %`, 'derniers avancements obtenus sans les demander'),
      kpi(nf(s.piecesMoy, 1), 'fois en moyenne qu’une même pièce a été redemandée en 2 ans'),
      kpi(nf(s.depMoy, 1), 'déplacements par répondant pour une démarche, sur un an'),
      kpi(`${s.absence} %`, code === 'sante' ? 'ont dû quitter leur service pour une démarche' : 'ont dû s’absenter de leur classe pour une démarche'),
      kpi(`${s.ficheNon} %`, 'fiches de notation non remplies ou non communiquées'),
      kpi(`${s.utiliserait} %`, 'utiliseraient la plateforme sur téléphone'),
    ].join('');
    const p = phrases(s);
    $('#phrases').innerHTML = p.map((x) => `<li>${esc(x)}</li>`).join('');
    $('#phrases').dataset.texte = p.join('\n');
    dessiner(R);
  }

  $('#copier').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText($('#phrases').dataset.texte || ''); $('#copie').textContent = 'Phrases copiées.'; }
    catch { $('#copie').textContent = 'Copie refusée par ce navigateur : sélectionnez les phrases et copiez-les.'; }
  });
  window.addEventListener('hashchange', () => { code = location.hash === '#enseignants' ? 'enseignants' : 'sante'; afficher(); });
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { themeChart(); graphiques.forEach((ch) => ch.destroy()); graphiques.clear(); $('#graphiques').dataset.cle = ''; afficher(); });

  themeChart();
  afficher();
  charger();
  setInterval(charger, 30000);
})();
