// Termin — règles de l'agenda, en JavaScript, pour la version web.
//
// Port fidèle de `ReglesAgenda.swift`, `Fmt.swift`, `Fuseaux.swift`,
// `Instantane.swift` et `Plan.swift` de l'app iPhone. Aucune vue ici : ce
// fichier se charge dans la page ET dans Node, où `_tests/rejouer-etalon.js`
// le confronte à `Etalon.json` — les vraies fonctions du HTML d'origine,
// exécutées sur le jeu fictif. Règle du projet : ne jamais toucher un calcul
// sans rejouer l'étalon.
'use strict';

// ---------------------------------------------------------------- Types
const TYPES = {
  rdv:        { libelle: 'Rendez-vous',      emoji: '🤝', teinte: '2563EB', texte: '1D4ED8' },
  vol:        { libelle: 'Vol',              emoji: '✈️', teinte: '0EA5E9', texte: '0369A1' },
  transport:  { libelle: 'Transport',        emoji: '🚄', teinte: '1E40AF', texte: '1E3A8A' },
  hotel:      { libelle: 'Hébergement',      emoji: '🏨', teinte: '4F46E5', texte: '3730A3' },
  conference: { libelle: 'Conférence',       emoji: '🎤', teinte: '06B6D4', texte: '0E7490' },
  formation:  { libelle: 'Formation',        emoji: '🎓', teinte: '7C3AED', texte: '5B21B6' },
  visite:     { libelle: 'Visite',           emoji: '🏢', teinte: '14B8A6', texte: '0F766E' },
  repas:      { libelle: 'Repas',            emoji: '🍽️', teinte: '0284C7', texte: '075985' },
  verre:      { libelle: 'Boire un verre',   emoji: '🥂', teinte: '38BDF8', texte: '0C4A6E' },
  prive:      { libelle: 'Occupation privée', emoji: '🧘', teinte: '64748B', texte: '475569' },
  autre:      { libelle: 'Autre',            emoji: '📌', teinte: '94A3B8', texte: '475569' },
};
const TYPES_ORDRE = ['rdv', 'vol', 'transport', 'hotel', 'conference', 'formation', 'visite', 'repas', 'verre', 'prive', 'autre'];

