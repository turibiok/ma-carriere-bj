// Interface du prototype : application monopage sans dépendance.
// Routage par le fragment d'URL (#/agents/12), rendu par chaînes HTML,
// actions par délégation d'événements (attribut data-action).

const etat = { user: null, ref: null, onglet: {}, jeton: null };
const vue = document.getElementById('vue');

// Le jeton de session vit dans l'onglet seulement : fermer l'onglet déconnecte.
const stockage = {
  lire: () => { try { return sessionStorage.getItem('jeton'); } catch { return null; } },
  ecrire: (v) => { try { v ? sessionStorage.setItem('jeton', v) : sessionStorage.removeItem('jeton'); } catch { /* stockage indisponible */ } },
};

// --- Utilitaires ---

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const date = (iso) => (iso ? iso.slice(0, 10).split('-').reverse().join('/') : '-');
const fcfa = (n) => `${Math.round(n).toLocaleString('fr-FR')} FCFA`;
const nombre = (n) => Number(n).toLocaleString('fr-FR');

async function api(chemin, options = {}) {
  const res = await fetch(chemin, {
    method: options.method ?? 'GET',
    headers: { 'Content-Type': 'application/json', ...(etat.jeton ? { Authorization: `Bearer ${etat.jeton}` } : {}) },
    body: options.corps ? JSON.stringify(options.corps) : undefined,
  });
  const json = await res.json();
  if (res.status === 401 && etat.user) {
    // Session expirée : retour à la page de connexion.
    fermerSession();
    afficher();
  }
  if (!res.ok) throw new Error(json.erreur ?? 'Erreur');
  return json;
}

function toast(message, erreur = false) {
  const t = document.getElementById('toast');
  t.textContent = message;
  t.className = erreur ? 'toast erreur' : 'toast';
  t.hidden = false;
  clearTimeout(toast.minuteur);
  toast.minuteur = setTimeout(() => { t.hidden = true; }, 4000);
}

// Fenêtre modale : renvoie les valeurs du formulaire, ou null si annulé.
// `valider(valeurs)` (facultatif) fait le traitement ; s'il échoue, l'erreur s'affiche dans la
// fenêtre, qui reste ouverte avec la saisie, au lieu de se fermer.
function modale(titre, contenuHtml, libelleOk = 'Valider', valider = null) {
  const m = document.getElementById('modale');
  m.innerHTML = `<form class="boite" role="dialog" aria-modal="true" aria-label="${esc(titre)}"><h2>${esc(titre)}</h2>${contenuHtml}
    <p class="erreur-form" role="alert" data-erreur-modale></p>
    <div class="actions" style="justify-content:flex-end;margin-top:12px">
      <button type="button" data-fermer>Annuler</button><button class="principal">${esc(libelleOk)}</button></div></form>`;
  m.hidden = false;
  const form = m.querySelector('form');
  form.querySelector('input:not([type=hidden]), textarea, select')?.focus();
  return new Promise((ok) => {
    const fermer = (v) => { m.hidden = true; m.innerHTML = ''; ok(v); };
    m.querySelector('[data-fermer]').onclick = () => fermer(null);
    m.onkeydown = (e) => { if (e.key === 'Escape') fermer(null); };
    form.onsubmit = async (e) => {
      e.preventDefault();
      const fd = new FormData(form);
      const v = {};
      for (const [k, val] of fd.entries()) v[k] = v[k] === undefined ? val : [].concat(v[k], val);
      if (!valider) return fermer(v);
      const bouton = form.querySelector('button.principal');
      bouton.disabled = true;
      try {
        fermer(await valider(v) ?? v);
      } catch (err) {
        form.querySelector('[data-erreur-modale]').textContent = err.message;
        bouton.disabled = false;
      }
    };
  });
}

// Lit un fichier choisi et renvoie { nom, contenu (base64) } après contrôle du format et de la taille.
const TAILLE_MAX_FICHIER = 2 * 1024 * 1024;
function lireEnBase64(fichier, libelle) {
  if (!['application/pdf', 'image/jpeg', 'image/png'].includes(fichier.type)) {
    return Promise.reject(new Error(`Format non accepté (PDF, JPEG ou PNG) : ${libelle}.`));
  }
  if (fichier.size > TAILLE_MAX_FICHIER) return Promise.reject(new Error(`Fichier trop volumineux (2 Mo au plus) : ${libelle}.`));
  return new Promise((ok, ko) => {
    const lecteur = new FileReader();
    lecteur.onload = () => ok({ nom: fichier.name, contenu: String(lecteur.result).split(',')[1] });
    lecteur.onerror = () => ko(new Error(`Lecture impossible : ${libelle}.`));
    lecteur.readAsDataURL(fichier);
  });
}

const LIBELLES = {
  statutEvt: { PROPOSE: ['À instruire', 'b-alerte'], VALIDE_RH: ['À signer', 'b-info'], SIGNE: ['Signé', 'b-ok'], REJETE: ['Rejeté', 'b-danger'], TRAITE: ['Traité', 'b-ok'] },
  typeEvt: {
    AVANCEMENT_ECHELON: ["Avancement d'échelon", 'b-accent'], AVENANT: ['Avenant ACDPE', 'b-accent'],
    AVANCEMENT_GRADE: ['Avancement de grade', 'b-info'], TITULARISATION: ['Titularisation', 'b-ok'],
    DEPART_RETRAITE: ['Départ à la retraite', 'b-alerte'], ALERTE: ['Alerte', 'b-danger'],
  },
  statutEval: { OBJECTIFS_FIXES: ['Objectifs fixés', ''], AUTO_EVALUEE: ['Auto-évaluée', 'b-info'], EVALUEE: ['Notée', 'b-accent'], CONTESTEE: ['Recours (CAP)', 'b-danger'], CLOTUREE: ['Clôturée', 'b-ok'] },
  statutDemande: { DEPOSEE: ['Déposée', 'b-alerte'], DELIVREE: ['Délivrée', 'b-ok'], ACCEPTEE: ['Acceptée', 'b-ok'], REJETEE: ['Rejetée', 'b-danger'] },
  position: { ACTIVITE: 'Activité', DISPONIBILITE: 'Disponibilité', DETACHEMENT: 'Détachement', RETRAITE: 'Retraite' },
};
const badge = (table, cle) => {
  const [txt, cls] = LIBELLES[table][cle] ?? [cle, ''];
  return `<span class="badge ${cls}">${esc(txt)}</span>`;
};
const situation = (a) => a.statut === 'APE'
  ? `${a.echelle} · grade ${a.grade} · échelon ${a.echelon}`
  : `${a.libelle_echelle} · palier ${a.echelon}`;
const statutAgent = (a) => (a.statut === 'APE' ? (a.stagiaire ? 'Fonctionnaire stagiaire' : 'Fonctionnaire') : 'ACDPE');

// --- Navigation par profil ---

const MENUS = {
  agent: [['#/moi', 'Mon dossier'], ['#/notifications', 'Notifications'], ['#/evaluations', 'Ma notation'], ['#/demarches', 'Mes démarches'], ['#/actes', 'Mes actes'], ['#/verifier', 'Vérifier un acte'], ['#/impact', 'Mesure de la simplification']],
  evaluateur: [['#/', 'Tableau de bord'], ['#/agents', 'Mon équipe'], ['#/evaluations', 'Notations'], ['#/moi', 'Mon dossier'], ['#/notifications', 'Notifications'], ['#/demarches', 'Mes démarches'], ['#/actes', 'Actes'], ['#/verifier', 'Vérifier un acte'], ['#/impact', 'Mesure de la simplification']],
  gestionnaire: [['#/', 'Tableau de bord'], ['#/inscriptions', 'Inscriptions'], ['#/propositions', 'Propositions'], ['#/agents', 'Agents'], ['#/evaluations', 'Notations'], ['#/demandes', 'Demandes'], ['#/actes', 'Actes'], ['#/regles', 'Règles'], ['#/verifier', 'Vérifier un acte'], ['#/impact', 'Mesure de la simplification']],
  drh: [['#/', 'Tableau de bord'], ['#/inscriptions', 'Inscriptions'], ['#/propositions', 'Propositions'], ['#/agents', 'Agents'], ['#/evaluations', 'Notations'], ['#/demandes', 'Demandes'], ['#/actes', 'Actes'], ['#/regles', 'Règles'], ['#/journal', 'Journal'], ['#/verifier', 'Vérifier un acte'], ['#/impact', 'Mesure de la simplification']],
  admin: [['#/', 'Tableau de bord'], ['#/inscriptions', 'Inscriptions'], ['#/regles', 'Règles statutaires'], ['#/agents', 'Agents'], ['#/journal', 'Journal'], ['#/verifier', 'Vérifier un acte'], ['#/impact', 'Mesure de la simplification']],
};

const ROLES = { agent: 'Agent', evaluateur: 'Évaluateur', gestionnaire: 'Gestionnaire RH', drh: 'DRH', admin: 'Administrateur' };

function dessinerMenu() {
  const route = location.hash || '#/';
  document.getElementById('nav').innerHTML = MENUS[etat.user.role]
    .map(([h, t]) => {
      const actif = h === '#/' ? route === '#/' : route.startsWith(h);
      const pastille = h === '#/notifications' && etat.nonLues ? `<span class="badge b-alerte" aria-label="${etat.nonLues} non lues">${etat.nonLues}</span>` : '';
      return `<a href="${h}" class="${actif ? 'actif' : ''}">${esc(t)}${pastille}</a>`;
    }).join('');
  const u = etat.user;
  document.getElementById('avatar').textContent = u.nom.split(/\s+/).map((m) => m[0]).slice(0, 2).join('').toUpperCase();
  document.getElementById('compte-nom').textContent = u.nom;
  document.getElementById('compte-role').textContent = `${ROLES[u.role]} · ${u.matricule}`;
  document.getElementById('compte-desc').textContent = u.description ?? '';
}

// --- Vues ---

async function vueTableauDeBord() {
  const d = await api('/api/tableau-de-bord');
  const ref = etat.ref;
  const peutLancer = ['gestionnaire', 'drh', 'admin'].includes(etat.user.role);
  const enAttente = Object.values(d.propositions).reduce((s, n) => s + n, 0);
  const totalCamp = Object.values(d.campagne).reduce((s, n) => s + n, 0);
  const couleurs = { CLOTUREE: 'var(--ok)', EVALUEE: 'var(--accent)', AUTO_EVALUEE: 'var(--info)', OBJECTIFS_FIXES: '#c3ccd5', CONTESTEE: 'var(--danger)' };
  // Effectifs par secteur présent dans le périmètre : fonctionnaires et ACDPE.
  const libSecteur = (code) => ref.secteurs.find((x) => x.code === code)?.libelle ?? code;
  const parSecteur = {};
  for (const [cle, n] of Object.entries(d.effectifs)) {
    const [sec, st] = cle.split('|');
    parSecteur[sec] ??= { APE: 0, ACDPE: 0 };
    parSecteur[sec][st] += n;
  }
  const maxType = Math.max(1, ...Object.values(d.propositions));
  return `
    <div class="entete">
      <div><h1>Tableau de bord</h1><p class="doux">${etat.user.role === 'evaluateur' ? 'Votre équipe' : `${Object.keys(parSecteur).length} secteur(s) de l'administration`} · ${date(new Date().toISOString())}</p></div>
      ${peutLancer ? `<div class="actions"><button class="principal" data-action="moteur">Lancer le moteur de règles</button></div>` : ''}
    </div>
    ${peutLancer ? `<p class="doux petit" style="margin-top:-12px">Dernière exécution : ${d.derniere_execution ? new Date(d.derniere_execution).toLocaleString('fr-FR') : 'jamais'} · en production, exécution automatique chaque nuit.</p>` : ''}
    <div class="kpis">
      <div class="kpi"><div class="titre">Agents suivis</div><div class="valeur">${d.total}</div>
        <div class="doux petit">${Object.entries(parSecteur).map(([sec, n]) => `${esc(libSecteur(sec))} : ${n.APE} fonct. · ${n.ACDPE} ACDPE`).join('<br>')}</div></div>${d.inscriptions !== null ? `
      <div class="kpi"><div class="titre">Inscriptions à vérifier</div><div class="valeur">${d.inscriptions}</div><div class="doux petit"><a href="#/inscriptions">Vérifier les justificatifs →</a></div></div>` : ''}
      <div class="kpi"><div class="titre">Propositions en attente</div><div class="valeur">${enAttente}</div><div class="doux petit">détectées par le moteur</div></div>
      <div class="kpi"><div class="titre">Avancements en retard</div><div class="valeur">${d.retards}</div><div class="doux petit">rappel estimé : ${fcfa(d.rappel_estime)}</div></div>
      <div class="kpi"><div class="titre">Notation ${ref.annee}</div><div class="valeur">${d.campagne.CLOTUREE ?? 0}/${totalCamp}</div><div class="doux petit">clôturées · échéance le 30 octobre</div></div>
      <div class="kpi"><div class="titre">Pièces non redemandées</div><div class="valeur">${d.pieces.evitees}/${d.pieces.total}</div><div class="doux petit">sur ${d.pieces.demandes} démarche(s) déposée(s)</div></div>
    </div>
    <div class="grille g2">
      <div class="carte"><h2>Propositions par type</h2>
        ${Object.keys(d.propositions).length ? Object.entries(d.propositions).sort((a, b) => b[1] - a[1]).map(([t, n]) => `
          <div class="ligne-barre"><span>${badge('typeEvt', t)}</span><div class="jauge"><span style="width:${(n / maxType) * 100}%"></span></div><strong>${n}</strong></div>`).join('')
          : `<p class="vide">Aucune proposition. ${peutLancer ? 'Lancez le moteur de règles.' : ''}</p>`}
        ${peutLancer && enAttente ? '<p><a href="#/propositions">Instruire les propositions →</a></p>' : ''}
      </div>
      <div class="carte"><h2>Campagne de notation ${ref.annee}</h2>
        <div class="barre">${Object.entries(couleurs).map(([s, c]) => `<span style="width:${((d.campagne[s] ?? 0) / Math.max(1, totalCamp)) * 100}%;background:${c}" title="${esc(LIBELLES.statutEval[s][0])}"></span>`).join('')}</div>
        <div class="legende">${Object.entries(couleurs).map(([s, c]) => `<span><i style="background:${c}"></i>${esc(LIBELLES.statutEval[s][0])} : ${d.campagne[s] ?? 0}</span>`).join('')}</div>
        <p class="doux petit" style="margin-top:12px">Période de référence ${esc(ref.calendrier.periode)} ; notation ${esc(ref.calendrier.notation)} ; ${esc(ref.calendrier.validation)}.</p>
        <p><a href="#/evaluations">Suivre la campagne →</a></p>
      </div>
    </div>
    <div class="carte"><h2>Départs à la retraite dans les 36 prochains mois</h2>
      <div class="tableau"><table><thead><tr><th>Agent</th><th>Corps</th><th>Structure</th><th>Date limite</th><th>Délai</th></tr></thead><tbody>
      ${d.retraites.map((r) => `<tr class="lien" data-lien="#/agents/${r.id}"><td>${esc(r.nom)}</td><td>${esc(r.corps)}</td><td>${esc(r.structure)}</td><td>${date(r.date)}</td>
        <td>${r.mois < 0 ? `<span class="badge b-danger">dépassée de ${-r.mois} mois</span>` : `<span class="badge ${r.mois <= 12 ? 'b-alerte' : ''}">${r.mois} mois</span>`}</td></tr>`).join('') || '<tr><td colspan="5" class="vide">Aucun départ prévu</td></tr>'}
      </tbody></table></div>
    </div>`;
}

async function vueAgents() {
  const q = new URLSearchParams(location.hash.split('?')[1] ?? '');
  const liste = await api(`/api/agents?${q}`);
  const ref = etat.ref;
  const opt = (nom, valeurs) => valeurs.map(([v, t]) => `<option value="${esc(v)}" ${q.get(nom) === String(v) ? 'selected' : ''}>${esc(t)}</option>`).join('');
  return `
    <div class="entete"><div><h1>${etat.user.role === 'evaluateur' ? 'Mon équipe' : 'Agents'}</h1><p class="doux">${liste.length} agent(s)</p></div></div>
    <form class="filtres" data-form="filtres">
      <input name="q" placeholder="Nom, matricule ou NPI" value="${esc(q.get('q') ?? '')}">
      <select name="secteur"><option value="">Tous secteurs</option>${opt('secteur', ref.secteurs.map((x) => [x.code, x.libelle]))}</select>
      <select name="statut"><option value="">Tous statuts</option>${opt('statut', [['APE', 'Fonctionnaires'], ['ACDPE', 'ACDPE']])}</select>
      <select name="structure"><option value="">Toutes structures</option>${opt('structure', ref.structures.map((s) => [s.id, s.nom]))}</select>
      <button>Filtrer</button>
    </form>
    <div class="carte tableau" style="padding:0"><table><thead><tr><th>Matricule</th><th>Nom et prénoms</th><th>Corps</th><th>Structure</th><th>Statut</th><th>Situation</th><th>Retraite</th><th></th></tr></thead><tbody>
      ${liste.map((a) => `<tr class="lien" data-lien="#/agents/${a.id}">
        <td class="code">${esc(a.matricule)}</td><td><strong>${esc(a.nom)}</strong> ${esc(a.prenoms)}</td><td>${esc(a.corps)}</td><td>${esc(a.structure)}</td>
        <td>${a.statut === 'APE' ? (a.stagiaire ? '<span class="badge b-alerte">Stagiaire</span>' : '<span class="badge b-accent">Fonctionnaire</span>') : '<span class="badge b-info">ACDPE</span>'}
          ${a.position !== 'ACTIVITE' ? `<span class="badge">${esc(LIBELLES.position[a.position])}</span>` : ''}</td>
        <td>${esc(situation(a))}</td><td>${date(a.date_retraite)}</td>
        <td>${a.en_cours ? `<span class="badge b-alerte" title="Propositions en cours">${a.en_cours}</span>` : ''}</td></tr>`).join('') || '<tr><td colspan="8" class="vide">Aucun agent</td></tr>'}
    </tbody></table></div>`;
}

async function vueAgent(id) {
  const d = await api(`/api/agents/${id}`);
  const a = d.agent;
  const gestion = ['gestionnaire', 'drh'].includes(etat.user.role);
  const onglet = etat.onglet.agent ?? 'carriere';
  const onglets = [['carriere', 'Carrière'], ['notations', `Notations (${d.evaluations.length})`], ['propositions', `Propositions (${d.evenements.length})`],
    ['pieces', 'Diplômes et coffre-fort'], ['demarches', `Démarches (${d.demandes.length})`], ['actes', `Actes (${d.actes.length})`]];
  const contenu = {
    carriere: `<ol class="frise">${d.historique.map((h) => `<li><time>${date(h.date_effet)}</time>${esc(h.libelle)}${h.acte_id ? ` · <a href="#/actes/${h.acte_id}">voir l'acte</a>` : ''}</li>`).join('')}</ol>`,
    notations: `<table><thead><tr><th>Année</th><th>Statut</th><th>Note</th><th>Mention</th></tr></thead><tbody>
      ${d.evaluations.map((e) => `<tr class="lien" data-lien="#/evaluations/${e.id}"><td>${e.annee}</td><td>${badge('statutEval', e.statut)}</td><td>${e.note_finale ?? '-'}${e.note_finale !== null ? '/20' : ''}</td><td>${esc(e.mention ?? '-')}</td></tr>`).join('')}</tbody></table>`,
    propositions: d.evenements.length ? `<table><thead><tr><th>Type</th><th>Objet</th><th>Effet</th><th>Statut</th></tr></thead><tbody>
      ${d.evenements.map((e) => `<tr><td>${badge('typeEvt', e.type)}</td><td>${esc(e.libelle)}${e.motif_rejet ? `<div class="doux petit">Motif : ${esc(e.motif_rejet)}</div>` : ''}</td><td>${date(e.date_effet)}</td><td>${badge('statutEvt', e.statut)}</td></tr>`).join('')}</tbody></table>`
      : '<p class="vide">Aucune proposition pour cet agent.</p>',
    pieces: `<h3>Diplômes</h3><table><thead><tr><th>Intitulé</th><th>Obtenu le</th><th>Vérification</th><th>Pris en compte</th></tr></thead><tbody>
      ${d.diplomes.map((x) => `<tr><td>${esc(x.intitule)}</td><td>${date(x.date_obtention)}</td>
        <td>${x.verifie ? '<span class="badge b-ok">Vérifié</span>' : `<span class="badge b-alerte">À vérifier</span> ${gestion ? `<button data-action="verifier-diplome" data-id="${x.id}">Vérifier auprès de l'établissement</button>` : ''}`}</td>
        <td>${x.pris_en_compte ? 'Oui' : 'Non'}</td></tr>`).join('')}</tbody></table>
      <h3>Coffre-fort numérique</h3><p class="doux petit">Pièces déposées une seule fois et réutilisées dans toutes les démarches.</p>
      <table><tbody>${d.coffre.map((c) => `<tr><td>${esc(c.libelle)}</td><td class="doux">déposé le ${date(c.date_depot)}</td><td><span class="badge b-ok">Vérifié</span></td>
        <td>${c.document_id ? `<button data-action="voir-doc" data-id="${c.document_id}" data-titre="${esc(c.libelle)}">Consulter</button>`
          : '<span class="doux petit" title="Pièce versée au dossier papier avant la plateforme">Dossier papier</span>'}</td></tr>`).join('')}</tbody></table>`,
    demarches: d.demandes.length ? tableDemandes(d.demandes, false) : '<p class="vide">Aucune démarche.</p>',
    actes: d.actes.length ? `<table><tbody>${d.actes.map((t) => `<tr class="lien" data-lien="#/actes/${t.id}"><td class="code">${esc(t.numero)}</td><td>${esc(t.objet)}</td><td>${date(t.date_signature)}</td></tr>`).join('')}</tbody></table>`
      : '<p class="vide">Aucun acte généré par Ma Carrière BJ.</p>',
  };
  return `
    <div class="entete"><div><p class="doux petit">${esc(a.matricule)} · ${esc(statutAgent(a))}</p><h1>${esc(a.prenoms)} ${esc(a.nom)}</h1>
      <p class="doux">${esc(a.corps)}${a.fonction ? ` · ${esc(a.fonction)}` : ''} · ${esc(a.structure)} (${esc(a.departement)})</p></div>
      <div>${a.position !== 'ACTIVITE' ? `<span class="badge b-alerte">${esc(LIBELLES.position[a.position])}</span>` : '<span class="badge b-ok">En activité</span>'}</div></div>
    <div class="carte identite">
      <div><span>Situation</span><strong>${esc(situation(a))}</strong></div>
      <div><span>Indice (grille fictive)</span><strong>${a.indice}</strong></div>
      <div><span>Depuis le</span><strong>${date(a.date_effet_echelon)}</strong></div>
      <div><span>Prochain ${a.statut === 'APE' ? 'échelon' : 'palier'} possible</span><strong>${date(a.prochain_echelon)}</strong></div>
      <div><span>Première prise de service</span><strong>${date(a.date_prise_service)}</strong></div>
      <div><span>Limite d'âge (${a.age_retraite} ans)</span><strong>${date(a.date_retraite)}</strong></div>
      <div><span>NPI</span><strong>${a.npi ? esc(a.npi) : '<span class="badge b-danger">Non renseigné</span>'}</strong></div>
      <div><span>Supérieur hiérarchique</span><strong>${esc(a.superieur ?? '-')}</strong></div>
      <div><span>Ministère</span><strong>${esc(a.ministere)}</strong></div>
    </div>
    <div class="onglets">${onglets.map(([k, t]) => `<button data-action="onglet" data-cle="agent" data-val="${k}" class="${onglet === k ? 'actif' : ''}">${esc(t)}</button>`).join('')}</div>
    <div class="carte">${contenu[onglet]}</div>`;
}

async function vuePropositions() {
  const q = new URLSearchParams(location.hash.split('?')[1] ?? '');
  const statut = q.get('statut') ?? 'PROPOSE';
  const type = q.get('type') ?? '';
  const liste = await api(`/api/evenements?statut=${statut}&type=${type}`);
  const filtres = [['PROPOSE', 'À instruire'], ['VALIDE_RH', 'À signer'], ['SIGNE', 'Signées'], ['TRAITE', 'Alertes traitées'], ['REJETE', 'Rejetées'], ['TOUS', 'Toutes']];
  const role = etat.user.role;
  const actions = (e) => {
    if (e.type === 'ALERTE' && e.statut === 'PROPOSE') return `<button data-action="valider" data-id="${e.id}">Marquer traitée</button>`;
    const b = [];
    if (e.statut === 'PROPOSE') b.push(`<button class="principal" data-action="valider" data-id="${e.id}">Instruire</button>`);
    if (e.statut === 'VALIDE_RH' && role === 'drh') b.push(`<button class="principal" data-action="valider" data-id="${e.id}">Signer l'acte</button>`);
    if (e.statut === 'VALIDE_RH' && role !== 'drh') b.push('<span class="doux petit">En attente de signature DRH</span>');
    if (['PROPOSE', 'VALIDE_RH'].includes(e.statut)) b.push(`<button class="danger" data-action="rejeter" data-id="${e.id}">Rejeter</button>`);
    if (e.acte_id) b.push(`<a class="bouton" href="#/actes/${e.acte_id}">Acte</a>`);
    return b.join('');
  };
  const detail = (e) => {
    const d = e.details;
    const x = [];
    if (d.retard_mois > 0) x.push(`<span class="badge b-danger">${d.retard_mois} mois de retard</span> rappel estimé ${fcfa(d.rappel_estime)}`);
    if (d.moyenne !== undefined) x.push(`moyenne ${d.moyenne}/20`);
    if (e.motif_rejet) x.push(`Motif du rejet : ${esc(e.motif_rejet)}`);
    return x.length ? `<div class="doux petit">${x.join(' · ')}</div>` : '';
  };
  return `
    <div class="entete"><div><h1>Propositions du moteur de règles</h1>
      <p class="doux">Le gestionnaire instruit, le DRH signe ; l'acte est généré et la situation de l'agent mise à jour.</p></div>
      <div class="actions"><button data-action="moteur">Relancer le moteur</button></div></div>
    <div class="onglets">${filtres.map(([k, t]) => `<button data-action="filtre-prop" data-statut="${k}" class="${statut === k ? 'actif' : ''}">${esc(t)}</button>`).join('')}</div>
    <div class="filtres"><select data-action="type-prop"><option value="">Tous les types</option>
      ${Object.entries(LIBELLES.typeEvt).map(([k, [t]]) => `<option value="${k}" ${type === k ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select>
      <span class="doux" style="align-self:center">${liste.length} proposition(s)</span></div>
    <div class="carte tableau" style="padding:0"><table><thead><tr><th>Agent</th><th>Type</th><th>Objet</th><th>Effet</th><th>Statut</th><th></th></tr></thead><tbody>
      ${liste.map((e) => `<tr><td><a href="#/agents/${e.agent_id}"><strong>${esc(e.nom)}</strong> ${esc(e.prenoms)}</a><div class="doux petit">${esc(e.corps)} · ${esc(e.structure)}</div></td>
        <td>${badge('typeEvt', e.type)}</td><td>${esc(e.libelle)}${detail(e)}</td><td>${date(e.date_effet)}</td><td>${badge('statutEvt', e.statut)}</td>
        <td><div class="actions">${actions(e)}</div></td></tr>`).join('') || '<tr><td colspan="6" class="vide">Rien dans cette file.</td></tr>'}
    </tbody></table></div>`;
}

async function vueEvaluations() {
  const ref = etat.ref;
  const q = new URLSearchParams(location.hash.split('?')[1] ?? '');
  const annee = Number(q.get('annee')) || ref.annee;
  const liste = await api(`/api/evaluations?annee=${annee}`);
  if (etat.user.role === 'agent' && liste.length === 1 && !q.get('annee')) {
    location.hash = `#/evaluations/${liste[0].id}`;
    return '';
  }
  const aFaire = (e) => {
    const moi = etat.user.agent_id;
    if (e.agent_id === moi && ['OBJECTIFS_FIXES', 'EVALUEE'].includes(e.statut)) return true;
    if (e.superieur_id === moi && e.statut === 'AUTO_EVALUEE') return true;
    return etat.user.role === 'drh' && e.statut === 'CONTESTEE';
  };
  return `
    <div class="entete"><div><h1>Notation ${annee}</h1>
      <p class="doux">Période ${esc(ref.calendrier.periode)} · notation ${esc(ref.calendrier.notation)} · ${esc(ref.calendrier.validation)} · recours : ${esc(ref.calendrier.recours)}.</p></div>
      <div class="actions">${[ref.annee, ref.annee - 1, ref.annee - 2].map((a) => `<a class="bouton" href="#/evaluations?annee=${a}" ${a === annee ? 'style="border-color:var(--accent)"' : ''}>${a}</a>`).join('')}</div></div>
    <div class="carte tableau" style="padding:0"><table><thead><tr><th>Agent</th><th>Structure</th><th>Statut</th><th>Note</th><th>Classe</th><th></th></tr></thead><tbody>
      ${liste.map((e) => `<tr class="lien" data-lien="#/evaluations/${e.id}"><td><strong>${esc(e.nom)}</strong> ${esc(e.prenoms)}<div class="doux petit">${esc(e.corps)} · ${e.statut_agent === 'APE' ? 'Fonctionnaire' : 'ACDPE'}</div></td>
        <td>${esc(e.structure)}</td><td>${badge('statutEval', e.statut)}</td><td>${e.note_finale ?? '-'}</td><td>${esc(e.mention ?? '-')}</td>
        <td>${aFaire(e) ? '<span class="badge b-alerte">À vous d\'agir</span>' : ''}</td></tr>`).join('') || '<tr><td colspan="6" class="vide">Aucune fiche</td></tr>'}
    </tbody></table></div>`;
}

async function vueFiche(id) {
  const e = await api(`/api/evaluations/${id}`);
  const ref = etat.ref;
  const moi = etat.user.agent_id;
  const estAgent = e.agent_id === moi;
  const estEval = e.superieur_id === moi && moi;
  const mode = estAgent && e.statut === 'OBJECTIFS_FIXES' ? 'auto'
    : estEval && e.statut === 'AUTO_EVALUEE' ? 'evaluer' : null;
  const ordre = ['OBJECTIFS_FIXES', 'AUTO_EVALUEE', 'EVALUEE', 'CLOTUREE'];
  const pos = e.statut === 'CONTESTEE' ? 2.5 : ordre.indexOf(e.statut);
  // Boutons de note : de vrais boutons radio, masqués visuellement mais utilisables au clavier.
  // Le contrôle « tout est noté » est fait à l'envoi, avec un message clair (pas de blocage muet du navigateur).
  const notes = (code, champ, libelle) => `<div class="notes-select" role="radiogroup" aria-label="${esc(libelle)}">${ref.echelle_notation.map((n) =>
    `<label title="${n.note} : ${esc(n.libelle)}"><input type="radio" name="${code}" value="${n.note}" ${n.note === (champ ?? null) ? 'checked' : ''}><span>${n.note}</span></label>`).join('')}</div>`;
  const cellule = (c, champ) => (c[champ] ?? '-');
  const lignes = e.fiche.rubriques.map((r) => `
    <tr><th colspan="3" style="background:var(--accent-clair);color:var(--accent)">${esc(r.libelle)} <span class="doux">· poids ${e.ponderation[r.code]} %</span></th></tr>
    ${r.criteres.map((c) => `<tr data-critere="${c.code}"><td>${esc(c.libelle)}${c.code.startsWith('obj') ? ' <span class="badge">objectif</span>' : ''}</td>
      <td>${mode === 'auto' ? notes(c.code, c.auto, c.libelle) : cellule(c, 'auto')}</td>
      <td>${mode === 'evaluer' ? notes(c.code, c.note, c.libelle) : cellule(c, 'note')}</td></tr>`).join('')}`).join('');
  const objectifs = e.fiche.rubriques[0].criteres.filter((c) => c.code.startsWith('obj')).map((c) => c.libelle);
  return `
    <div class="entete"><div><p class="doux petit"><a href="#/evaluations?annee=${e.annee}">← Notation ${e.annee}</a></p>
      <h1>Fiche de notation ${e.annee} : ${esc(e.prenoms)} ${esc(e.nom)}</h1>
      <p class="doux">${esc(e.corps)} · ${e.statut_agent === 'APE' ? 'Fonctionnaire' : 'ACDPE'} · ${esc(e.structure)} · évaluateur : ${esc(e.evaluateur ?? 'direction départementale')}</p></div>
      <div>${badge('statutEval', e.statut)}</div></div>
    <ol class="etapes">${['Objectifs fixés', 'Auto-évaluation', 'Notation', 'Visa ou recours', 'Clôture'].map((t, i) => `<li class="${i < pos + 1 ? 'fait' : i === Math.ceil(pos + 1) ? 'courant' : ''}">${t}</li>`).join('')}</ol>
    ${estEval && e.statut === 'OBJECTIFS_FIXES' ? `<div class="carte"><h2>Contrat d'objectifs</h2><p class="doux petit">Fixés en début de période ; l'agent s'auto-évalue ensuite.</p>
      <form data-form="objectifs" data-id="${e.id}">${[0, 1, 2, 3].map((i) => `<div class="champ"><input name="objectif" value="${esc(objectifs[i] ?? '')}" placeholder="Objectif ${i + 1}"></div>`).join('')}
      <button>Enregistrer les objectifs</button></form></div>` : ''}
    <form class="carte tableau" data-form="${mode ?? 'lecture'}" data-id="${e.id}" novalidate>
      ${mode ? `<p class="doux petit">${mode === 'auto' ? 'Notez-vous' : "Notez l'agent"} sur chacun des ${e.fiche.rubriques.reduce((s, r) => s + r.criteres.length, 0)} éléments : 1 insuffisant, 3 conforme aux attentes, 5 exceptionnel.
        <span data-progression></span></p>` : ''}
      <table><thead><tr><th>Élément apprécié (1 à 5)</th><th>Auto-évaluation</th><th>Évaluateur</th></tr></thead><tbody>${lignes}</tbody></table>
      ${mode === 'auto' ? `<div class="champ" style="margin-top:12px"><label for="commentaire-agent">Commentaire de l'agent (facultatif)</label><textarea id="commentaire-agent" name="commentaire"></textarea></div>` : ''}
      ${mode === 'evaluer' ? `<div class="champ" style="margin-top:12px"><label for="commentaire-eval">Appréciation de l'évaluateur (rapport spécial obligatoire si la note est inférieure à ${e.rapport_special.sous} ou d'au moins ${e.rapport_special.des})</label>
        <textarea id="commentaire-eval" name="commentaire"></textarea></div><p>Note calculée : <strong data-apercu>-</strong></p>` : ''}
      ${mode ? `<p class="erreur-form" role="alert" data-erreur></p>
        <button class="principal">${mode === 'auto' ? 'Transmettre mon auto-évaluation' : 'Valider la notation'}</button>` : ''}
    </form>
    <div class="grille g2">
      <div class="carte"><h2>Résultat</h2>
        <p class="note-grosse">${e.note_finale !== null ? `${e.note_finale}/20` : '-'}</p><p>${esc(e.mention ?? 'Non notée')}</p>
        ${e.commentaire_evaluateur ? `<p><strong>Évaluateur :</strong> ${esc(e.commentaire_evaluateur)}</p>` : ''}
        ${e.commentaire_agent ? `<p><strong>Agent :</strong> ${esc(e.commentaire_agent)}</p>` : ''}
        ${e.decision_commission ? `<p><strong>Avis de la CAP :</strong> ${esc(e.decision_commission)}</p>` : ''}</div>
      <div class="carte"><h2>Suite</h2>
        ${estAgent && e.statut === 'EVALUEE' ? `<p>Prenez connaissance de votre note. Vous pouvez la viser ou former un recours (avis de la CAP sous 8 jours).</p>
          <div class="actions"><button class="principal" data-action="viser" data-id="${e.id}">Viser la fiche</button><button data-action="contester" data-id="${e.id}">Former un recours</button></div>` : ''}
        ${etat.user.role === 'drh' && e.statut === 'CONTESTEE' ? `<p>Recours de l'agent : saisir l'avis de la commission administrative paritaire.</p>
          <button class="principal" data-action="commission" data-id="${e.id}">Saisir l'avis de la CAP</button>` : ''}
        ${e.statut === 'CLOTUREE' ? '<p>Fiche clôturée. La note est prise en compte par le moteur de règles (avancement de grade, augmentation biennale des ACDPE, titularisation).</p>' : ''}
        ${mode ? '<p class="doux">Complétez la fiche ci-dessus puis validez.</p>' : ''}
        ${!mode && !(estAgent && e.statut === 'EVALUEE') && !(etat.user.role === 'drh' && e.statut === 'CONTESTEE') && e.statut !== 'CLOTUREE' ? `<p class="doux">En attente de ${esc(ref.etapes_evaluation[e.statut].acteur ?? '-')}.</p>` : ''}
      </div></div>`;
}

function tableDemandes(liste, gestion) {
  return `<table><thead><tr>${gestion ? '<th>Agent</th>' : ''}<th>Démarche</th><th>Déposée le</th><th>Pièces</th><th>Statut</th><th></th></tr></thead><tbody>
    ${liste.map((d) => `<tr>${gestion ? `<td><a href="#/agents/${d.agent_id}">${esc(d.prenoms)} ${esc(d.nom)}</a><div class="doux petit">${esc(d.structure)}</div></td>` : ''}
      <td>${esc(d.libelle ?? d.type)}${d.motif ? `<div class="doux petit">Motif : ${esc(d.motif)}</div>` : ''}
        ${(d.documents ?? []).map((doc) => `<div><button class="lien-doc" data-action="voir-doc" data-id="${doc.id}" data-titre="${esc(doc.nom_fichier)}" data-mime="${doc.mime}">Pièce jointe : ${esc(doc.nom_fichier)}</button></div>`).join('')}</td>
      <td>${date(d.depose_le)}</td>
      <td><span class="compteur">${d.pieces.evitees}/${d.pieces.total}</span> <span class="doux petit">sans l'agent</span></td>
      <td>${badge('statutDemande', d.statut)}${d.reponse ? `<div class="doux petit">${esc(d.reponse)}</div>` : ''}</td>
      <td><div class="actions">${gestion && d.statut === 'DEPOSEE' ? `<button class="principal" data-action="accepter" data-id="${d.id}">Accepter</button><button class="danger" data-action="refuser" data-id="${d.id}">Rejeter</button>` : ''}
        ${d.acte_id ? `<a class="bouton" href="#/actes/${d.acte_id}">Acte</a>` : ''}</div></td></tr>`).join('') || `<tr><td colspan="6" class="vide">Aucune demande</td></tr>`}
  </tbody></table>`;
}

async function vueDemarches() {
  const [catalogue, demandes] = await Promise.all([api('/api/demarches'), api('/api/demandes')]);
  const miennes = demandes.filter((d) => d.agent_id === etat.user.agent_id);
  etat.catalogue = catalogue;
  const evitees = catalogue.reduce((s, d) => s + d.evitees, 0), total = catalogue.reduce((s, d) => s + d.total, 0);
  return `
    <div class="entete"><div><h1>Mes démarches</h1>
      <p class="doux">« Dites-le nous une fois » : l'administration retrouve elle-même ${evitees} des ${total} pièces exigées par ces démarches.</p></div></div>
    <div class="grille g2">${catalogue.map((d) => `
      <div class="carte demarche"><h3>${esc(d.libelle)}</h3>
        <p class="doux petit">Délai : ${esc(d.delai)}${d.note ? ` · ${esc(d.note)}` : ''}</p>
        <p class="compteur">${d.evitees} pièce(s) sur ${d.total} obtenue(s) sans vous</p>
        <details><summary class="petit">Voir les pièces et leur source</summary>
          ${d.pieces.map((p) => `<div class="piece"><span>${esc(p.libelle)}</span><span class="badge ${p.a_fournir ? 'b-alerte' : 'b-ok'}" title="${esc(p.source_libelle)}">${p.a_fournir ? 'À fournir' : esc(p.source === 'BASE_RH' ? 'Dossier RH' : p.source === 'COFFRE' ? 'Coffre-fort' : p.source === 'RNPP' ? 'RNPP (NPI)' : p.source === 'FORMULAIRE' ? 'Formulaire' : p.source === 'CIRCUIT' ? 'Circuit' : p.source)}</span></div>`).join('')}
        </details>
        <div class="actions" style="margin-top:10px">${d.ouverte ? `<button class="principal" data-action="deposer" data-type="${d.type}">Faire la démarche</button>` : '<span class="badge">Non ouverte à votre statut</span>'}</div>
      </div>`).join('')}</div>
    <div class="carte"><h2>Ce que l'administration détient déjà depuis votre recrutement</h2>
      <p class="doux petit">Pièces du dossier de recrutement (loi 2015-18, art. 13), versées au dossier individuel : elles ne vous seront plus demandées.</p>
      <p>${etat.ref.pieces_recrutement.map((p) => `<span class="badge" style="margin:2px">${esc(p)}</span>`).join(' ')}</p></div>
    <div class="carte tableau"><h2>Mes demandes</h2>${tableDemandes(miennes, false)}</div>`;
}

async function vueDemandes() {
  const liste = await api('/api/demandes');
  return `<div class="entete"><div><h1>Demandes des agents</h1><p class="doux">${liste.filter((d) => d.statut === 'DEPOSEE').length} à traiter</p></div></div>
    <div class="carte tableau" style="padding:0">${tableDemandes(liste, true)}</div>`;
}

async function vueActes() {
  const liste = await api('/api/actes');
  return `<div class="entete"><div><h1>Actes générés</h1><p class="doux">Chaque acte porte un code de vérification publique.</p></div></div>
    <div class="carte tableau" style="padding:0"><table><thead><tr><th>Numéro</th><th>Objet</th><th>Agent</th><th>Signé le</th><th>Signataire</th></tr></thead><tbody>
    ${liste.map((t) => `<tr class="lien" data-lien="#/actes/${t.id}"><td class="code">${esc(t.numero)}</td><td>${esc(t.objet)}</td><td>${esc(t.prenoms)} ${esc(t.nom)}</td><td>${date(t.date_signature)}</td><td>${esc(t.signataire)}</td></tr>`).join('')
      || '<tr><td colspan="5" class="vide">Aucun acte pour l\'instant. Instruisez puis signez une proposition, ou demandez une attestation.</td></tr>'}
    </tbody></table></div>`;
}

async function vueActe(id) {
  const t = await api(`/api/actes/${id}`);
  const a = t.agent, c = t.contenu;
  const titres = { AVANCEMENT_ECHELON: "Arrêté portant avancement d'échelon", AVENANT: 'Avenant au contrat de travail', AVANCEMENT_GRADE: 'Arrêté portant avancement de grade',
    TITULARISATION: 'Arrêté portant titularisation', DEPART_RETRAITE: "Arrêté portant admission à la retraite", ATTESTATION: 'Attestation de service',
    DISPONIBILITE: 'Arrêté portant mise en disponibilité', DETACHEMENT: 'Arrêté portant détachement', MUTATION: 'Note de service portant mutation' };
  // Adresse publique de production ; le lien local permet de tester la vérification dans le prototype.
  const lien = `https://macarriere.bj/verifier?code=${t.code_verification}`;
  const lienLocal = `#/verifier?code=${t.code_verification}`;
  return `
    <div class="actions pas-imprimer" style="margin-bottom:12px"><a class="bouton" href="javascript:history.back()">← Retour</a><button data-action="imprimer">Imprimer / PDF</button></div>
    <article class="acte">
      <div class="filigrane">DOCUMENT DE DÉMONSTRATION, SANS VALEUR JURIDIQUE</div>
      <p style="margin-top:16px">Administration (démonstration)<br>Direction des ressources humaines</p>
      <p>N° ${esc(t.numero)}</p>
      <h1>${esc(titres[t.type] ?? t.type)}</h1>
      <p><strong>Objet :</strong> ${esc(t.objet)}</p>
      <p><strong>Agent :</strong> ${esc(a.prenoms)} ${esc(a.nom)}, matricule ${esc(a.matricule)}, ${esc(a.corps)} (${esc(statutAgent(a))}), en service à ${esc(a.structure)}.</p>
      ${c.situation_avant ? `<p><strong>Situation antérieure :</strong> ${esc(c.situation_avant)}, indice ${esc(c.indice_avant)}.</p>` : ''}
      ${c.etapes ? `<p><strong>Dispositif :</strong></p><ul>${c.etapes.map((e) => `<li>${a.statut === 'APE' ? 'Échelon' : 'Palier'} ${e.echelon} à compter du ${date(e.date_effet)} (indice ${e.indice})</li>`).join('')}</ul>
        ${c.rappel_estime ? `<p>Le présent acte emporte un rappel de solde estimé à ${fcfa(c.rappel_estime)}, transmis au service de la solde.</p>` : ''}` : ''}
      ${c.grade_vers ? `<p><strong>Dispositif :</strong> promu au grade ${c.grade_vers}, échelon ${c.vers}, à compter du ${date(c.date_effet)}.</p>` : ''}
      ${t.type === 'ATTESTATION' ? `<p>Il est attesté que l'intéressé(e), en service depuis le ${date(c.prise_service)}, est en activité à ${esc(c.structure)}, en situation ${esc(c.situation)}.</p>` : ''}
      ${['TITULARISATION', 'DEPART_RETRAITE'].includes(t.type) ? `<p><strong>Date d'effet :</strong> ${date(c.date_effet)}.</p>` : ''}
      ${c.motif ? `<p><strong>Motif :</strong> ${esc(c.motif)}</p>` : ''}
      <p style="margin-top:28px;text-align:right">Fait le ${date(t.date_signature)}<br><strong>${esc(t.signataire)}</strong></p>
      <div class="verif">Acte généré par Ma Carrière BJ. Authenticité vérifiable avec le code <span class="code">${esc(t.code_verification)}</span><br>${esc(lien)}
        <a class="pas-imprimer" href="${lienLocal}">(vérifier dans le prototype)</a></div>
    </article>`;
}

async function vueVerifier() {
  const code = new URLSearchParams(location.hash.split('?')[1] ?? '').get('code') ?? '';
  let resultat = '';
  if (code) {
    const r = await api(`/api/verifier/${encodeURIComponent(code)}`);
    resultat = r.authentique
      ? `<div class="carte" style="border-color:var(--ok)"><span class="badge b-ok">Acte authentique</span><p style="margin-top:8px"><strong>${esc(r.numero)}</strong> : ${esc(r.objet)}</p>
        <p class="doux">Agent : ${esc(r.agent)} (${esc(r.matricule)}) · signé le ${date(r.date_signature)} par ${esc(r.signataire)}</p></div>`
      : '<div class="carte" style="border-color:var(--danger)"><span class="badge b-danger">Aucun acte ne correspond à ce code</span></div>';
  }
  return `<div class="entete"><div><h1>Vérifier un acte</h1><p class="doux">Service public de macarriere.bj, sans connexion : saisissez le code figurant au bas de l'acte.</p></div></div>
    <form class="filtres" data-form="verifier"><input name="code" value="${esc(code)}" placeholder="Code de vérification" required><button class="principal">Vérifier</button></form>${resultat}`;
}

async function vueRegles() {
  const regles = await api('/api/regles');
  const admin = etat.user.role === 'admin';
  const groupes = [...new Set(regles.map((r) => r.groupe))];
  const champ = (r) => typeof r.valeur === 'number'
    ? `<input type="number" step="any" name="valeur" value="${r.valeur}" ${admin ? '' : 'disabled'} style="width:120px">`
    : `<textarea name="valeur" ${admin ? '' : 'disabled'} style="font-family:ui-monospace,Consolas,monospace;font-size:12px">${esc(JSON.stringify(r.valeur))}</textarea>`;
  return `<div class="entete"><div><h1>Règles statutaires</h1>
      <p class="doux">Les durées et seuils ne sont pas écrits dans le code : ils se modifient ici quand les textes changent. ${admin ? '' : "Modification réservée à l'administrateur."}</p></div>
      ${admin ? '<div class="actions"><button class="danger" data-action="reinitialiser">Réinitialiser les données de démonstration</button></div>' : ''}</div>
    ${groupes.map((g) => `<div class="carte"><h2>${esc(g)}</h2>${regles.filter((r) => r.groupe === g).map((r) => `
      <form class="champ" data-form="regle" data-cle="${r.cle}" data-type="${typeof r.valeur}"><label>${esc(r.libelle)} <span class="code">${esc(r.cle)}</span></label>
        <div class="actions" style="align-items:flex-start;flex-wrap:nowrap">${champ(r)}${admin ? '<button>Enregistrer</button>' : ''}</div></form>`).join('')}</div>`).join('')}`;
}

const STATUTS_INSC = { EN_ATTENTE: ['À vérifier', 'b-alerte'], VALIDEE: ['Compte activé', 'b-ok'], REJETEE: ['Rejetée', 'b-danger'] };
const badgeInsc = (s) => `<span class="badge ${STATUTS_INSC[s][1]}">${STATUTS_INSC[s][0]}</span>`;

async function vueInscriptions() {
  const q = new URLSearchParams(location.hash.split('?')[1] ?? '');
  const statut = q.get('statut') ?? 'EN_ATTENTE';
  const liste = await api(`/api/inscriptions?statut=${statut}`);
  const filtres = [['EN_ATTENTE', 'À vérifier'], ['VALIDEE', 'Comptes activés'], ['REJETEE', 'Rejetées'], ['TOUS', 'Toutes']];
  return `
    <div class="entete"><div><h1>Inscriptions en ligne</h1>
      <p class="doux">Chaque demande est rapprochée du dossier RH ; le compte n'est activé qu'après vérification des justificatifs.</p></div></div>
    <div class="onglets">${filtres.map(([k, t]) => `<a class="onglet-lien ${statut === k ? 'actif' : ''}" href="#/inscriptions?statut=${k}">${t}</a>`).join('')}</div>
    <div class="carte tableau" style="padding:0"><table><thead><tr><th>Demande</th><th>Demandeur</th><th>Secteur</th><th>Emploi et affectation</th><th>Pièces</th><th>Statut</th></tr></thead><tbody>
      ${liste.map((i) => `<tr class="lien" data-lien="#/inscriptions/${i.id}"><td class="code">${esc(i.numero)}<div class="doux petit">${date(i.depose_le)}</div></td>
        <td><strong>${esc(i.nom)}</strong> ${esc(i.prenoms)}<div class="doux petit">Matricule ${esc(i.matricule)}</div></td><td>${esc(i.secteur)}</td>
        <td>${esc(i.emploi)}<div class="doux petit">${esc(i.structure)} · ${esc(i.ministere)}</div></td><td>${i.nb_justificatifs}</td><td>${badgeInsc(i.statut)}</td></tr>`).join('')
        || '<tr><td colspan="6" class="vide">Aucune demande dans cette liste.</td></tr>'}
    </tbody></table></div>`;
}

async function vueInscription(id) {
  const i = await api(`/api/inscriptions/${id}`);
  const c = i.correspondance;
  const bloquants = c.controles.filter((x) => !x.ok).length;
  const peutTraiter = ['gestionnaire', 'drh'].includes(etat.user.role) && i.statut === 'EN_ATTENTE';
  return `
    <div class="entete"><div><p class="doux petit"><a href="#/inscriptions">← Inscriptions</a></p>
      <h1>Demande ${esc(i.numero)}</h1><p class="doux">Déposée le ${date(i.depose_le)} · ${esc(i.secteur_libelle)}</p></div>
      <div>${badgeInsc(i.statut)}</div></div>
    <div class="grille g2">
      <div class="carte"><h2>Déclaration du demandeur</h2>
        <div class="identite">
          <div><span>Nom et prénoms</span><strong>${esc(i.nom)} ${esc(i.prenoms)}</strong></div>
          <div><span>Date de naissance</span><strong>${date(i.date_naissance)}</strong></div>
          <div><span>NPI</span><strong>${esc(i.npi)}</strong></div>
          <div><span>Matricule</span><strong>${esc(i.matricule)}</strong></div>
          <div><span>Statut</span><strong>${esc(i.statut_agent_libelle)}</strong></div>
          <div><span>Emploi</span><strong>${esc(i.emploi)}</strong></div>
          <div><span>Affectation</span><strong>${esc(i.structure)}</strong></div>
          <div><span>Ministère</span><strong>${esc(i.ministere)}</strong></div>
          <div><span>Téléphone</span><strong>+229 ${esc(i.telephone.replace(/(\d{2})(?=\d)/g, '$1 '))}</strong></div>
          ${i.email ? `<div><span>E-mail</span><strong>${esc(i.email)}</strong></div>` : ''}
        </div></div>
      <div class="carte"><h2>Rapprochement avec la base RH</h2>
        <ul class="controles">${c.controles.map((x) => `<li class="${x.ok ? 'ok' : 'ko'}"><span aria-hidden="true">${x.ok ? '✓' : '✗'}</span>${esc(x.libelle)}<span class="visuellement-masque">${x.ok ? ' : vérifié' : ' : non vérifié'}</span></li>`).join('')}</ul>
        ${c.dossier ? `<p class="doux petit">Dossier trouvé : ${esc(c.dossier.nom)}, ${esc(c.dossier.corps)}, matricule ${esc(c.dossier.matricule)}.</p>`
          : '<p class="doux petit">Aucun dossier RH ne correspond : l\'agent doit d\'abord être enregistré dans le système de gestion du personnel (SIGRH).</p>'}
      </div>
    </div>
    <div class="carte"><h2>Justificatifs (${i.justificatifs.length})</h2>
      ${i.justificatifs.map((j) => `<div class="piece"><span><strong>${esc(j.libelle)}</strong><br><span class="doux petit">${esc(j.nom_fichier)} · ${j.mime === 'application/pdf' ? 'PDF' : j.mime === 'image/png' ? 'PNG' : 'JPEG'} · ${taille(j.taille)}</span></span>
        <button data-action="voir-justif" data-url="/api/inscriptions/${i.id}/justificatifs/${j.id}" data-titre="${esc(j.libelle)}" data-mime="${j.mime}">Consulter</button></div>`).join('')}
    </div>
    ${i.statut !== 'EN_ATTENTE' ? `<div class="carte"><p>${i.statut === 'VALIDEE' ? 'Compte activé' : 'Demande rejetée'} le ${date(i.traite_le)} par ${esc(i.traite_par)}.${i.motif ? ` Motif : ${esc(i.motif)}` : ''}</p>
      ${i.agent_id ? `<a href="#/agents/${i.agent_id}">Voir le dossier de l'agent →</a>` : ''}</div>` : ''}
    ${peutTraiter ? `<div class="carte"><h2>Décision</h2>
      ${bloquants ? `<p class="doux">${bloquants} contrôle(s) non vérifié(s) : la validation est impossible. Rejetez la demande en indiquant le motif au demandeur.</p>`
        : '<p class="doux">Tous les contrôles sont vérifiés. Après lecture des justificatifs, activez le compte : l\'agent pourra se connecter et ses justificatifs rejoindront son coffre-fort.</p>'}
      <div class="actions"><button class="principal" data-action="valider-insc" data-id="${i.id}" ${bloquants ? 'disabled' : ''}>Valider et activer le compte</button>
        <button class="danger" data-action="rejeter-insc" data-id="${i.id}">Rejeter la demande</button></div></div>` : ''}`;
}

// Affiche un justificatif dans une fenêtre, sans le télécharger (session requise).
async function visionneuse(titre, url, mime) {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${etat.jeton}` } });
  if (!res.ok) throw new Error('Document indisponible');
  const contenu = await res.blob();
  mime = mime || contenu.type;
  const lien = URL.createObjectURL(contenu);
  const m = document.getElementById('modale');
  m.innerHTML = `<div class="boite boite-large" role="dialog" aria-modal="true" aria-label="${esc(titre)}">
    <div class="entete" style="margin-bottom:12px"><h2 style="margin:0">${esc(titre)}</h2><button type="button" data-fermer>Fermer</button></div>
    ${mime === 'application/pdf' ? `<iframe class="apercu" src="${lien}" title="${esc(titre)}"></iframe>` : `<img class="apercu" src="${lien}" alt="${esc(titre)}">`}</div>`;
  m.hidden = false;
  m.querySelector('[data-fermer]').onclick = () => { m.hidden = true; m.innerHTML = ''; URL.revokeObjectURL(lien); };
  m.querySelector('[data-fermer]').focus();
}