function champ(cle, libelle, indication, genre) { return { cle, libelle, indication, genre: genre || 'texte' }; }
const CHAMPS = {
  rdv: [champ('contact', 'Contact sur place', 'Nom du contact'), champ('tel', 'Tél. / e-mail', '+852…, adresse e-mail'), champ('adresse', 'Adresse', 'IFC Tower 2… ou un lien')],
  vol: [champ('depLieu', 'Départ de', 'Paris CDG'), champ('depTz', 'Heure de départ en', '', 'fuseau'), champ('arrLieu', 'Arrivée à', 'Hong Kong HKG'), champ('arrTz', "Heure d'arrivée en", '', 'fuseau'), champ('arrDay', "Jour d'arrivée", '', 'jourArrivee'), champ('terminal', 'Terminal / porte', '2E, porte K34')],
  transport: [champ('depLieu', 'Départ de', 'Gare de Hongqiao…'), champ('depTz', 'Heure de départ en', '', 'fuseau'), champ('arrLieu', 'Arrivée à', ''), champ('arrTz', "Heure d'arrivée en", '', 'fuseau'), champ('arrDay', "Jour d'arrivée", '', 'jourArrivee')],
  hotel: [champ('adresse', 'Adresse', '5 Connaught Road… ou un lien'), champ('checkout', 'Date de check-out', '', 'date'), champ('tel', 'Téléphone', '+852…')],
  conference: [champ('adresse', 'Lieu / salle', 'HKCEC, salle 2B… ou un lien')],
  formation: [champ('adresse', 'Lieu', 'Salle… ou un lien'), champ('contact', 'Formateur / organisme', '')],
  visite: [champ('adresse', 'Adresse', 'Adresse ou lien'), champ('contact', 'Contact sur place', ''), champ('tel', 'Tél. / e-mail', '')],
  repas: [champ('adresse', 'Adresse', 'Adresse ou lien'), champ('conf', 'Réservation', 'Au nom de…'), champ('tel', 'Téléphone', '')],
  verre: [champ('adresse', 'Adresse', 'Adresse ou lien'), champ('conf', 'Réservation', 'Au nom de…')],
  prive: [champ('adresse', 'Lieu', 'Adresse ou lien')],
  autre: [champ('adresse', 'Lieu', 'Adresse ou lien')],
};
function champsPersonnels(type) {
  const propres = {
    vol: [champ('siege', 'Ma place', '12A'), champ('conf', 'Ma réservation', 'PNR ABC123')],
    transport: [champ('siege', 'Ma place', 'Voit. 3, siège 12C'), champ('conf', 'Ma réservation', '')],
    hotel: [champ('chambre', 'Ma chambre', 'N° de chambre'), champ('conf', 'Ma réservation', 'N° de confirmation')],
    conference: [champ('conf', 'Mon badge', 'N° de badge, billet…')],
    formation: [champ('conf', 'Mon inscription', '')],
  }[type] || [];
  return propres.concat([champ('note', 'Ma note', 'Visible de vous seul')]);
}
const CHAMP_PRINCIPAL = {
  rdv: ['Client / société', 'Nom du client…'], vol: ['Compagnie & n° de vol', 'AF 188 · Air France'],
  transport: ['Mode / ligne', 'Train G101, taxi, ferry…'], hotel: ["Nom de l'hôtel", 'Mandarin Oriental…'],
  conference: ['Conférence / salon', 'Forum Finance Asie…'], formation: ['Intitulé de la formation', 'Séminaire, atelier, certification…'],
  visite: ['Entreprise / site', 'Bureaux de…'], repas: ['Restaurant', 'Nom du restaurant…'],
  verre: ['Bar / lieu', "Rooftop, bar d'hôtel, pub…"], prive: ['Intitulé', 'Temps personnel, sortie, rendez-vous privé…'],
  autre: ['À préciser', "Décrivez de quoi il s'agit…"],
};
const Types = {
  ordre: TYPES_ORDRE,
  champPrincipal: (t) => { const c = CHAMP_PRINCIPAL[t] || CHAMP_PRINCIPAL.autre; return champ('titre', c[0], c[1]); },
  libelle: (t) => (TYPES[t] || TYPES.autre).libelle,
  emoji: (t) => (TYPES[t] || TYPES.autre).emoji,
  teinte: (t) => (TYPES[t] || TYPES.autre).teinte,
  teinteTexte: (t) => (TYPES[t] || TYPES.autre).texte,
  champs: (t) => CHAMPS[t] || CHAMPS.autre,
  champsPersonnels,
  estTrajet: (t) => t === 'vol' || t === 'transport',
  depuisHTML: (brut) => brut === 'note' ? 'prive' : (TYPES[brut] ? brut : 'autre'),
  libelleDebut: (t) => ({ vol: 'Décollage', transport: 'Départ', hotel: 'Check-in (h)' })[t] || 'Début',
  libelleFin: (t) => ({ vol: 'Atterrissage', transport: 'Arrivée', hotel: 'Check-out (h)' })[t] || 'Fin',
};

// ---------------------------------------------------------------- Fmt
const MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
const MOIS_COURT = ['janv', 'févr', 'mars', 'avr', 'mai', 'juin', 'juil', 'août', 'sept', 'oct', 'nov', 'déc'];
const JOURS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
const JOURS_COURT = ['dim', 'lun', 'mar', 'mer', 'jeu', 'ven', 'sam'];
const pad2 = (n) => String(n).padStart(2, '0');