// Mesure de la simplification : indicateurs publics, recalculés à chaque affichage.
async function vueImpact() {
  const m = await api('/api/impact');
  const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);
  const tuile = (valeur, titre, detail, accent = false) => `<div class="kpi ${accent ? 'kpi-accent' : ''}"><div class="titre">${titre}</div><div class="valeur">${valeur}</div><div class="doux petit">${detail}</div></div>`;
  return `
    <div class="entete"><div><p class="surtitre-vert">Transparence</p><h1>Mesure de la simplification</h1>
      <p class="doux">Ce que la plateforme épargne aux agents de l'État, calculé en temps réel sur ${nombre(m.agents)} dossiers de ${m.secteurs} secteurs. Chiffres agrégés, sans aucune donnée personnelle.</p></div></div>
    <div class="kpis">
      ${tuile(`${pct(m.pieces.evitees, m.pieces.total)} %`, "Pièces retrouvées par l'administration", `${nombre(m.pieces.evitees)} pièces sur ${nombre(m.pieces.total)} exigées par les démarches ne sont plus demandées aux agents`, true)}
      ${tuile(nombre(m.droits_detectes), "Droits détectés d'office", 'avancements, avenants, titularisations et départs proposés sans réclamation')}
      ${tuile(nombre(m.retards_rattrapes), 'Retards rattrapés', `rappel de solde calculé : ${fcfa(m.rappel_estime)}`)}
      ${tuile(nombre(m.demarches_en_ligne), 'Démarches faites en ligne', 'autant de déplacements évités')}
      ${tuile(nombre(m.attestations_immediates), 'Attestations immédiates', 'délivrées sans pièce ni attente')}
      ${tuile(m.delai_moyen_jours === null ? '-' : `${m.delai_moyen_jours} j`, 'Délai de signature', `entre la détection d'un droit et la signature de l'acte (${m.actes_signes} acte(s))`)}
      ${tuile(`${m.notation.cloturees}/${m.notation.total}`, `Notation ${m.notation.annee}`, 'fiches clôturées dans le calendrier légal')}
      ${tuile(nombre(m.notifications), 'Notifications envoyées', "l'agent est informé sans avoir à se renseigner")}
    </div>
    <div class="carte"><h2>Comment ces chiffres sont calculés</h2>
      <ul class="liste-methode">
        <li><strong>Pièces retrouvées :</strong> pour chaque agent et chaque démarche, chaque pièce exigée est rapprochée de sa source (registre d'identité via le NPI, dossier individuel, coffre-fort, solde). Seules les pièces sans source restent à fournir.</li>
        <li><strong>Droits détectés :</strong> propositions du moteur de règles qui applique le statut général de la fonction publique à tous les dossiers.</li>
        <li><strong>Retards et rappels :</strong> pour chaque échelon dû en retard, gain d'indice multiplié par le nombre de mois de retard et la valeur du point (estimation).</li>
        <li><strong>Délai de signature :</strong> moyenne, en jours, entre la proposition du moteur et la signature de l'acte par le DRH.</li>
      </ul>
      <p class="doux petit">Prototype : données fictives. En production, ces indicateurs serviront au suivi du pilote et à la redevabilité, dans l'esprit du Partenariat pour un Gouvernement Ouvert.</p></div>`;
}

async function vueNotifications() {
  const liste = await api('/api/notifications');
  if (liste.some((n) => !n.lu)) {
    await api('/api/notifications/lues', { method: 'POST' });
    etat.nonLues = 0;
    dessinerMenu();
  }
  return `<div class="entete"><div><h1>Notifications</h1>
      <p class="doux">L'administration vous informe à chaque étape, sans que vous ayez à vous renseigner. En production, chaque message part aussi par SMS.</p></div></div>
    <div class="carte">${liste.length ? `<ul class="notifications">${liste.map((n) => `
      <li class="${n.lu ? '' : 'non-lue'}"><div class="notif-entete"><strong>${esc(n.titre)}</strong>${n.lu ? '' : '<span class="badge b-alerte">Nouveau</span>'}</div>
        <p>${esc(n.message)}</p><time class="doux petit">${new Date(n.horodatage).toLocaleString('fr-FR')}</time></li>`).join('')}</ul>`
      : '<p class="vide">Aucune notification pour le moment. Vous serez prévenu dès qu\'un droit vous concernant sera détecté.</p>'}</div>`;
}

async function vueJournal() {
  const lignes = await api('/api/audit');
  return `<div class="entete"><div><h1>Journal d'audit</h1><p class="doux">Qui a fait quoi, et quand. 200 dernières entrées.</p></div></div>
    <div class="carte tableau" style="padding:0"><table><thead><tr><th>Date</th><th>Utilisateur</th><th>Action</th><th>Détail</th></tr></thead><tbody>
    ${lignes.map((l) => `<tr><td>${new Date(l.horodatage).toLocaleString('fr-FR')}</td><td>${esc(l.utilisateur)}</td><td>${esc(l.action)}</td><td class="doux">${esc(l.cible ?? '')}</td></tr>`).join('') || '<tr><td colspan="4" class="vide">Journal vide</td></tr>'}
    </tbody></table></div>`;
}