const Fmt = {
  moisCourt: MOIS_COURT,
  composants(iso) {
    const m = String(iso || '').split('-');
    if (m.length !== 3) return null;
    const a = Number(m[0]), mo = Number(m[1]), j = Number(m[2]);
    if (!Number.isInteger(a) || !Number.isInteger(mo) || !Number.isInteger(j)) return null;
    if (m[0] === '' || m[1] === '' || m[2] === '' || mo < 1 || mo > 12 || j < 1 || j > 31) return null;
    return { annee: a, mois: mo, jour: j };
  },
  date(iso) { const c = Fmt.composants(iso); return c ? new Date(Date.UTC(c.annee, c.mois - 1, c.jour)) : null; },
  iso(d) { return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`; },
  aujourdhui(maintenant) { const d = maintenant || new Date(); return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; },
  ajouterJours(iso, n) { const d = Fmt.date(iso); if (!d) return iso; d.setUTCDate(d.getUTCDate() + n); return Fmt.iso(d); },
  ecartJours(de, a) { const d1 = Fmt.date(de), d2 = Fmt.date(a); if (!d1 || !d2) return 0; return Math.round((d2 - d1) / 86400000); },
  jourDeSemaine(iso) { const d = Fmt.date(iso); return d ? d.getUTCDay() : 0; },
  lundi(iso) { const dow = Fmt.jourDeSemaine(iso); return Fmt.ajouterJours(iso, -((dow + 6) % 7)); },
  dateLongue(iso) { const c = Fmt.composants(iso); return c ? `${c.jour} ${MOIS[c.mois - 1]} ${c.annee}` : iso; },
  dateCourte(iso) { const c = Fmt.composants(iso); return c ? `${c.jour} ${MOIS[c.mois - 1]}` : iso; },
  dateMini(iso) { const c = Fmt.composants(iso); return c ? `${JOURS_COURT[Fmt.jourDeSemaine(iso)]} ${c.jour} ${MOIS_COURT[c.mois - 1]}` : iso; },
  nomDuJour(iso) { return JOURS[Fmt.jourDeSemaine(iso)]; },
  nomDuJourCourt(iso) { return JOURS_COURT[Fmt.jourDeSemaine(iso)]; },
  dateSlash(iso) { const c = Fmt.composants(iso); return c ? `${pad2(c.jour)}/${pad2(c.mois)}/${String(c.annee).padStart(4, '0')}` : iso; },
  // `hm()` du HTML, regex comprise : « 25:00 » passe (1 500).
  minutes(heure) { const m = /^(\d{1,2}):(\d{2})$/.exec(String(heure || '')); return m ? Number(m[1]) * 60 + Number(m[2]) : null; },
  heure(minutes) { const m = ((minutes % 1440) + 1440) % 1440; return `${pad2(Math.floor(m / 60))}:${pad2(m % 60)}`; },
  heureLisible(heure) { const m = Fmt.minutes(heure); if (m === null) return heure ? heure : '—'; const mm = m % 60; return mm === 0 ? `${Math.floor(m / 60)} h` : `${Math.floor(m / 60)} h ${pad2(mm)}`; },
  pluriel(n, singulier, pluriel) { return n > 1 ? `${n} ${pluriel || singulier + 's'}` : `${n} ${singulier}`; },
  age(date, maintenant) {
    const now = maintenant || new Date(); const ecart = (now - date) / 1000;
    if (ecart < 0) return Fmt.dateHeure(date);
    if (ecart < 60) return "à l'instant";
    if (ecart < 3600) return `il y a ${Math.floor(ecart / 60)} min`;
    if (ecart < 86400) return `il y a ${Math.floor(ecart / 3600)} h`;
    const j = Math.round((new Date(now.getFullYear(), now.getMonth(), now.getDate()) - new Date(date.getFullYear(), date.getMonth(), date.getDate())) / 86400000);
    if (j <= 1) return 'hier';
    if (j < 7) return `il y a ${j} j`;
    return Fmt.dateHeure(date);
  },
  dateHeure(date) { return `${pad2(date.getDate())}/${pad2(date.getMonth() + 1)}/${date.getFullYear()} à ${date.getHours()} h ${pad2(date.getMinutes())}`; },
};

// ---------------------------------------------------------------- Fuseaux
const VILLES = [
  { nom: 'Paris', identifiant: 'Europe/Paris' }, { nom: 'Londres', identifiant: 'Europe/London' },
  { nom: 'Dubaï', identifiant: 'Asia/Dubai' }, { nom: 'Delhi', identifiant: 'Asia/Kolkata' },
  { nom: 'Bangkok', identifiant: 'Asia/Bangkok' }, { nom: 'Hong Kong', identifiant: 'Asia/Hong_Kong' },
  { nom: 'Shanghai', identifiant: 'Asia/Shanghai' }, { nom: 'Singapour', identifiant: 'Asia/Singapore' },
  { nom: 'Tokyo', identifiant: 'Asia/Tokyo' },
];
const LUXEMBOURG = 'Europe/Luxembourg';
/// Décalage UTC (en heures) d'un fuseau IANA à un instant donné, par Intl.
function decalageZone(identifiant, instant) {
  const f = new Intl.DateTimeFormat('en-US', { timeZone: identifiant, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' });
  const p = {}; for (const x of f.formatToParts(instant)) p[x.type] = x.value;
  const local = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute), Number(p.second));
  return (local - instant.getTime()) / 3600000;
}
const Fuseaux = {
  villes: VILLES,
  noms: VILLES.map((v) => v.nom),
  ville: (nom) => VILLES.find((v) => v.nom === nom) || null,
  estConnue: (nom) => !!Fuseaux.ville(nom),
  decalage(nom, dateISO) {
    const v = Fuseaux.ville(nom); if (!v) return null;
    const d = Fmt.date(dateISO) || new Date();
    return decalageZone(v.identifiant, new Date(d.getTime() + 12 * 3600000));
  },
  texteDecalage(h) {
    const signe = h < 0 ? '−' : (h > 0 ? '+' : ''); const abs = Math.abs(h); const hh = Math.floor(abs); const mm = Math.round((abs - hh) * 60);
    return mm === 0 ? `${signe}${hh}` : `${signe}${hh}:${pad2(mm)}`;
  },
  libelle(nom, dateISO) { const d = Fuseaux.decalage(nom, dateISO); return d === null ? nom : `${nom} (UTC${Fuseaux.texteDecalage(d)})`; },
  villeReconnue(texte) { const bas = String(texte || '').toLowerCase(); const v = VILLES.find((x) => bas.includes(x.nom.toLowerCase())); return v ? v.nom : null; },
  rappelDecalages(villesDuVoyage, dateISO) {
    const reference = Fuseaux.decalage('Paris', dateISO) ?? 1;
    const groupes = [];
    for (const ville of villesDuVoyage) {
      const propre = String(ville || '').trim(); if (!propre) continue;
      const repere = Fuseaux.villeReconnue(propre); if (!repere) continue;
      const d = Fuseaux.decalage(repere, dateISO); if (d === null || d === reference) continue;
      const g = groupes.find((x) => x.decalage === d);
      if (g) { if (!g.villes.includes(repere)) g.villes.push(repere); } else groupes.push({ decalage: d, villes: [repere] });
    }
    if (!groupes.length) return "Toutes les heures sont indiquées en heure locale sur place. Pour les vols entre deux fuseaux, précisez l'heure de départ, l'heure d'arrivée et le jour d'arrivée.";
    const morceaux = groupes.map((g) => { const diff = g.decalage - reference; const entier = diff === Math.round(diff); const ecart = entier ? `${Math.abs(diff)} h` : `${Math.floor(Math.abs(diff))} h 30`; return `${g.villes.join(' / ')} = Paris ${diff >= 0 ? '+' : '−'} ${ecart}`; });
    return `Toutes les heures sont indiquées en heure locale sur place. Décalage : ${morceaux.join(' · ')}. Pour les vols, précisez le fuseau de chaque horaire et le jour d'arrivée.`;
  },
  fuseauPourVille(ville) {
    const bas = String(ville || '').toLowerCase();
    if (bas.includes('luxembourg')) return LUXEMBOURG;
    const r = Fuseaux.villeReconnue(bas); return r ? Fuseaux.ville(r).identifiant : null;
  },
  heureALuxembourg(heure, dateISO, ville) {
    const zone = Fuseaux.fuseauPourVille(ville); const minutes = Fmt.minutes(heure); const d = Fmt.date(dateISO);
    if (!zone || minutes === null || !d) return null;
    const midi = new Date(d.getTime() + 12 * 3600000);
    const local = decalageZone(zone, midi), lux = decalageZone(LUXEMBOURG, midi);
    if (local === lux) return null;
    const mLux = minutes - Math.round((local - lux) * 60);
    const suffixe = mLux < 0 ? ' la veille' : (mLux >= 1440 ? ' le lendemain' : '');
    return Fmt.heureLisible(Fmt.heure(mLux)) + ' à Luxembourg' + suffixe;
  },
  villes_dans(ville) { return String(ville || '').split(/[→/]/).map((s) => s.trim()).filter(Boolean); },
  villePour(heure, villeDuJour, departTrajet) {
    const parts = Fuseaux.villes_dans(villeDuJour);
    if (parts.length < 2) return villeDuJour;
    const minutes = Fmt.minutes(heure); if (minutes === null) return parts[0];
    const bascule = departTrajet ? (Fmt.minutes(departTrajet) ?? 12 * 60) : 12 * 60;
    return minutes <= bascule ? parts[0] : parts[parts.length - 1];
  },
};