// --- Espace public : connexion et vérification d'un acte ---

const IDENTIFIANTS = {
  npi: {
    court: 'NPI', libelle: "Numéro personnel d'identification (NPI)", placeholder: '10 chiffres', mode: 'numeric', max: 10,
    aide: "Il figure sur votre carte d'identité biométrique ou votre certificat d'identification personnelle (CIP).",
  },
  matricule: {
    court: 'Matricule', libelle: 'Matricule', placeholder: 'Ex. 345489 ou C201234', mode: 'text', max: 12,
    aide: 'Il figure sur votre bulletin de solde, votre arrêté de nomination ou votre contrat.',
  },
  telephone: {
    court: 'Téléphone', libelle: 'Numéro de téléphone', placeholder: '01 XX XX XX XX', mode: 'tel', max: 14,
    aide: 'Le numéro déclaré dans votre dossier administratif.',
  },
};
etat.typeIdentifiant = 'npi';

function coquillePublique(contenu) {
  return `
    <header class="pub-entete">
      <a class="pub-marque" href="#/"><span class="logo" aria-hidden="true">MC</span>
        <span><strong>Ma Carrière BJ</strong><small>Plateforme de gestion des carrières des agents de l'État</small></span></a>
      <nav class="pub-nav" aria-label="Liens utiles"><a href="#/">Connexion</a><a href="#/inscription">Créer un compte</a><a href="#/verifier">Vérifier un acte</a><a href="#/impact">Mesure de la simplification</a></nav>
    </header>
    <main class="pub-contenu" id="pub-contenu" tabindex="-1">${contenu}</main>
    <footer class="pub-pied">
      <div><strong>Ma Carrière BJ</strong> · macarriere.bj · Agents de l'État de tous les secteurs</div>
      <div class="doux">Assistance : votre service du personnel · Vos données sont protégées conformément au code du numérique.</div>
    </footer>`;
}

function pageConnexion() {
  const demo = etat.demo?.comptes?.length ? `
    <details class="demo">
      <summary>Comptes de démonstration</summary>
      <p class="doux petit">Prototype uniquement : un clic vous connecte avec ce compte.</p>
      ${etat.demo.comptes.map((c) => {
        const [type, valeur] = c.npi ? ['npi', c.npi] : ['matricule', c.matricule];
        return `<button type="button" class="compte-demo" data-action="demo" data-type="${type}" data-valeur="${esc(valeur)}">
          <strong>${esc(c.nom)}</strong><span>${esc(ROLES[c.role])} · ${esc(IDENTIFIANTS[type].court)} ${esc(valeur)}</span></button>`;
      }).join('')}
    </details>` : '';
  return `
    <div class="connexion">
      <section class="connexion-intro">
        <p class="surtitre">Tous les agents de l'État</p>
        <h1>Votre carrière, suivie sans déplacement</h1>
        <p>Consultez votre situation administrative, remplissez votre notation annuelle et faites vos démarches en ligne.</p>
        <ul class="atouts">
          <li><strong>Avancements détectés automatiquement</strong><span>Plus besoin de réclamer un échelon dû.</span></li>
          <li><strong>Notation annuelle en ligne</strong><span>Objectifs, auto-évaluation et recours au même endroit.</span></li>
          <li><strong>Aucune pièce redemandée</strong><span>Ce que l'administration détient déjà ne vous est plus réclamé.</span></li>
        </ul>
      </section>
      <section class="connexion-carte" aria-labelledby="titre-connexion">
        <h2 id="titre-connexion">Connexion à votre espace</h2>
        <form id="form-connexion" novalidate>
          <fieldset class="choix-id">
            <legend>Se connecter avec</legend>
            <div class="segments">${Object.entries(IDENTIFIANTS).map(([k, v]) => `<label><input type="radio" name="type" value="${k}" ${k === etat.typeIdentifiant ? 'checked' : ''}><span>${v.court}</span></label>`).join('')}</div>
          </fieldset>
          <div class="champ">
            <label for="identifiant" id="lib-identifiant"></label>
            <div class="saisie"><span class="prefixe" id="prefixe" hidden>+229</span>
              <input id="identifiant" name="identifiant" required autocomplete="username" aria-describedby="aide-identifiant"></div>
            <p class="aide" id="aide-identifiant"></p>
          </div>
          <div class="champ">
            <div class="ligne-label"><label for="mdp">Mot de passe</label><a href="#" data-action="mdp-oublie">Mot de passe oublié ?</a></div>
            <div class="saisie"><input id="mdp" name="mot_de_passe" type="password" required autocomplete="current-password">
              <button type="button" class="oeil" data-action="voir-mdp" aria-pressed="false" aria-controls="mdp">Afficher</button></div>
          </div>
          <p class="erreur-connexion" id="erreur-connexion" role="alert"></p>
          <button class="principal large" id="btn-connexion">Se connecter</button>
        </form>
        <p class="securite">Connexion sécurisée. Ne communiquez jamais votre mot de passe, même à un agent de l'administration.</p>
        <div class="nouveau-compte"><div><strong>Pas encore de compte ?</strong><span>Inscrivez-vous avec votre NPI, votre matricule et vos justificatifs d'emploi.</span></div><a class="bouton" href="#/inscription">Créer mon compte</a></div>
        <p class="doux petit">Inscription en cours de vérification ? <a href="#/inscription/suivi">Suivre ma demande</a>.</p>
        ${demo}
      </section>
    </div>`;
}