// ---------------------------------------------------------------- Événements
function champDe(ev, cle) { return (ev.champs && ev.champs[cle]) || ''; }
function nouvelIdentifiant() { return 'w' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }
function evenementVide(auteur, date) {
  return { id: nouvelIdentifiant(), date, debut: '', fin: '', type: 'rdv', titre: '', champs: {}, champsPersonnels: {}, notes: '',
           participants: [], lecteurs: [], autre: false, autreNom: '', auteur, presence: {}, editeur: null,
           modifieLe: null, creeLe: new Date(), version: 1, retiree: false, discret: false };
}
function titreOuType(ev) { return ev.titre && ev.titre.trim() ? ev.titre : Types.libelle(ev.type); }
function participantsNettoyes(bruts) { const vus = new Set(); return (bruts || []).map((s) => String(s || '').trim()).filter((s) => s && !vus.has(s) && vus.add(s)); }

// ---------------------------------------------------------------- Règles
const Regles = {
  personnesConcernees(ev) { const liste = (ev.participants || []).slice(); const externe = String(ev.autreNom || '').trim(); if (ev.autre && externe) liste.push(externe); return liste; },
  // Règle de Termin (28/09/2026) : organisateur, auteur, participants, lecteurs.
  peutVoir(ev, regard) {
    if (regard.estOrganisateur) return true; const moi = regard.moi; if (!moi) return false;
    return ev.auteur === moi || Regles.personnesConcernees(ev).includes(moi) || (ev.lecteurs || []).includes(moi);
  },
  // Règle du HTML, conservée pour l'étalon (partage 🤝 + discret).
  peutVoirHTML(ev, regard) {
    if (regard.estOrganisateur) return true; const moi = regard.moi; if (!moi) return false;
    if (ev.auteur === moi) return true;
    const concernees = Regles.personnesConcernees(ev); if (concernees.includes(moi)) return true;
    if (ev.discret) return false;
    const partage = (qui) => { const p = (regard.partages || {})[qui]; if (p === '*') return true; return Array.isArray(p) && p.includes(moi); };
    return [ev.auteur].concat(concernees).some((nom) => nom && nom !== moi && partage(nom));
  },
  peutModifier(ev, regard) { if (regard.estOrganisateur) return true; const moi = regard.moi; if (!moi) return false; return ev.auteur === moi || Regles.personnesConcernees(ev).includes(moi); },
  peutSupprimer(ev, regard) { if (regard.estOrganisateur) return true; const moi = regard.moi; if (!moi) return false; return ev.auteur === moi; },
  personnesPourOccupe(ev, nomsDansOccupe) { const externes = ev.autre ? 1 : 0; return { noms: nomsDansOccupe ? (ev.participants || []).slice() : [], externes }; },
  fenetre(ev, personne) {
    const p = (ev.presence || {})[personne];
    const de = (p && p.from) ? p.from : ev.debut;
    const aBrut = (p && p.to) ? p.to : ev.fin;
    return { from: de, to: aBrut ? aBrut : de };
  },
  chevauche(f1, f2) {
    if (!f1.from || !f2.from) return false;
    const e1 = f1.to || f1.from, e2 = f2.to || f2.from;
    return (f1.from < e2 && f2.from < e1) || f1.from === f2.from;
  },
  conflits(ev, evenementsDuJour) {
    if (!ev.debut) return []; const miens = Regles.personnesConcernees(ev); if (!miens.length) return [];
    const resultat = [];
    for (const autre of evenementsDuJour) {
      if (autre.id === ev.id || !autre.debut) continue;
      const communs = Regles.personnesConcernees(autre).filter((p) => miens.includes(p) && Regles.chevauche(Regles.fenetre(ev, p), Regles.fenetre(autre, p)));
      if (communs.length) resultat.push({ autre, personnes: communs });
    }
    return resultat;
  },
  repas(heure) { if (!heure) return { libelle: 'Repas', emoji: '🍽️' }; if (heure < '11:00') return { libelle: 'Petit-déjeuner', emoji: '☕' }; if (heure < '17:00') return { libelle: 'Déjeuner', emoji: '🍽️' }; return { libelle: 'Dîner', emoji: '🍷' }; },
  etiquette(ev) { return ev.type === 'repas' ? Regles.repas(ev.debut).libelle : Types.libelle(ev.type); },
  emoji(ev) { return ev.type === 'repas' ? Regles.repas(ev.debut).emoji : Types.emoji(ev.type); },
  hotelsDeLaNuit(date, datesDuVoyage, evenements, visible) {
    const noms = [];
    for (const dj of datesDuVoyage) for (const ev of evenements) {
      if (ev.date !== dj || ev.type !== 'hotel' || !ev.titre || !visible(ev)) continue;
      const co = champDe(ev, 'checkout');
      const couvre = co > dj ? (date >= dj && date < co) : (date === dj);
      if (couvre && !noms.includes(ev.titre)) noms.push(ev.titre);
    }
    return noms;
  },
  checkOuts(date, evenements) { return evenements.filter((ev) => ev.type === 'hotel' && champDe(ev, 'checkout') === date && date !== ev.date); },
  jourArrivee(ev) {
    let n = parseInt(champDe(ev, 'arrDay'), 10); if (!Number.isFinite(n)) n = 0;
    if (n === 0) { const s = Fmt.minutes(ev.debut), te = Fmt.minutes(ev.fin); if (s !== null && te !== null && te <= s) n = 1; }
    return Fmt.ajouterJours(ev.date, n);
  },
  arrivees(date, evenements) { return evenements.filter((ev) => ev.date < date && Types.estTrajet(ev.type) && ev.debut && Regles.jourArrivee(ev) === date); },
  villeArrivee(ev) {
    const fuseau = champDe(ev, 'arrTz'); if (fuseau && Fuseaux.estConnue(fuseau)) return fuseau;
    const lieu = champDe(ev, 'arrLieu').trim(); if (!lieu) return '';
    return Fuseaux.villeReconnue(lieu) || lieu;
  },
  villeDepart(ev) {
    const fuseau = champDe(ev, 'depTz'); if (fuseau && Fuseaux.estConnue(fuseau)) return fuseau;
    const lieu = champDe(ev, 'depLieu').trim(); if (!lieu) return '';
    return Fuseaux.villeReconnue(lieu) || lieu;
  },
  villeAPoser(ev, jours) {
    if (!Types.estTrajet(ev.type)) return null; const ville = Regles.villeArrivee(ev); if (!ville) return null;
    const dArr = Regles.jourArrivee(ev); const jour = jours.find((j) => j.date === dArr); if (!jour) return null;
    return jour.ville === ville ? null : { date: dArr, ville };
  },
  villeAPoserEtendue(ev, jours) {
    if (!Types.estTrajet(ev.type)) return null; const arrivee = Regles.villeArrivee(ev); if (!arrivee) return null;
    const dArr = Regles.jourArrivee(ev); const jour = jours.find((j) => j.date === dArr); if (!jour) return null;
    const canon = (v) => Fuseaux.villeReconnue(v) || String(v || '').trim();
    let nouvelle = arrivee;
    if (dArr === ev.date) {
      const depart = canon(Regles.villeDepart(ev));
      const parts = Fuseaux.villes_dans(jour.ville); const premiere = parts.length ? canon(parts[0]) : '';
      const matin = (premiere && premiere !== arrivee) ? premiere : depart;
      if (matin && matin !== arrivee) nouvelle = `${matin} → ${arrivee}`;
    }
    return jour.ville === nouvelle ? null : { date: dArr, ville: nouvelle };
  },
  decalageJour(ev) { const n = parseInt(champDe(ev, 'arrDay'), 10); return n > 0 ? `+${n} j` : ''; },
  dureeTrajet(ev) {
    const od = Fuseaux.decalage(champDe(ev, 'depTz'), ev.date), oa = Fuseaux.decalage(champDe(ev, 'arrTz'), ev.date);
    if (od === null || oa === null || !ev.debut || !ev.fin) return '';
    const dep = Fmt.minutes(ev.debut), arr = Fmt.minutes(ev.fin); if (dep === null || arr === null) return '';
    let arrDay = parseInt(champDe(ev, 'arrDay'), 10); if (!Number.isFinite(arrDay)) arrDay = 0;
    const depUTC = dep - od * 60, arrUTC = arrDay * 1440 + arr - oa * 60;
    let duree = Math.round(arrUTC - depUTC); if (duree < 0) duree += 1440;
    const hh = Math.floor(duree / 60), mm = duree % 60;
    return `≈ ${hh} h` + (mm !== 0 ? ` ${pad2(mm)}` : '');
  },
  segments(ev) {
    const s = Fmt.minutes(ev.debut); if (s === null) return [];
    const te = Fmt.minutes(ev.fin);
    let arr = parseInt(champDe(ev, 'arrDay'), 10); if (!Number.isFinite(arr)) arr = 0;
    if (arr === 0 && te !== null && te <= s) arr = 1;
    const seg = (date, debut, fin, partie) => ({ evenement: ev, dateRangee: ev.date, date, debut, fin, partie, colonne: 0, colonnes: 1 });
    if (arr === 0) { const e = (te !== null && te > s) ? te : s + 60; return [seg(ev.date, s, e, 'full')]; }
    const segs = [seg(ev.date, s, 1440, 'debut')];
    for (let k = 1; k < arr; k++) segs.push(seg(Fmt.ajouterJours(ev.date, k), 0, 1440, 'plein'));
    segs.push(seg(Fmt.ajouterJours(ev.date, arr), 0, te === null ? 60 : te, 'fin'));
    return segs;
  },
  disposer(segmentsDuJour) {
    const items = segmentsDuJour.map((s, i) => ({ s: Object.assign({}, s), i }))
      .sort((a, b) => (a.s.debut - b.s.debut) || (a.s.fin - b.s.fin) || (a.i - b.i)).map((x) => x.s);
    let i = 0;
    while (i < items.length) {
      let j = i, finMax = items[i].fin;
      while (j + 1 < items.length && items[j + 1].debut < finMax) { j++; finMax = Math.max(finMax, items[j].fin); }
      const fins = [];
      for (let k = i; k <= j; k++) {
        const c = fins.findIndex((f) => items[k].debut >= f);
        if (c >= 0) { fins[c] = items[k].fin; items[k].colonne = c; } else { items[k].colonne = fins.length; fins.push(items[k].fin); }
      }
      for (let k = i; k <= j; k++) items[k].colonnes = fins.length;
      i = j + 1;
    }
    return items;
  },
  elements(date, evenements) {
    const items = [];
    for (const ev of evenements) if (ev.date === date) items.push({ genre: 'own', evenement: ev, dateOrigine: date, cleTri: ev.debut || '99:99' });
    for (const ev of Regles.arrivees(date, evenements)) items.push({ genre: 'arr', evenement: ev, dateOrigine: ev.date, cleTri: ev.fin || '00:00' });
    for (const ev of Regles.checkOuts(date, evenements)) items.push({ genre: 'co', evenement: ev, dateOrigine: ev.date, cleTri: ev.fin || '11:00' });
    return items.map((x, i) => ({ x, i })).sort((a, b) => (a.x.cleTri < b.x.cleTri ? -1 : a.x.cleTri > b.x.cleTri ? 1 : a.i - b.i)).map((y) => Object.assign({ id: `${y.x.genre}:${y.x.evenement.id}` }, y.x));
  },
  filtreCorrespond(filtre, ev) { if (!filtre) return true; if (filtre === '__autre') return !!ev.autre; return (ev.participants || []).includes(filtre); },
  statistiques(voyage, evenements, visible, aujourdhui) {
    const visibles = evenements.filter(visible); const ecart = Fmt.ecartJours(aujourdhui, voyage.debut);
    return { jours: voyage.nbJours, rendezVous: visibles.filter((e) => e.type === 'rdv').length, evenements: visibles.length,
             joursAvantDepart: ecart > 0 ? ecart : null, enCours: ecart <= 0 && ecart > -voyage.nbJours };
  },
  horsPeriode(voyage, evenements) { return evenements.filter((e) => !Voyage.contient(voyage, e.date)).length; },
};

// ---------------------------------------------------------------- Voyage
const NB_JOURS_MAX = 60;
const Voyage = {
  parDefaut: () => ({ code: 'voyage', titre: 'Hong Kong – Shanghai', debut: '2026-11-15', nbJours: 12, participants: ['Michel'], organisateur: 'Michel', nomsDansOccupe: true, modifieLe: new Date(0) }),
  normaliser(v) {
    const base = Voyage.parDefaut(); const r = Object.assign(base, v || {});
    if (!Fmt.composants(r.debut)) r.debut = '2026-11-15';
    r.nbJours = Math.max(1, Math.min(NB_JOURS_MAX, Number(r.nbJours) || base.nbJours));
    r.participants = participantsNettoyes(r.participants); if (!r.participants.length) r.participants = Voyage.parDefaut().participants;
    return r;
  },
  fin: (v) => Fmt.ajouterJours(v.debut, v.nbJours - 1),
  dates: (v) => Array.from({ length: v.nbJours }, (_, i) => Fmt.ajouterJours(v.debut, i)),
  contient: (v, date) => date >= v.debut && date <= Voyage.fin(v),
  participantsNettoyes,
};

// ---------------------------------------------------------------- Instantané
const Instantane = {
  tri(liste) {
    return liste.slice().sort((a, b) => {
      if (a.date !== b.date) return a.date < b.date ? -1 : 1;
      const ha = a.debut || '99:99', hb = b.debut || '99:99'; if (ha !== hb) return ha < hb ? -1 : 1;
      const ca = +(a.creeLe || 0), cb = +(b.creeLe || 0); if (ca !== cb) return ca - cb;
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    });
  },
  joursComplets(voyage, jours) {
    const parDate = new Map((jours || []).map((j) => [j.date, j]));
    for (const d of Voyage.dates(voyage)) if (!parDate.has(d)) parDate.set(d, { date: d, ville: '' });
    return Array.from(parDate.values()).sort((a, b) => (a.date < b.date ? -1 : 1));
  },
};