// Adapte le champ identifiant au type choisi (libellé, clavier mobile, préfixe +229).
function majIdentifiant(type) {
  etat.typeIdentifiant = type;
  const def = IDENTIFIANTS[type];
  const input = document.getElementById('identifiant');
  if (!input) return;
  document.getElementById('lib-identifiant').textContent = def.libelle;
  document.getElementById('aide-identifiant').textContent = def.aide;
  document.getElementById('prefixe').hidden = type !== 'telephone';
  Object.assign(input, { placeholder: def.placeholder, inputMode: def.mode, maxLength: def.max, value: '' });
  input.autocomplete = type === 'telephone' ? 'tel-national' : 'username';
  input.removeAttribute('aria-invalid');
  document.getElementById('erreur-connexion').textContent = '';
}

async function afficherPublic() {
  montrer(false);
  const zone = document.getElementById('public');
  const route = location.hash.split('?')[0];
  const page = route.startsWith('#/impact') ? 'impact'
    : route.startsWith('#/verifier') ? 'verifier'
    : route.startsWith('#/inscription/suivi') ? 'suivi'
    : route.startsWith('#/inscription') ? 'inscription' : 'connexion';
  try {
    let contenu;
    if (page === 'verifier') contenu = `<div class="pub-etroit">${await vueVerifier()}</div>`;
    else if (page === 'suivi') contenu = await pageSuivi();
    else if (page === 'impact') contenu = `<div class="pub-large">${await vueImpact()}</div>`;
    else if (page === 'inscription') contenu = await pageInscription();
    else {
      if (!etat.demo) {
        try { etat.demo = await api('/api/comptes-demo'); } catch { etat.demo = { comptes: [] }; }
      }
      contenu = pageConnexion();
    }
    zone.innerHTML = coquillePublique(contenu);
  } catch (e) {
    zone.innerHTML = coquillePublique(`<div class="carte">${esc(e.message)}</div>`);
  }
  if (page === 'connexion') {
    majIdentifiant(etat.typeIdentifiant);
    document.getElementById('identifiant').focus();
  } else {
    window.scrollTo(0, 0);
  }
}

// --- Inscription en ligne : secteur, identité et emploi, justificatifs, mot de passe ---

const ETAPES_INSCRIPTION = ['Secteur', 'Identité et emploi', 'Justificatifs', 'Mot de passe et envoi'];
const nouvelleInscription = () => ({ etape: 1, donnees: {}, fichiers: {}, erreur: '', resultat: null });
etat.insc = nouvelleInscription();
const taille = (o) => (o < 1024 * 1024 ? `${Math.max(1, Math.round(o / 1024))} Ko` : `${(o / 1024 / 1024).toFixed(1).replace(/\.0$/, '').replace('.', ',')} Mo`);

async function pageInscription() {
  etat.inscParams ??= await api('/api/inscription/parametres');
  const P = etat.inscParams, I = etat.insc, d = I.donnees;
  if (I.resultat) return pageInscriptionEnvoyee();
  const val = (k) => esc(d[k] ?? '');
  const secteurChoisi = P.secteurs.find((s) => s.code === d.secteur);
  const etapes = `<ol class="etapes-insc" aria-label="Étapes de l'inscription">${ETAPES_INSCRIPTION.map((t, i) =>
    `<li class="${i + 1 < I.etape ? 'fait' : i + 1 === I.etape ? 'courant' : ''}" ${i + 1 === I.etape ? 'aria-current="step"' : ''}><span>${i + 1}</span>${t}</li>`).join('')}</ol>`;
  let corps = '';
  if (I.etape === 1) {
    corps = `
      <h2>Quel est votre secteur d'activité ?</h2>
      <p class="doux">Ma Carrière BJ est ouverte à tous les agents de l'État. Votre demande sera vérifiée par le service du personnel de votre secteur.</p>
      <div class="grille-secteurs" role="radiogroup" aria-label="Secteur d'activité">
        ${P.secteurs.map((s) => `<label class="carte-secteur"><input type="radio" name="secteur" value="${s.code}" ${d.secteur === s.code ? 'checked' : ''} required><span>${esc(s.libelle)}</span></label>`).join('')}
      </div>`;
  } else if (I.etape === 2) {
    corps = `
      <h2>Identité et emploi</h2>
      <p class="doux">Secteur : <strong>${esc(secteurChoisi?.libelle)}</strong> · <a href="#" data-action="insc-etape" data-etape="1">modifier</a></p>
      <fieldset class="bloc-form"><legend>Identité</legend>
        <div class="grille-champs">
          <div class="champ"><label for="i-npi">NPI *</label><input id="i-npi" name="npi" value="${val('npi')}" inputmode="numeric" maxlength="10" required placeholder="10 chiffres" autocomplete="off"><p class="aide">Votre identité sera rapprochée du registre national (RNPP).</p></div>
          <div class="champ"><label for="i-naissance">Date de naissance *</label><input id="i-naissance" name="date_naissance" type="date" value="${val('date_naissance')}" required autocomplete="bday"></div>
          <div class="champ"><label for="i-nom">Nom *</label><input id="i-nom" name="nom" value="${val('nom')}" required autocomplete="family-name"></div>
          <div class="champ"><label for="i-prenoms">Prénoms *</label><input id="i-prenoms" name="prenoms" value="${val('prenoms')}" required autocomplete="given-name"></div>
          <div class="champ"><label for="i-tel">Téléphone *</label><div class="saisie"><span class="prefixe">+229</span><input id="i-tel" name="telephone" value="${val('telephone')}" inputmode="tel" maxlength="14" required placeholder="01 XX XX XX XX" autocomplete="tel-national"></div><p class="aide">Pour recevoir la réponse par SMS.</p></div>
          <div class="champ"><label for="i-email">E-mail (facultatif)</label><input id="i-email" name="email" type="email" value="${val('email')}" autocomplete="email"></div>
        </div>
      </fieldset>
      <fieldset class="bloc-form"><legend>Emploi</legend>
        <div class="grille-champs">
          <div class="champ"><label for="i-matricule">Matricule *</label><input id="i-matricule" name="matricule" value="${val('matricule')}" required placeholder="Ex. 511788 ou C201234"></div>
          <div class="champ"><label for="i-statut">Statut *</label><select id="i-statut" name="statut_agent" required><option value="">Choisir…</option>
            ${Object.entries(P.statuts).map(([k, v]) => `<option value="${k}" ${d.statut_agent === k ? 'selected' : ''}>${esc(v)}</option>`).join('')}</select></div>
          <div class="champ"><label for="i-ministere">Ministère ou institution *</label><input id="i-ministere" name="ministere" value="${val('ministere')}" required></div>
          <div class="champ"><label for="i-structure">Structure d'affectation *</label><input id="i-structure" name="structure" value="${val('structure')}" required placeholder="Direction, service, établissement…"></div>
          <div class="champ"><label for="i-emploi">Emploi ou corps *</label><input id="i-emploi" name="emploi" value="${val('emploi')}" required placeholder="Ex. Contrôleur des impôts"></div>
        </div>
      </fieldset>`;
  } else if (I.etape === 3) {
    corps = `
      <h2>Justificatifs d'emploi public</h2>
      <p class="doux">PDF, JPEG ou PNG, ${taille(P.taille_max)} au plus par fichier. Après vérification, ils sont rangés dans votre coffre-fort numérique : ils ne vous seront plus demandés.</p>
      ${P.justificatifs.map((j) => {
        const f = I.fichiers[j.type];
        return `<div class="piece-insc ${f ? 'jointe' : ''}">
          <div><strong>${esc(j.libelle)}</strong> ${j.obligatoire ? '<span class="badge b-alerte">Obligatoire</span>' : '<span class="badge">Facultatif</span>'}
            ${f ? `<p class="doux petit">${esc(f.nom)} · ${taille(f.taille)}</p>` : ''}</div>
          <div class="actions">
            <label class="bouton ${f ? '' : 'principal'}">${f ? 'Remplacer' : 'Choisir un fichier'}<input type="file" class="masque" data-justificatif="${j.type}" accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png"></label>
            ${f ? `<button type="button" class="danger" data-action="insc-retirer" data-type="${j.type}">Retirer</button>` : ''}
          </div></div>`;
      }).join('')}`;
  } else {
    corps = `
      <h2>Mot de passe et envoi</h2>
      <div class="grille-champs">
        <div class="champ"><label for="i-mdp">Mot de passe *</label><div class="saisie"><input id="i-mdp" name="mot_de_passe" type="password" required autocomplete="new-password" minlength="10"></div>
          <p class="aide">Au moins 10 caractères, dont des lettres et des chiffres.</p></div>
        <div class="champ"><label for="i-mdp2">Confirmation *</label><div class="saisie"><input id="i-mdp2" name="confirmation" type="password" required autocomplete="new-password"></div></div>
      </div>
      <div class="recap">
        <h3>Récapitulatif de votre demande</h3>
        <dl>
          <dt>Secteur</dt><dd>${esc(secteurChoisi?.libelle)}</dd>
          <dt>Agent</dt><dd>${esc(d.prenoms)} ${esc((d.nom ?? '').toUpperCase())}, né(e) le ${date(d.date_naissance)}</dd>
          <dt>NPI · matricule</dt><dd>${esc(d.npi)} · ${esc(d.matricule)}</dd>
          <dt>Emploi</dt><dd>${esc(d.emploi)}, ${esc(d.structure)} (${esc(d.ministere)})</dd>
          <dt>Statut</dt><dd>${esc(P.statuts[d.statut_agent])}</dd>
          <dt>Justificatifs</dt><dd>${Object.values(I.fichiers).map((f) => esc(f.nom)).join(', ')}</dd>
        </dl>
      </div>
      <label class="consentement"><input type="checkbox" name="certifie" required> Je certifie sur l'honneur l'exactitude des informations et l'authenticité des justificatifs fournis. Toute fausse déclaration expose à des sanctions disciplinaires et pénales.</label>
      <label class="consentement"><input type="checkbox" name="donnees" required> J'accepte que mes données soient traitées pour vérifier ma qualité d'agent de l'État et gérer ma carrière, conformément au code du numérique.</label>`;
  }
  return `
    <div class="inscription">
      <div class="entete-insc"><h1>Créer mon compte</h1><p class="doux">Déjà inscrit ? <a href="#/">Se connecter</a></p></div>
      ${etapes}
      <form id="form-inscription" class="carte carte-insc" novalidate data-etape="${I.etape}">
        ${corps}
        <p class="erreur-connexion" role="alert">${esc(I.erreur)}</p>
        <div class="actions pied-insc">
          ${I.etape > 1 ? `<button type="button" data-action="insc-etape" data-etape="${I.etape - 1}">Retour</button>` : '<span></span>'}
          <button class="principal" id="btn-insc">${I.etape < 4 ? 'Continuer' : 'Envoyer ma demande'}</button>
        </div>
      </form>
    </div>`;
}

function pageInscriptionEnvoyee() {
  const r = etat.insc.resultat;
  return `
    <div class="pub-etroit">
      <div class="carte confirmation">
        <span class="badge b-ok">Demande enregistrée</span>
        <h1>Votre demande d'inscription est en cours de vérification</h1>
        <p>Numéro de demande : <strong class="code">${esc(r.numero)}</strong>. Conservez-le pour suivre votre demande.</p>
        <ol>
          <li>Le service du personnel rapproche votre demande de votre dossier administratif et vérifie vos justificatifs.</li>
          <li>Vous recevez la réponse par SMS au numéro indiqué.</li>
          <li>Une fois le compte activé, connectez-vous avec votre NPI, votre matricule ou votre téléphone et le mot de passe choisi.</li>
        </ol>
        <div class="actions"><a class="bouton principal" href="#/inscription/suivi?numero=${encodeURIComponent(r.numero)}">Suivre ma demande</a><a class="bouton" href="#/" data-action="insc-terminer">Retour à la connexion</a></div>
      </div>
    </div>`;
}

async function pageSuivi() {
  const q = new URLSearchParams(location.hash.split('?')[1] ?? '');
  const numero = q.get('numero') ?? '', npi = etat.suiviNpi ?? '';
  let resultat = '';
  if (numero && npi) {
    try {
      const r = await api(`/api/inscriptions/suivi?numero=${encodeURIComponent(numero)}&npi=${encodeURIComponent(npi)}`);
      const statuts = { EN_ATTENTE: ['En cours de vérification', 'b-alerte'], VALIDEE: ['Compte activé', 'b-ok'], REJETEE: ['Demande rejetée', 'b-danger'] };
      resultat = `<div class="carte"><span class="badge ${statuts[r.statut][1]}">${statuts[r.statut][0]}</span>
        <p style="margin-top:8px">Demande <strong>${esc(r.numero)}</strong> déposée le ${date(r.depose_le)}${r.traite_le ? `, traitée le ${date(r.traite_le)}` : ''}.</p>
        ${r.statut === 'REJETEE' ? `<p><strong>Motif :</strong> ${esc(r.motif)}</p><p><a href="#/inscription" data-action="insc-nouvelle">Déposer une nouvelle demande</a></p>` : ''}
        ${r.statut === 'VALIDEE' ? '<p><a href="#/">Se connecter</a></p>' : ''}</div>`;
    } catch (e) {
      resultat = `<div class="carte"><span class="badge b-danger">${esc(e.message)}</span></div>`;
    }
  }
  return `<div class="pub-etroit"><div class="entete"><div><h1>Suivre ma demande d'inscription</h1>
      <p class="doux">Saisissez le numéro de demande reçu et votre NPI.</p></div></div>
    <form class="carte" data-form="suivi"><div class="grille-champs">
      <div class="champ"><label for="s-numero">Numéro de demande</label><input id="s-numero" name="numero" value="${esc(numero)}" required placeholder="INS-2026-00001"></div>
      <div class="champ"><label for="s-npi">NPI</label><input id="s-npi" name="npi" value="${esc(npi)}" required inputmode="numeric" maxlength="10"></div>
    </div><button class="principal">Consulter</button></form>${resultat}</div>`;
}

// Contrôles de chaque étape avant de passer à la suivante (le serveur refait tous les contrôles).
function controlerEtape(etape, fd) {
  if (etape === 1) return fd.get('secteur') ? '' : "Choisissez votre secteur d'activité.";
  if (etape === 2) {
    for (const [k, nom] of [['npi', 'le NPI'], ['date_naissance', 'la date de naissance'], ['nom', 'le nom'], ['prenoms', 'les prénoms'], ['telephone', 'le téléphone'],
      ['matricule', 'le matricule'], ['statut_agent', 'le statut'], ['ministere', 'le ministère'], ['structure', 'la structure'], ['emploi', "l'emploi"]]) {
      if (!String(fd.get(k) ?? '').trim()) return `Renseignez ${nom}.`;
    }
    if (!/^\d{10}$/.test(fd.get('npi').trim())) return 'Le NPI comporte 10 chiffres.';
    if (fd.get('telephone').replace(/\D/g, '').replace(/^229(?=\d{10}$)/, '').length !== 10) return 'Le téléphone comporte 10 chiffres : 01 XX XX XX XX.';
    return '';
  }
  if (etape === 3) {
    const manque = etat.inscParams.justificatifs.find((j) => j.obligatoire && !etat.insc.fichiers[j.type]);
    return manque ? `Joignez : ${manque.libelle}.` : '';
  }
  const mdp = fd.get('mot_de_passe') ?? '';
  if (mdp.length < 10 || !/[A-Za-z]/.test(mdp) || !/\d/.test(mdp)) return 'Le mot de passe doit comporter au moins 10 caractères, dont des lettres et des chiffres.';
  if (mdp !== fd.get('confirmation')) return 'Les deux mots de passe ne sont pas identiques.';
  if (!fd.get('certifie') || !fd.get('donnees')) return 'Cochez les deux déclarations pour envoyer votre demande.';
  return '';
}

document.addEventListener('submit', async (ev) => {
  if (ev.target.id !== 'form-inscription') return;
  ev.preventDefault();
  const I = etat.insc;
  const fd = new FormData(ev.target);
  if (I.etape !== 4) for (const [k, v] of fd.entries()) if (!(v instanceof File)) I.donnees[k] = v;
  I.erreur = controlerEtape(I.etape, fd);
  if (I.erreur) return afficherPublic();
  if (I.etape < 4) { I.etape += 1; return afficherPublic(); }
  const bouton = document.getElementById('btn-insc');
  bouton.disabled = true;
  bouton.textContent = 'Envoi en cours…';
  try {
    const justificatifs = Object.fromEntries(Object.entries(I.fichiers).map(([k, f]) => [k, { nom: f.nom, contenu: f.contenu }]));
    I.resultat = await api('/api/inscriptions', { method: 'POST', corps: { ...I.donnees, mot_de_passe: fd.get('mot_de_passe'), consentement: true, justificatifs } });
    I.erreur = '';
  } catch (e) {
    I.erreur = e.message;
  }
  afficherPublic();
});

// Lecture d'un justificatif choisi : contrôle du type et de la taille avant envoi.
document.addEventListener('change', (ev) => {
  const type = ev.target.dataset?.justificatif;
  if (!type) return;
  const fichier = ev.target.files[0];
  if (!fichier) return;
  const I = etat.insc;
  if (!['application/pdf', 'image/jpeg', 'image/png'].includes(fichier.type)) { I.erreur = 'Format non accepté : PDF, JPEG ou PNG.'; return afficherPublic(); }
  if (fichier.size > etat.inscParams.taille_max) { I.erreur = `Fichier trop volumineux : ${taille(etat.inscParams.taille_max)} au plus.`; return afficherPublic(); }
  const lecteur = new FileReader();
  lecteur.onload = () => {
    I.fichiers[type] = { nom: fichier.name, taille: fichier.size, contenu: String(lecteur.result).split(',')[1] };
    I.erreur = '';
    afficherPublic();
  };
  lecteur.readAsDataURL(fichier);
});

function montrer(connecte) {
  document.getElementById('app').hidden = !connecte;
  document.getElementById('public').hidden = connecte;
}

async function ouvrirSession(utilisateur) {
  etat.user = utilisateur;
  etat.ref = await api('/api/referentiels');
  etat.onglet = {};
}

function fermerSession() {
  etat.user = null;
  etat.jeton = null;
  stockage.ecrire(null);
}

document.addEventListener('submit', async (ev) => {
  if (ev.target.id !== 'form-connexion') return;
  ev.preventDefault();
  const form = ev.target;
  const input = document.getElementById('identifiant');
  const erreur = document.getElementById('erreur-connexion');
  const type = etat.typeIdentifiant;
  const identifiant = input.value.trim();
  const chiffres = identifiant.replace(/\D/g, '');
  const probleme = !identifiant ? `Saisissez votre ${IDENTIFIANTS[type].court === 'NPI' ? 'NPI' : IDENTIFIANTS[type].libelle.toLowerCase()}.`
    : type === 'npi' && !/^\d{10}$/.test(identifiant) ? 'Le NPI comporte 10 chiffres.'
    : type === 'telephone' && chiffres.length !== 10 ? 'Le numéro comporte 10 chiffres : 01 XX XX XX XX.'
    : !form.mot_de_passe.value ? 'Saisissez votre mot de passe.' : '';
  if (probleme) {
    erreur.textContent = probleme;
    (form.mot_de_passe.value || !identifiant || probleme.includes('chiffres') ? input : form.mot_de_passe).setAttribute('aria-invalid', 'true');
    return;
  }
  const bouton = document.getElementById('btn-connexion');
  bouton.disabled = true;
  bouton.textContent = 'Connexion…';
  erreur.textContent = '';
  try {
    const r = await api('/api/connexion', { method: 'POST', corps: { type, identifiant, mot_de_passe: form.mot_de_passe.value } });
    etat.jeton = r.jeton;
    stockage.ecrire(r.jeton);
    await ouvrirSession(r.utilisateur);
    if (location.hash === '#/' || !location.hash) await afficher();
    else location.hash = '#/';
    toast(`Bienvenue, ${r.utilisateur.nom}.`);
  } catch (e) {
    erreur.textContent = e.message;
    form.mot_de_passe.value = '';
    form.mot_de_passe.focus();
    bouton.disabled = false;
    bouton.textContent = 'Se connecter';
  }
});

// --- Routeur ---

async function afficher() {
  if (!etat.user) return afficherPublic();
  montrer(true);
  if (etat.user.agent_id) {
    try { etat.nonLues = (await api('/api/notifications')).filter((n) => !n.lu).length; } catch { etat.nonLues = 0; }
  }
  dessinerMenu();
  const [chemin] = (location.hash.slice(1) || '/').split('?');
  const p = chemin.split('/').filter(Boolean);
  try {
    let html;
    if (!p.length) html = etat.user.role === 'agent' ? await vueAgent(etat.user.agent_id) : await vueTableauDeBord();
    else if (p[0] === 'moi') html = await vueAgent(etat.user.agent_id);
    else if (p[0] === 'agents') html = p[1] ? await vueAgent(p[1]) : await vueAgents();
    else if (p[0] === 'propositions') html = await vuePropositions();
    else if (p[0] === 'evaluations') html = p[1] ? await vueFiche(p[1]) : await vueEvaluations();
    else if (p[0] === 'demarches') html = await vueDemarches();
    else if (p[0] === 'demandes') html = await vueDemandes();
    else if (p[0] === 'actes') html = p[1] ? await vueActe(p[1]) : await vueActes();
    else if (p[0] === 'verifier') html = await vueVerifier();
    else if (p[0] === 'regles') html = await vueRegles();
    else if (p[0] === 'journal') html = await vueJournal();
    else if (p[0] === 'impact') html = await vueImpact();
    else if (p[0] === 'notifications') html = await vueNotifications();
    else if (p[0] === 'inscriptions') html = p[1] ? await vueInscription(p[1]) : await vueInscriptions();
    else html = '<p class="vide">Page introuvable.</p>';
    if (html) vue.innerHTML = html;
  } catch (e) {
    vue.innerHTML = `<div class="carte"><span class="badge b-danger">Erreur</span><p style="margin-top:8px">${esc(e.message)}</p></div>`;
  }
}

async function recharger(message) {
  if (message) toast(message);
  await afficher();
}

// --- Actions ---