// ---------------------------------------------------------------- Plan (adresse → carte)
const Plan = {
  lien(texte) {
    const propre = String(texte || '').trim(); if (!propre || /\s/.test(propre)) return null;
    if (/^https?:\/\//.test(propre)) { try { const u = new URL(propre); return u.host ? u.href : null; } catch (_) { return null; } }
    const debuts = ['maps.app.goo.gl', 'goo.gl/maps', 'maps.google.', 'www.google.', 'google.com/maps', 'maps.apple.com', 'www.openstreetmap.', 'osm.org/'];
    const bas = propre.toLowerCase();
    if (!debuts.some((d) => bas.startsWith(d))) return null;
    try { const u = new URL('https://' + propre); return u.host ? u.href : null; } catch (_) { return null; }
  },
  estGoogle(url) { try { const u = new URL(url); const h = u.host.toLowerCase(); if (h === 'maps.app.goo.gl' || h === 'goo.gl' || h === 'maps.google.com' || h.startsWith('maps.google.')) return true; if (h === 'google.com' || h === 'www.google.com' || h.startsWith('google.') || h.startsWith('www.google.')) return u.pathname.startsWith('/maps'); return false; } catch (_) { return false; } },
  estApple(url) { try { return new URL(url).host.toLowerCase() === 'maps.apple.com'; } catch (_) { return false; } },
  encode: (t) => encodeURIComponent(t),
  adresseEcrite(ev) { for (const cle of ['adresse', 'lienCarte']) { const t = champDe(ev, cle).trim(); if (t && !Plan.lien(t)) return t; } return ''; },
  lienRetenu(ev) { return Plan.lien(champDe(ev, 'lienCarte')) || Plan.lien(champDe(ev, 'adresse')); },
  actions(ev) {
    const actions = []; const adresse = Plan.adresseEcrite(ev); const lien = Plan.lienRetenu(ev);
    if (lien) actions.push({ id: 'lien', libelle: `Ouvrir dans ${Plan.estGoogle(lien) ? 'Google Maps' : (Plan.estApple(lien) ? 'Plans' : 'le navigateur')}`, url: lien });
    else if (adresse) {
      actions.push({ id: 'google', libelle: 'Chercher dans Google Maps', url: `https://www.google.com/maps/search/?api=1&query=${Plan.encode(adresse)}` });
      actions.push({ id: 'plans', libelle: 'Chercher dans Plans', url: `https://maps.apple.com/?q=${Plan.encode(adresse)}` });
    }
    if (adresse) actions.push({ id: 'copier', libelle: "Copier l'adresse", texte: adresse });
    return actions;
  },
  resumeDuLieu(ev) {
    const carte = !!Plan.lien(champDe(ev, 'lienCarte')); const ecrite = Plan.adresseEcrite(ev); const adresseEstLien = !!Plan.lien(champDe(ev, 'adresse'));
    if (!ecrite) return (carte || adresseEstLien) ? '🔗 Plan' : '';
    return `📍 ${ecrite}${carte ? '  🔗' : ''}`;
  },
};

const Termin = { Types, Fmt, Fuseaux, Regles, Voyage, Instantane, Plan, champDe, evenementVide, titreOuType, participantsNettoyes, nouvelIdentifiant };
if (typeof module !== 'undefined' && module.exports) module.exports = Termin;
if (typeof window !== 'undefined') window.Termin = Termin;