const ACTIONS = {
  async moteur() {
    const r = await api('/api/moteur/executer', { method: 'POST' });
    const n = Object.values(r.propositions).reduce((s, x) => s + x, 0);
    await recharger(`${r.agents} dossiers analysés : ${n} proposition(s) en attente.`);
  },
  async valider(el) {
    const r = await api(`/api/evenements/${el.dataset.id}/valider`, { method: 'POST' });
    await recharger(r.acte ? `Acte n° ${r.acte.numero} signé ; situation de l'agent mise à jour.` : 'Proposition instruite, transmise pour signature.');
  },
  async rejeter(el) {
    const v = await modale('Rejeter la proposition', '<div class="champ"><label>Motif du rejet (obligatoire)</label><textarea name="motif" required></textarea></div>', 'Rejeter');
    if (!v) return;
    await api(`/api/evenements/${el.dataset.id}/rejeter`, { method: 'POST', corps: { motif: v.motif } });
    await recharger('Proposition rejetée.');
  },
  async 'verifier-diplome'(el) {
    await api(`/api/diplomes/${el.dataset.id}/verifier`, { method: 'POST' });
    await recharger('Diplôme vérifié. Il sera pris en compte au prochain passage du moteur.');
  },
  onglet(el) {
    etat.onglet[el.dataset.cle] = el.dataset.val;
    afficher();
  },
  'filtre-prop'(el) {
    const q = new URLSearchParams(location.hash.split('?')[1] ?? '');
    q.set('statut', el.dataset.statut);
    location.hash = `#/propositions?${q}`;
  },
  async viser(el) {
    await api(`/api/evaluations/${el.dataset.id}/viser`, { method: 'POST', corps: { accord: true } });
    await recharger('Fiche visée et clôturée.');
  },
  async contester(el) {
    const v = await modale('Former un recours', '<p class="doux petit">Le recours est soumis à la commission administrative paritaire (avis sous 8 jours).</p><div class="champ"><label>Motif du recours</label><textarea name="motif" required></textarea></div>', 'Envoyer le recours');
    if (!v) return;
    await api(`/api/evaluations/${el.dataset.id}/viser`, { method: 'POST', corps: { accord: false, motif: v.motif } });
    await recharger('Recours enregistré et transmis à la CAP.');
  },
  async commission(el) {
    const v = await modale("Avis de la CAP", `<div class="champ"><label>Note retenue sur 20 (laisser vide pour maintenir)</label><input name="note" type="number" min="0" max="20" step="0.01"></div>
      <div class="champ"><label>Avis motivé</label><textarea name="decision" required></textarea></div>`);
    if (!v) return;
    await api(`/api/evaluations/${el.dataset.id}/commission`, { method: 'POST', corps: v });
    await recharger('Avis de la CAP enregistré ; fiche clôturée.');
  },
  async deposer(el) {
    const d = etat.catalogue.find((x) => x.type === el.dataset.type);
    const aFournir = d.pieces.filter((p) => p.a_fournir);
    const motif = ['DISPONIBILITE', 'DETACHEMENT', 'MUTATION', 'RECLAMATION'].includes(d.type);
    const html = `<p class="compteur">${d.evitees} pièce(s) sur ${d.total} déjà obtenue(s) par l'administration.</p>
      ${motif ? '<div class="champ"><label for="d-motif">Motif</label><textarea id="d-motif" name="motif" required></textarea></div>' : ''}
      ${d.type === 'DECLARATION_DIPLOME' ? `<div class="champ"><label for="d-intitule">Intitulé du diplôme</label><input id="d-intitule" name="intitule" required></div>
        <div class="champ"><label for="d-niveau">Niveau</label><select id="d-niveau" name="niveau"><option value="BAC">Baccalauréat</option><option value="BAC2">Bac + 2</option><option value="LICENCE">Licence</option><option value="MASTER">Master</option><option value="DOCTORAT">Doctorat</option></select></div>
        <div class="champ"><label for="d-date">Date d'obtention</label><input id="d-date" type="date" name="date_obtention" required></div>` : ''}
      ${aFournir.length ? `<h3>Pièces à joindre (une seule fois)</h3><p class="doux petit">PDF, JPEG ou PNG, 2 Mo au plus par fichier.</p>
        ${aFournir.map((p) => `<div class="champ"><label for="f-${p.type}">${esc(p.libelle)}</label>
          <input id="f-${p.type}" type="file" name="fichier_${p.type}" required accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png"></div>`).join('')}`
        : '<p>Aucune pièce à fournir : l\'administration dispose déjà de tout.</p>'}`;
    const r = await modale(d.libelle, html, 'Déposer', async (v) => {
      const fichiers = {};
      for (const p of aFournir) {
        const f = v[`fichier_${p.type}`];
        if (!(f instanceof File) || !f.size) throw new Error(`Joignez : ${p.libelle}.`);
        fichiers[p.type] = await lireEnBase64(f, p.libelle);
      }
      const corps = { type: d.type, motif: v.motif, fichiers };
      if (d.type === 'DECLARATION_DIPLOME') corps.diplome = { intitule: v.intitule, niveau: v.niveau, date_obtention: v.date_obtention };
      return api('/api/demandes', { method: 'POST', corps });
    });
    if (!r) return;
    await recharger(r.statut === 'DELIVREE' ? `${r.reponse} délivrée immédiatement.` : 'Démarche déposée.');
  },
  async accepter(el) {
    await api(`/api/demandes/${el.dataset.id}/traiter`, { method: 'POST', corps: { decision: 'ACCEPTEE' } });
    await recharger('Demande acceptée.');
  },
  async refuser(el) {
    const v = await modale('Rejeter la demande', '<div class="champ"><label>Motif (communiqué à l\'agent)</label><textarea name="reponse" required></textarea></div>', 'Rejeter');
    if (!v) return;
    await api(`/api/demandes/${el.dataset.id}/traiter`, { method: 'POST', corps: { decision: 'REJETEE', reponse: v.reponse } });
    await recharger('Demande rejetée.');
  },
  imprimer() { window.print(); },
  'insc-etape'(el) {
    etat.insc.etape = Number(el.dataset.etape);
    etat.insc.erreur = '';
    afficherPublic();
  },
  'insc-retirer'(el) {
    delete etat.insc.fichiers[el.dataset.type];
    afficherPublic();
  },
  'insc-terminer'() {
    etat.insc = nouvelleInscription();
    location.hash = '#/';
  },
  'insc-nouvelle'() {
    etat.insc = nouvelleInscription();
    if (location.hash === '#/inscription') afficherPublic();
    else location.hash = '#/inscription';
  },
  async 'voir-justif'(el) {
    await visionneuse(el.dataset.titre, el.dataset.url, el.dataset.mime);
  },
  async 'voir-doc'(el) {
    await visionneuse(el.dataset.titre, `/api/documents/${el.dataset.id}`, el.dataset.mime);
  },
  async 'valider-insc'(el) {
    await api(`/api/inscriptions/${el.dataset.id}/valider`, { method: 'POST' });
    await recharger("Compte activé. L'agent peut se connecter ; ses justificatifs sont dans son coffre-fort.");
  },
  async 'rejeter-insc'(el) {
    const v = await modale("Rejeter la demande d'inscription", '<div class="champ"><label>Motif communiqué au demandeur (obligatoire)</label><textarea name="motif" required></textarea></div>', 'Rejeter');
    if (!v) return;
    await api(`/api/inscriptions/${el.dataset.id}/rejeter`, { method: 'POST', corps: { motif: v.motif } });
    await recharger('Demande rejetée ; le motif est consultable par le demandeur.');
  },
  'voir-mdp'(el) {
    const champ = document.getElementById('mdp');
    const visible = champ.type === 'password';
    champ.type = visible ? 'text' : 'password';
    el.textContent = visible ? 'Masquer' : 'Afficher';
    el.setAttribute('aria-pressed', String(visible));
  },
  demo(el) {
    document.querySelector(`#form-connexion input[name="type"][value="${el.dataset.type}"]`).checked = true;
    majIdentifiant(el.dataset.type);
    document.getElementById('identifiant').value = el.dataset.valeur;
    document.getElementById('mdp').value = etat.demo.mot_de_passe;
    // Un clic sur un compte de démonstration connecte directement.
    document.getElementById('form-connexion').requestSubmit();
  },
  async 'mdp-oublie'() {
    // Étape 1 : identifiant → code à 6 chiffres envoyé par SMS au numéro du dossier.
    const options = Object.entries(IDENTIFIANTS).map(([k, d]) => `<option value="${k}" ${k === etat.typeIdentifiant ? 'selected' : ''}>${d.court}</option>`).join('');
    const demande = await modale('Mot de passe oublié', `<p class="doux">Un code à 6 chiffres sera envoyé par SMS au numéro enregistré dans votre dossier.</p>
      <div class="grille-champs"><div class="champ"><label for="o-type">Identifiant</label><select id="o-type" name="type">${options}</select></div>
      <div class="champ"><label for="o-id">Valeur</label><input id="o-id" name="identifiant" required value="${esc(document.getElementById('identifiant')?.value ?? '')}"></div></div>`,
    'Recevoir un code', async (v) => ({ ...v, reponse: await api('/api/mot-de-passe/oublie', { method: 'POST', corps: v }) }));
    if (!demande) return;
    const sms = demande.reponse.sms_demo;
    // Étape 2 : code reçu + nouveau mot de passe.
    const fait = await modale('Nouveau mot de passe', `<p class="doux">${esc(demande.reponse.message)}</p>
      ${sms ? `<div class="sms-demo"><strong>SMS simulé (prototype) · ${esc(sms.telephone)}</strong><p>${esc(sms.texte)}</p></div>` : ''}
      <div class="champ"><label for="o-code">Code reçu par SMS</label><input id="o-code" name="code" required inputmode="numeric" maxlength="6" autocomplete="one-time-code"></div>
      <div class="grille-champs"><div class="champ"><label for="o-mdp">Nouveau mot de passe</label><input id="o-mdp" name="nouveau" type="password" required autocomplete="new-password"></div>
      <div class="champ"><label for="o-mdp2">Confirmation</label><input id="o-mdp2" name="confirmation" type="password" required autocomplete="new-password"></div></div>
      <p class="aide">Au moins 10 caractères, dont des lettres et des chiffres.</p>`,
    'Changer le mot de passe', async (v) => {
      if (v.nouveau !== v.confirmation) throw new Error('Les deux mots de passe ne sont pas identiques.');
      return api('/api/mot-de-passe/reinitialiser', { method: 'POST', corps: { type: demande.type, identifiant: demande.identifiant, code: v.code, nouveau: v.nouveau } });
    });
    if (fait) toast('Mot de passe changé. Connectez-vous avec le nouveau mot de passe.');
  },
  async 'changer-mdp'() {
    const fait = await modale('Changer mon mot de passe', `
      <div class="champ"><label for="c-actuel">Mot de passe actuel</label><input id="c-actuel" name="actuel" type="password" required autocomplete="current-password"></div>
      <div class="grille-champs"><div class="champ"><label for="c-mdp">Nouveau mot de passe</label><input id="c-mdp" name="nouveau" type="password" required autocomplete="new-password"></div>
      <div class="champ"><label for="c-mdp2">Confirmation</label><input id="c-mdp2" name="confirmation" type="password" required autocomplete="new-password"></div></div>
      <p class="aide">Au moins 10 caractères, dont des lettres et des chiffres. Vos autres sessions ouvertes seront fermées.</p>`,
    'Enregistrer', async (v) => {
      if (v.nouveau !== v.confirmation) throw new Error('Les deux mots de passe ne sont pas identiques.');
      return api('/api/mot-de-passe/changer', { method: 'POST', corps: { actuel: v.actuel, nouveau: v.nouveau } });
    });
    if (fait) toast('Mot de passe changé.');
  },
  async deconnexion() {
    try { await api('/api/deconnexion', { method: 'POST' }); } catch { /* session déjà close */ }
    fermerSession();
    if (location.hash === '#/' || !location.hash) await afficher();
    else location.hash = '#/';
    toast('Vous êtes déconnecté(e).');
  },
  async reinitialiser() {
    if (!confirm('Recharger toutes les données de démonstration ?')) return;
    await api('/api/reinitialiser', { method: 'POST' });
    await recharger('Données réinitialisées.');
  },
};

document.addEventListener('click', async (ev) => {
  const lienLigne = ev.target.closest('[data-lien]');
  const el = ev.target.closest('[data-action]');
  if (el && el.tagName !== 'SELECT' && ACTIONS[el.dataset.action]) {
    ev.preventDefault();
    el.disabled = true;
    try { await ACTIONS[el.dataset.action](el); } catch (e) { toast(e.message, true); } finally { el.disabled = false; }
    return;
  }
  if (lienLigne && !ev.target.closest('a, button')) location.hash = lienLigne.dataset.lien;
});

document.addEventListener('change', (ev) => {
  if (ev.target.name === 'type' && ev.target.closest('#form-connexion')) {
    majIdentifiant(ev.target.value);
    document.getElementById('identifiant').focus();
    return;
  }
  if (ev.target.dataset.action === 'type-prop') {
    const q = new URLSearchParams(location.hash.split('?')[1] ?? '');
    q.set('type', ev.target.value);
    location.hash = `#/propositions?${q}`;
  }
  const fiche = ev.target.closest('form[data-form="auto"], form[data-form="evaluer"]');
  if (fiche) {
    ev.target.closest('tr[data-critere]')?.classList.remove('manquant');
    const lignes = [...fiche.querySelectorAll('tr[data-critere]')];
    const notes = lignes.filter((l) => l.querySelector('input:checked')).length;
    fiche.querySelector('[data-progression]').textContent = `${notes}/${lignes.length} éléments notés.`;
    if (notes === lignes.length) fiche.querySelector('[data-erreur]').textContent = '';
  }
  const form = ev.target.closest('form[data-form="evaluer"]');
  if (form) apercuNote(form);
});

// Aperçu de la note pendant la saisie de l'évaluateur (même formule que le serveur).
async function apercuNote(form) {
  const e = await api(`/api/evaluations/${form.dataset.id}`);
  const fd = new FormData(form);
  let total = 0, poids = 0;
  for (const r of e.fiche.rubriques) {
    const n = r.criteres.map((c) => Number(fd.get(c.code))).filter(Boolean);
    if (n.length !== r.criteres.length) continue;
    total += (n.reduce((s, x) => s + x, 0) / n.length / 5) * e.ponderation[r.code];
    poids += e.ponderation[r.code];
  }
  form.querySelector('[data-apercu]').textContent = poids === 100 ? `${Math.round((total / poids) * 2000) / 100}/20` : 'à compléter';
}

document.addEventListener('submit', async (ev) => {
  const form = ev.target.closest('form[data-form]');
  if (!form || form.closest('#modale')) return;
  ev.preventDefault();
  const fd = new FormData(form);
  try {
    switch (form.dataset.form) {
      case 'filtres': {
        const q = new URLSearchParams([...fd.entries()].filter(([, v]) => v));
        location.hash = `#/agents?${q}`;
        break;
      }
      case 'verifier':
        location.hash = `#/verifier?code=${encodeURIComponent(fd.get('code').trim())}`;
        break;
      case 'suivi': {
        // Le NPI reste en mémoire : il n'apparaît jamais dans l'adresse.
        etat.suiviNpi = fd.get('npi').trim();
        const cible = `#/inscription/suivi?numero=${encodeURIComponent(fd.get('numero').trim())}`;
        if (location.hash === cible) await afficher();
        else location.hash = cible;
        break;
      }
      case 'objectifs':
        await api(`/api/evaluations/${form.dataset.id}/objectifs`, { method: 'POST', corps: { objectifs: fd.getAll('objectif') } });
        await recharger("Contrat d'objectifs enregistré.");
        break;
      case 'auto':
      case 'evaluer': {
        const zoneErreur = form.querySelector('[data-erreur]');
        // Tous les éléments doivent être notés : on signale lesquels manquent, ligne par ligne.
        const lignes = [...form.querySelectorAll('tr[data-critere]')];
        lignes.forEach((l) => l.classList.remove('manquant'));
        const manquants = lignes.filter((l) => !fd.get(l.dataset.critere));
        if (manquants.length) {
          manquants.forEach((l) => l.classList.add('manquant'));
          zoneErreur.textContent = `${manquants.length} élément(s) à noter avant l'envoi : ${manquants.map((l) => l.cells[0].firstChild.textContent.trim()).join(' ; ')}.`;
          manquants[0].scrollIntoView({ behavior: 'smooth', block: 'center' });
          manquants[0].querySelector('input')?.focus({ preventScroll: true });
          break;
        }
        const notes = Object.fromEntries(lignes.map((l) => [l.dataset.critere, Number(fd.get(l.dataset.critere))]));
        const bouton = form.querySelector('button.principal');
        bouton.disabled = true;
        try {
          const r = await api(`/api/evaluations/${form.dataset.id}/${form.dataset.form === 'auto' ? 'auto' : 'evaluer'}`, { method: 'POST', corps: { notes, commentaire: fd.get('commentaire') } });
          await recharger(r.note_finale !== null && r.note_finale !== undefined ? `Notation validée : ${r.note_finale}/20 (${r.mention}).` : 'Auto-évaluation transmise à votre supérieur.');
        } catch (err) {
          // L'erreur reste affichée sous le formulaire (rapport spécial manquant, par exemple).
          zoneErreur.textContent = err.message;
          bouton.disabled = false;
        }
        break;
      }
      case 'regle': {
        const brut = fd.get('valeur');
        const valeur = form.dataset.type === 'number' ? Number(brut) : JSON.parse(brut);
        await api(`/api/regles/${form.dataset.cle}`, { method: 'PUT', corps: { valeur } });
        toast('Règle enregistrée. Relancez le moteur pour l\'appliquer.');
        break;
      }
    }
  } catch (e) { toast(e instanceof SyntaxError ? 'Format JSON invalide' : e.message, true); }
});

// --- Démarrage ---

async function demarrer() {
  const accueil = document.getElementById('demarrage');
  // La plateforme a besoin de son serveur : vérifier qu'il répond avant d'afficher quoi que ce soit.
  try {
    const res = await fetch('/api/inscription/parametres');
    if (!res.ok) throw new Error();
  } catch {
    accueil.classList.add('erreur');
    accueil.querySelector('strong').textContent = 'Le serveur de Ma Carrière BJ ne répond pas.';
    return;
  }
  accueil.hidden = true;
  etat.jeton = stockage.lire();
  if (etat.jeton) {
    try { await ouvrirSession(await api('/api/moi')); } catch { fermerSession(); }
  }
  window.addEventListener('hashchange', afficher);
  await afficher();
}

demarrer();
