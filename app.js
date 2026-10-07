// Termin web — l'application : état, synchronisation, écrans.
//
// Les règles viennent de `regles.js` (prouvées par l'étalon), les données de
// `magasin.js` (CloudKit JS) ou, en démonstration (`#demo`), d'un magasin en
// mémoire. Ce fichier reprend `TerminStore.swift` et les vues de l'app :
// on affiche d'abord (cache local), on synchronise ensuite ; chaque écriture
// est répercutée sur-le-champ à l'écran puis confirmée par le partage.
'use strict';
(function () {
  const T = window.Termin, M = window.TerminMagasin;
  const { Types, Fmt, Fuseaux, Regles, Voyage, Instantane, Plan, champDe, evenementVide, titreOuType, participantsNettoyes, nouvelIdentifiant } = T;
  const CFG = Object.assign({ apiToken: '', environment: 'production', demo: false }, window.TERMIN_CONFIG || {});
  const DEMO = !!CFG.demo || location.hash === '#demo';
  const PREFIXE = DEMO ? 'termin.demo.' : 'termin.';
  const Cles = { cache: PREFIXE + 'cache', identite: PREFIXE + 'identite', conditions: 'termin.conditions.acceptees', masques: PREFIXE + 'masques', apparence: 'termin.apparence', boite: PREFIXE + 'boite', onglet: PREFIXE + 'onglet', jeton: 'termin.jeton' };
  const DELAI_INDEXATION = 600000;
  const DESCRIPTION_PARTAGE = 'Chaque événement est en clair pour ses participants et ses lecteurs ; les autres ne voient que « 🔒 Occupé ».';
  const VERSION = 'web 1.2.1 (07/10/2026)';
  const SUGGESTIONS_VILLES = ['Luxembourg', 'Paris', 'Hong Kong', 'Shanghai'];
  const MOTIFS = [
    ['confidentialite', 'Atteinte à la confidentialité', 'Un détail de dossier, un montant, un document interne…'],
    ['inapproprie', 'Contenu inapproprié', 'Injurieux, agressif, discriminatoire'],
    ['inexact', 'Information inexacte', 'Un horaire ou un lieu faux, qui peut induire en erreur'],
    ['autre', 'Autre', 'Précisez ci-dessous'],
  ];

  // ---------------------------------------------------------------- outils
  const $ = (s, r) => (r || document).querySelector(s);
  const h = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const capitalise = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);
  const local = {
    lire(cle, defaut) { try { const v = localStorage.getItem(cle); return v === null ? defaut : JSON.parse(v); } catch (_) { return defaut; } },
    ecrire(cle, v) { try { localStorage.setItem(cle, JSON.stringify(v)); } catch (_) {} },
    retirer(cle) { try { localStorage.removeItem(cle); } catch (_) {} },
  };
  const identifiantUnique = () => (window.crypto && crypto.randomUUID ? crypto.randomUUID() : nouvelIdentifiant());
  function cloner(ev) {
    return Object.assign({}, ev, {
      champs: Object.assign({}, ev.champs || {}),
      champsPersonnels: Object.fromEntries(Object.entries(ev.champsPersonnels || {}).map(([k, v]) => [k, Object.assign({}, v)])),
      participants: (ev.participants || []).slice(), lecteurs: (ev.lecteurs || []).slice(),
      presence: Object.fromEntries(Object.entries(ev.presence || {}).map(([k, v]) => [k, Object.assign({}, v)])),
    });
  }
  /// Un instantané relu du stockage local : les dates redeviennent des dates.
  function revivre(i) {
    if (!i || !i.voyage) return null;
    const d = (v) => (v ? new Date(v) : null);
    const voyage = Voyage.normaliser(Object.assign({}, i.voyage, { modifieLe: d(i.voyage.modifieLe) || new Date(0) }));
    const evenements = (i.evenements || []).map((e) => Object.assign(cloner(e), { creeLe: d(e.creeLe) || new Date(0), modifieLe: d(e.modifieLe) }));
    const membres = (i.membres || []).map((m) => Object.assign({}, m, { inscritLe: d(m.inscritLe) || new Date(0) }));
    return { voyage, jours: (i.jours || []).filter((j) => j && j.date), evenements, membres, synchroniseLe: d(i.synchroniseLe) };
  }
  function chargerScript(src) { return new Promise((ok, ko) => { const s = document.createElement('script'); s.src = src; s.onload = ok; s.onerror = () => ko(new Error('Impossible de charger ' + src)); document.head.appendChild(s); }); }

  // ---------------------------------------------------------------- état
  const etat = { voyage: Voyage.parDefaut(), jours: [], evenements: [], enReserve: [], membres: [], synchroniseLe: null,
    moi: null, connecte: null, erreurConnexion: null, pret: false, filtre: '', onglet: local.lire(Cles.onglet, 'agenda'),
    enCours: false, ecrituresRecentes: {}, lundiChoisi: null };
  let magasin = null;
  const masques = () => new Set(local.lire(Cles.masques, []));

  function appliquer(i) {
    etat.voyage = i.voyage;
    etat.jours = Instantane.joursComplets(i.voyage, i.jours);
    const vivants = Instantane.tri(i.evenements.filter((e) => !e.retiree));
    const m = masques();
    etat.evenements = vivants.filter((e) => !m.has(e.auteur));
    etat.enReserve = vivants.filter((e) => m.has(e.auteur));
    etat.membres = i.membres;
    etat.synchroniseLe = i.synchroniseLe;
  }
  function instantaneCourant() { return { voyage: etat.voyage, jours: etat.jours, evenements: Instantane.tri(etat.evenements.concat(etat.enReserve)), membres: etat.membres, synchroniseLe: etat.synchroniseLe }; }
  function memoriser() { local.ecrire(Cles.cache, instantaneCourant()); }

  /// `Instantane.fusionne` : le serveur fait foi ; ce que le cache connaît et
  /// que le serveur ne renvoie pas n'est gardé que s'il est tout récent
  /// (délai d'indexation) ; à identifiant égal, la version la plus élevée.
  function plusRecent(a, b) { if (a.version !== b.version) return a.version > b.version; return +(a.modifieLe || a.creeLe) > +(b.modifieLe || b.creeLe); }
  function fusionne(cache, frais, maintenant) {
    const now = maintenant || new Date();
    const parId = new Map(frais.evenements.map((e) => [e.id, e]));
    const idsServeur = new Set(parId.keys());
    for (const connu of cache.evenements) {
      if (idsServeur.has(connu.id)) { if (plusRecent(connu, parId.get(connu.id))) parId.set(connu.id, connu); }
      else if (now - (connu.modifieLe || connu.creeLe) < DELAI_INDEXATION) parId.set(connu.id, connu);
    }
    const joursParDate = new Map(cache.jours.map((j) => [j.date, j])); for (const j of frais.jours) joursParDate.set(j.date, j);
    const membresParId = new Map(cache.membres.map((m) => [m.id, m])); for (const m of frais.membres) membresParId.set(m.id, m);
    const voyage = +frais.voyage.modifieLe >= +cache.voyage.modifieLe ? frais.voyage : cache.voyage;
    return { voyage, jours: Array.from(joursParDate.values()).sort((a, b) => (a.date < b.date ? -1 : 1)),
      evenements: Instantane.tri(Array.from(parId.values()).filter((e) => !e.retiree)),
      membres: Array.from(membresParId.values()).sort((a, b) => a.nom.localeCompare(b.nom, 'fr')), synchroniseLe: frais.synchroniseLe || cache.synchroniseLe };
  }
  /// Réapplique ce que cette page vient d'écrire (villes, retraits) par-dessus
  /// une relecture que le serveur n'a pas encore indexée.
  function proteger(f) {
    const now = Date.now();
    for (const k of Object.keys(etat.ecrituresRecentes)) if (now - etat.ecrituresRecentes[k] >= DELAI_INDEXATION) delete etat.ecrituresRecentes[k];
    for (const k of Object.keys(etat.ecrituresRecentes)) {
      if (k.startsWith('jour:')) { const date = k.slice(5); const j = etat.jours.find((x) => x.date === date); if (j) f.jours = f.jours.filter((x) => x.date !== date).concat([j]).sort((a, b) => (a.date < b.date ? -1 : 1)); }
      else if (k.startsWith('retrait:')) { const id = k.slice(8); f.evenements = f.evenements.filter((e) => e.id !== id); }
    }
    return f;
  }

  // ---------------------------------------------------------------- identité et droits
  const role = (nom) => (nom === etat.voyage.organisateur ? 'organisateur' : 'voyageur');
  function retablirIdentite() {
    const nom = local.lire(Cles.identite, null);
    if (!nom || !etat.voyage.participants.includes(nom)) { etat.moi = null; return; }
    const m = etat.membres.find((x) => x.nom === nom);
    etat.moi = { id: 'local:' + nom, nom, role: role(nom), inscritLe: m ? m.inscritLe : new Date() };
  }
  const estOrganisateur = () => !!etat.moi && etat.moi.role === 'organisateur';
  const regard = () => ({ moi: etat.moi ? etat.moi.nom : null, estOrganisateur: estOrganisateur(), partages: {} });
  const peutVoir = (ev) => Regles.peutVoir(ev, regard());
  const peutModifier = (ev) => Regles.peutModifier(ev, regard());
  const peutSupprimer = (ev) => Regles.peutSupprimer(ev, regard());
  /// Ma place dans l'événement : participant (ou auteur), lecteur, ou ni l'un
  /// ni l'autre — vert, orange, rouge (Michel, 05/10/2026).
  function relation(ev) {
    const moi = etat.moi ? etat.moi.nom : null; if (!moi) return 'aucun';
    if (ev.auteur === moi || Regles.personnesConcernees(ev).includes(moi)) return 'participant';
    if ((ev.lecteurs || []).includes(moi)) return 'lecteur';
    return 'aucun';
  }
  const LIBELLE_RELATION = { participant: '● participant', lecteur: '● lecteur', aucun: '● ni participant ni lecteur' };
  const chipRelation = (ev) => { const r = relation(ev); return `<span class="rel rel-${r}">${LIBELLE_RELATION[r]}</span>`; };

  // ---------------------------------------------------------------- lecture
  const datesDuVoyage = () => Voyage.dates(etat.voyage);
  const jour = (date) => etat.jours.find((j) => j.date === date) || { date, ville: '' };
  const evenementsLe = (date) => etat.evenements.filter((e) => e.date === date);
  function villePour(ev) {
    const depart = evenementsLe(ev.date).filter((e) => Types.estTrajet(e.type) && e.debut).map((e) => e.debut).sort()[0] || null;
    return Fuseaux.villePour(ev.debut, jour(ev.date).ville, depart);
  }
  const evenement = (id) => etat.evenements.find((e) => e.id === id) || etat.enReserve.find((e) => e.id === id) || null;
  const elements = (date) => Regles.elements(date, etat.evenements);
  const nuit = (date) => Regles.hotelsDeLaNuit(date, datesDuVoyage(), etat.evenements, peutVoir).join(' · ');
  const conflits = (ev) => Regles.conflits(ev, evenementsLe(ev.date));
  const statistiques = () => Regles.statistiques(etat.voyage, etat.evenements, peutVoir, Fmt.aujourdhui());
  const rappelFuseaux = () => Fuseaux.rappelDecalages(etat.jours.filter((j) => Voyage.contient(etat.voyage, j.date)).flatMap((j) => Fuseaux.villes_dans(j.ville)), etat.voyage.debut);
  const nombreDEvenements = (nom) => etat.evenements.filter((e) => e.participants.includes(nom) && (peutVoir(e) || etat.voyage.nomsDansOccupe)).length;
  const jourParDefaut = () => { const a = Fmt.aujourdhui(); return Voyage.contient(etat.voyage, a) ? a : etat.voyage.debut; };

  // ---------------------------------------------------------------- boîte d'envoi
  const boite = () => local.lire(Cles.boite, []);
  const ecrireBoite = (l) => local.ecrire(Cles.boite, l);
  function cleDEcriture(e) {
    switch (e.genre) {
      case 'evenement': return 'evenement:' + e.evenement.id;
      case 'retrait': return 'retrait:' + e.id;
      case 'jour': return 'jour:' + e.jour.date;
      case 'voyage': return 'voyage';
      case 'membre': return 'membre:' + e.membre.id;
      default: return e.genre;
    }
  }
  function deposerEnBoite(e) { const cle = cleDEcriture(e); const l = boite().filter((x) => x.cle !== cle); l.push({ id: identifiantUnique(), cle, ecriture: e, essais: 0, bloquee: false, deposeeLe: Date.now() }); ecrireBoite(l); }
  function compteBoite() { const l = boite(); return { enAttente: l.filter((x) => !x.bloquee).length, bloques: l.filter((x) => x.bloquee).length }; }
  async function rejouer(e) {
    if (!magasin) throw { code: 'horsLigne', message: 'Partage indisponible.' };
    switch (e.genre) {
      case 'evenement': await magasin.enregistrerEvenement(e.evenement); break;
      case 'retrait': await magasin.retirerEvenement(e.id); break;
      case 'jour': await magasin.enregistrerJour(e.jour); break;
      case 'voyage': await magasin.enregistrerVoyage(e.voyage); break;
      case 'membre': await magasin.enregistrerMembre(e.membre); break;
      default: break;
    }
  }
  /// Toutes les écritures passent par ici : ce qui échoue faute de réseau part
  /// en boîte d'envoi au lieu de se perdre en alerte.
  async function ecrire(e, silencieux) {
    try { await rejouer(e); }
    catch (err) {
      if (err && err.code === 'horsLigne') { deposerEnBoite(e); if (!silencieux) toast('Hors ligne — envoi à la prochaine connexion'); rendre(); }
      else alerte((err && err.message) || String(err));
    }
  }
  async function viderLaBoite() {
    let l = boite(); if (!l.some((x) => !x.bloquee)) return;
    let envoyees = 0;
    for (const entree of l.slice()) {
      if (entree.bloquee) continue;
      try { await rejouer(entree.ecriture); l = l.filter((x) => x.id !== entree.id); envoyees++; }
      catch (e) { if (e && e.code === 'horsLigne') break; entree.essais = (entree.essais || 0) + 1; if (entree.essais >= 3) entree.bloquee = true; }
    }
    ecrireBoite(l);
    if (envoyees) toast(`Envoyé : ${Fmt.pluriel(envoyees, 'modification')}`);
    const bloques = l.filter((x) => x.bloquee).length;
    if (bloques) alerte(`${Fmt.pluriel(bloques, 'modification')} n'ont pas pu être envoyées — voir Réglages ▸ Données.`);
  }

  // ---------------------------------------------------------------- synchronisation
  async function synchroniser() {
    if (!magasin || etat.enCours || !etat.connecte) return;
    etat.enCours = true; rendreOutils();
    try {
      await viderLaBoite();
      const frais = await magasin.chargerInstantane();
      frais.synchroniseLe = new Date();
      const fusion = proteger(fusionne(instantaneCourant(), frais));
      local.ecrire(Cles.cache, fusion);
      appliquer(fusion);
      retablirIdentite();
      controlerIdentite();
    } catch (e) {
      if (!(e && e.code === 'horsLigne')) alerte((e && e.message) || String(e));
    } finally { etat.enCours = false; rendre(); }
  }

  // ---------------------------------------------------------------- écritures
  /// La fiche de voyageur d'un prénom, relue au partage quand c'est possible,
  /// sinon celle du cache. Renvoie null si aucune fiche n'existe.
  async function ficheDe(nom) {
    const id = 'local:' + nom;
    if (magasin && !DEMO) { try { return await magasin.lireMembre(id); } catch (_) { /* hors ligne : le cache tranche */ } }
    return etat.membres.find((m) => m.id === id) || null;
  }
  const monCompte = () => (etat.connecte && !DEMO ? etat.connecte.identifiant : null);
  /// Le verrou : un prénom appartient au compte Apple qui a créé sa fiche.
  async function prenomDisponible(nom) {
    const fiche = await ficheDe(nom);
    if (Regles.prenomLibre(fiche, monCompte())) return true;
    alerte(`Le prénom « ${nom} » est déjà lié à un autre compte Apple. Si c'est bien le vôtre, demandez à l'organisateur de le libérer (onglet Voyageurs).`);
    return false;
  }
  /// Au retour d'une synchronisation : le prénom gardé par ce navigateur
  /// doit toujours m'appartenir.
  function controlerIdentite() {
    if (!etat.moi || !monCompte()) return;
    const fiche = etat.membres.find((m) => m.id === etat.moi.id);
    if (Regles.prenomLibre(fiche, monCompte())) return;
    const nom = etat.moi.nom; local.retirer(Cles.identite); etat.moi = null;
    alerte(`Le prénom « ${nom} » est lié à un autre compte Apple : choisissez le vôtre.`);
  }
  async function choisirIdentite(nom) {
    if (!nom || !etat.voyage.participants.includes(nom)) { local.retirer(Cles.identite); etat.moi = null; rendre(); return; }
    if (!(await prenomDisponible(nom))) { rendre(); return; }
    local.ecrire(Cles.identite, nom);
    const connu = etat.membres.find((x) => x.nom === nom);
    const membre = { id: 'local:' + nom, nom, role: role(nom), inscritLe: connu ? connu.inscritLe : new Date() };
    etat.moi = membre;
    if (!etat.membres.some((m) => m.id === membre.id)) {
      etat.membres = etat.membres.concat([membre]).sort((a, b) => a.nom.localeCompare(b.nom, 'fr'));
      memoriser();
      await ecrire({ genre: 'membre', membre }, true);
    }
    toast(`Identité : ${nom} — vos prochains événements seront signés à ce nom`);
    rendre();
  }
  /// Enregistre un événement, neuf ou modifié. Renvoie les conflits qu'il crée.
  async function enregistrer(brouillon) {
    const ev = cloner(brouillon); const maintenant = new Date();
    const existant = evenement(ev.id);
    if (existant) {
      if (!peutModifier(existant)) { alerte("Vous n'avez pas le droit de modifier cet événement."); return null; }
      ev.auteur = existant.auteur; ev.creeLe = existant.creeLe; ev.editeur = etat.moi ? etat.moi.nom : existant.editeur; ev.modifieLe = maintenant; ev.version = existant.version + 1;
    } else {
      ev.auteur = etat.moi ? etat.moi.nom : ev.auteur; ev.creeLe = maintenant; ev.editeur = null; ev.modifieLe = null; ev.version = 1;
    }
    ev.retiree = false; ev.titre = (ev.titre || '').trim(); ev.autreNom = ev.autre ? (ev.autreNom || '').trim() : '';
    const concernees = Regles.personnesConcernees(ev);
    ev.presence = Object.fromEntries(Object.entries(ev.presence || {}).filter(([k]) => concernees.includes(k)));
    etat.evenements = Instantane.tri(etat.evenements.filter((e) => e.id !== ev.id).concat([ev]));
    await poserVilleArrivee(ev);
    memoriser(); rendre();
    try {
      const enregistre = await magasin.enregistrerEvenement(ev);
      etat.evenements = Instantane.tri(etat.evenements.map((e) => (e.id === enregistre.id ? enregistre : e)));
      memoriser();
    } catch (e) {
      if (e && e.code === 'horsLigne') { deposerEnBoite({ genre: 'evenement', evenement: ev }); toast('Hors ligne — envoi à la prochaine connexion'); }
      else { alerte((e && e.message) || String(e)); await synchroniser(); return null; }
    }
    rendre();
    return conflits(ev);
  }
  async function poserVilleArrivee(ev) { const a = Regles.villeAPoserEtendue(ev, etat.jours); if (a) await definirVille(a.date, a.ville); }
  async function supprimer(ev) {
    if (!peutSupprimer(ev)) { alerte("Vous n'avez pas le droit de modifier cet événement."); return; }
    etat.evenements = etat.evenements.filter((e) => e.id !== ev.id);
    etat.ecrituresRecentes['retrait:' + ev.id] = Date.now();
    memoriser(); rendre();
    try { await magasin.retirerEvenement(ev.id); }
    catch (e) {
      if (e && e.code === 'introuvable') return;
      if (e && e.code === 'horsLigne') { deposerEnBoite({ genre: 'retrait', id: ev.id }); toast('Hors ligne — suppression envoyée à la prochaine connexion'); rendre(); }
      else { alerte((e && e.message) || String(e)); await synchroniser(); }
    }
  }
  async function definirVille(date, ville) {
    const j = { date, ville };
    etat.jours = etat.jours.filter((x) => x.date !== date).concat([j]).sort((a, b) => (a.date < b.date ? -1 : 1));
    etat.ecrituresRecentes['jour:' + date] = Date.now();
    memoriser(); rendre();
    await ecrire({ genre: 'jour', jour: j }, true);
  }
  async function modifierParticipants(liste) {
    if (!estOrganisateur()) { alerte('Seul l\'organisateur modifie la liste des voyageurs.'); return; }
    const propre = participantsNettoyes(liste); if (!propre.length) return;
    const copie = Object.assign({}, etat.voyage, { participants: propre, modifieLe: new Date() });
    if (copie.organisateur && !propre.includes(copie.organisateur)) copie.organisateur = null;
    etat.voyage = copie; retablirIdentite(); memoriser(); rendre();
    await ecrire({ genre: 'voyage', voyage: copie }, true);
  }
  async function designerOrganisateur(nom) {
    const copie = Object.assign({}, etat.voyage, { organisateur: nom && etat.voyage.participants.includes(nom) ? nom : null, modifieLe: new Date() });
    etat.voyage = copie; retablirIdentite(); memoriser(); rendre();
    await ecrire({ genre: 'voyage', voyage: copie }, true);
  }
  async function enregistrerVoyage(p) {
    if (!estOrganisateur()) { alerte('Seul l\'organisateur règle le voyage.'); return 0; }
    const copie = Object.assign({}, etat.voyage);
    const titre = String(p.titre || '').trim(); copie.titre = titre || etat.voyage.titre;
    const debut = Fmt.composants(p.debut) ? p.debut : etat.voyage.debut;
    let fin = Fmt.composants(p.fin) ? p.fin : Fmt.ajouterJours(debut, etat.voyage.nbJours - 1); if (fin < debut) fin = debut;
    copie.debut = debut; copie.nbJours = Math.max(1, Math.min(60, Fmt.ecartJours(debut, fin) + 1));
    const liste = participantsNettoyes(p.participants); if (liste.length) copie.participants = liste;
    copie.organisateur = p.organisateur && copie.participants.includes(p.organisateur) ? p.organisateur : etat.voyage.organisateur;
    copie.nomsDansOccupe = !!p.nomsDansOccupe; copie.modifieLe = new Date();
    etat.voyage = copie; etat.jours = Instantane.joursComplets(copie, etat.jours); retablirIdentite(); memoriser(); rendre();
    await ecrire({ genre: 'voyage', voyage: copie }, true);
    return Regles.horsPeriode(copie, etat.evenements);
  }
  /// L'organisateur rend un prénom à qui veut le prendre : la fiche est
  /// supprimée, le prochain compte qui choisit ce prénom en devient le titulaire.
  async function libererPrenom(nom) {
    if (!estOrganisateur()) { alerte('Seul l\'organisateur libère un prénom.'); return; }
    const id = 'local:' + nom;
    try { await magasin.retirerMembre(id); } catch (e) { if (!(e && e.code === 'introuvable')) { alerte((e && e.message) || String(e)); return; } }
    etat.membres = etat.membres.filter((m) => m.id !== id); memoriser(); rendre();
    toast(`Prénom « ${nom} » libéré : le prochain compte qui le choisit le garde.`);
  }
  function masquer(nom) {
    if (!nom || (etat.moi && nom === etat.moi.nom)) return;
    const m = masques(); m.add(nom); local.ecrire(Cles.masques, Array.from(m).sort());
    appliquer(instantaneCourant()); rendre();
    toast(`Les événements de ${nom} sont masqués dans ce navigateur — Réglages pour revenir.`);
  }
  function demasquer(nom) { const m = masques(); m.delete(nom); local.ecrire(Cles.masques, Array.from(m).sort()); appliquer(instantaneCourant()); rendre(); }
  async function signaler(ev, motif, precision) {
    const s = { id: identifiantUnique(), evenementId: ev.id, resume: `${Types.libelle(ev.type)} · ${titreOuType(ev)} · ${Fmt.dateCourte(ev.date)}`, motif, precision: precision || null, signaleParNom: etat.moi ? etat.moi.nom : 'Anonyme', creeLe: new Date() };
    try { await magasin.signaler(s); return true; } catch (e) { alerte((e && e.message) || String(e)); return false; }
  }

  // ---------------------------------------------------------------- toast, alerte, feuilles
  let toastMinuteur = null;
  function toast(texte, estAlerte) { const t = $('#toast'); t.textContent = texte; t.classList.toggle('alerte', !!estAlerte); t.classList.add('visible'); clearTimeout(toastMinuteur); toastMinuteur = setTimeout(() => t.classList.remove('visible'), estAlerte ? 4000 : 2500); }
  function alerte(texte) { ouvrirFeuille({ titre: 'Termin', corps: `<p style="padding:14px 0;font-size:15px">${h(texte)}</p>`, droite: { libelle: 'Compris', action: fermerFeuille } }); }
  const feuilles = [];
  function ouvrirFeuille(o) {
    const fond = document.createElement('div'); fond.className = 'feuille-fond'; fond.id = 'feuille-' + (o.id || Math.random().toString(36).slice(2, 8));
    fond.innerHTML = `<div class="feuille" role="dialog" aria-modal="true"><header><button type="button" class="gauche">${h(o.gauche ? o.gauche.libelle : '')}</button><h2>${h(o.titre || '')}</h2><button type="button" class="droite">${h(o.droite ? o.droite.libelle : '')}</button></header><div class="defile">${o.corps || ''}</div></div>`;
    const g = $('.gauche', fond), d = $('.droite', fond);
    if (o.gauche) g.addEventListener('click', () => o.gauche.action(fond)); else g.style.visibility = 'hidden';
    if (o.droite) d.addEventListener('click', () => o.droite.action(fond)); else d.style.visibility = 'hidden';
    fond.addEventListener('click', (e) => { if (e.target === fond && !o.bloquee) fermerFeuille(fond); });
    $('#feuilles').appendChild(fond); feuilles.push(fond);
    return fond;
  }
  function fermerFeuille(fond) {
    const f = fond && fond.classList ? fond : feuilles[feuilles.length - 1]; if (!f) return;
    const i = feuilles.indexOf(f); if (i >= 0) feuilles.splice(i, 1); f.remove();
    if (f.id === 'feuille-formulaire') formulaire = null;
    if (f.id === 'feuille-parametres') parametres = null;
    if (f.id === 'feuille-signalement') signalement = null;
  }

  // ---------------------------------------------------------------- rendu général
  function rendre() {
    const conditionsOK = !!local.lire(Cles.conditions, null);
    $('#ecran-conditions').hidden = conditionsOK; if (!conditionsOK) rendreConditions();
    const connexionVisible = conditionsOK && !etat.connecte;
    $('#ecran-connexion').hidden = !connexionVisible; if (connexionVisible) rendreEtatConnexion();
    const identiteVisible = conditionsOK && !!etat.connecte && !etat.moi;
    $('#ecran-identite').hidden = !identiteVisible; if (identiteVisible) rendreIdentite();
    rendreOutils(); rendreOnglets(); rendreContenu();
  }
  function rendreOnglets() { for (const b of document.querySelectorAll('#onglets button')) b.classList.toggle('actif', b.dataset.onglet === etat.onglet); }
  function rendreOutils() {
    let html = '';
    if (etat.onglet === 'agenda' || etat.onglet === 'semaine') {
      html += `<select class="outil${etat.filtre ? ' actif' : ''}" data-change="filtre" aria-label="Filtrer l'agenda sur une personne"><option value="">👁 Tout le monde</option>${etat.voyage.participants.map((n) => `<option value="${h(n)}"${etat.filtre === n ? ' selected' : ''}>${h(n)} · ${nombreDEvenements(n)}</option>`).join('')}<option value="__autre"${etat.filtre === '__autre' ? ' selected' : ''}>Autre (externe)</option></select>`;
    }
    if (etat.onglet === 'agenda' && estOrganisateur()) html += `<button class="outil" data-action="parametres" aria-label="Paramètres du voyage" title="Paramètres du voyage">⚙︎</button>`;
    if (etat.onglet === 'agenda') html += `<button class="outil" data-action="creer" data-date="${h(jourParDefaut())}" aria-label="Ajouter un événement" title="Ajouter un événement">＋</button>`;
    if (etat.onglet === 'semaine') html += `<button class="outil" data-action="semaine-voyage">Voyage</button>`;
    html += `<button class="outil" data-action="synchroniser" aria-label="Synchroniser" title="Synchroniser"${etat.enCours ? ' disabled' : ''}>${etat.enCours ? '…' : '↻'}</button>`;
    $('#outils').innerHTML = html;
  }
  function rendreContenu() {
    const sortie = $('#apple-sign-out-button'); if (sortie) $('#porte-deconnexion').appendChild(sortie);
    const c = $('#contenu');
    switch (etat.onglet) {
      case 'semaine': c.innerHTML = vueSemaine(); break;
      case 'voyageurs': c.innerHTML = vueVoyageurs(); break;
      case 'reglages': c.innerHTML = vueReglages(); { const place = $('#place-deconnexion'); if (place && sortie) place.appendChild(sortie); } break;
      default: c.innerHTML = vueAgenda();
    }
  }

  // ---------------------------------------------------------------- écrans pleins
  function rendreConditions() {
    $('#conditions-dedans').innerHTML = `<h2>Avant d'entrer</h2><p class="intro">Termin est l'agenda partagé d'un voyage entre collègues, sans lien avec un employeur. Ce que vous y écrivez est lu par les autres voyageurs — en clair ou en « Occupé », selon vos réglages.</p>${texteConditions()}<button class="bouton plein" data-action="accepter-conditions">J'accepte ces conditions</button>`;
  }
  function texteConditions() {
    const regles = [
      ["Ce que l'agenda contient", "Ce qu'il faut pour se retrouver : un nom, un lieu, une heure. Pas de document interne, pas le détail d'un dossier, aucun montant. On n'y écrit que ce qu'on pourrait dire à voix haute sans porter atteinte au devoir de confidentialité lié à notre profession."],
      ['Discret, pas secret', "L'agenda vit dans un espace iCloud privé, partagé entre les voyageurs inscrits. Le masquage « Occupé » et le choix des lecteurs sont des règles d'affichage, pas un chiffrement : n'y mettez rien que vous ne confieriez pas à un collègue du voyage."],
      ['Le ton', 'Aucune tolérance pour les propos injurieux, agressifs ou discriminatoires. Un contenu de cette nature est retiré sans délai et son auteur écarté du voyage.'],
      ['Ce que vous pouvez faire', "Signaler un événement qui vous paraît contraire à ces règles, et masquer une personne dont vous ne souhaitez plus voir les saisies. Un signalement est examiné par l'organisateur sous 24 heures."],
      ['Vos saisies', "Vous restez responsable de ce que vous écrivez. Vous pouvez corriger ou retirer vos propres événements à tout moment ; l'organisateur peut corriger ou retirer n'importe quel événement."],
      ['Vos données', "Elles ne servent qu'à l'agenda du voyage et ne quittent pas son espace iCloud. Une réinitialisation par l'organisateur les efface pour tout le monde."],
    ];
    return regles.map(([t, x]) => `<div class="regle"><b>${h(t)}</b><p>${h(x)}</p></div>`).join('');
  }
  function rendreEtatConnexion() {
    const e = $('#etat-connexion'); let zone = $('#jeton-zone');
    if (etat.erreurConnexion === 'jeton') {
      e.textContent = 'Cette copie de la page n\'a pas encore de jeton d\'accès web.';
      if (!zone) { zone = document.createElement('div'); zone.id = 'jeton-zone'; zone.innerHTML = `<p class="sec" style="font-size:13px;margin:8px 0 4px">Réservé à l'organisateur : collez ici le jeton « Termin web » de la CloudKit Console. Il reste dans ce navigateur.</p><div class="ligne"><input type="password" id="jeton-saisie" autocomplete="off" placeholder="Jeton d'accès web" style="text-align:left"></div><button class="bouton sobre" data-action="enregistrer-jeton">Enregistrer le jeton dans ce navigateur</button>`; e.after(zone); }
      return;
    }
    if (zone) zone.remove();
    if (etat.erreurConnexion) e.textContent = etat.erreurConnexion + ' — rechargez la page pour réessayer.';
    else if (!etat.pret) e.textContent = DEMO ? 'Démonstration…' : 'Connexion à iCloud…';
    else e.textContent = 'Pas connecté — utilisez le bouton Apple ci-dessus. Une fenêtre Apple s\'ouvre, puis la page revient ici toute seule.';
  }
  function rendreIdentite() {
    $('#identite-dedans').innerHTML = `<h2>Qui êtes-vous ?</h2><p class="intro">Votre prénom décide de ce que vous voyez en clair : vos événements, ceux où vous figurez, et ceux que vos collègues vous ont ouverts. Le reste apparaît en « 🔒 Occupé ».</p>
      <div class="panneau"><h3>Participants du voyage</h3>${etat.voyage.participants.map((n) => { const pris = !Regles.prenomLibre(etat.membres.find((m) => m.id === 'local:' + n), monCompte()); return `<button type="button" class="choix-identite${pris ? ' pris' : ''}" data-action="identite" data-nom="${h(n)}"><span class="nom">${h(n)}</span>${pris ? '<span class="etiquette discret">🔒 autre compte</span>' : ''}${n === etat.voyage.organisateur ? '<span class="etiquette neutre">Organisateur</span>' : ''}<span class="chev">›</span></button>`; }).join('')}</div>
      <p class="note" style="margin:0 0 10px">Un prénom appartient au premier compte Apple qui le choisit ; personne d'autre ne peut ensuite le prendre.</p>
      <div class="panneau"><p class="note" style="margin:0">Votre prénom n'y est pas ? Seul l'organisateur ajoute un voyageur : demandez-le-lui.</p></div>${rappelRegle()}`;
  }
  const rappelRegle = () => `<div class="rappel"><span class="ico">✋</span><div><b>Ce qui n'entre pas ici</b><p>Aucun document interne, aucun nom de dossier. On ne publie que ce qu'on pourrait dire à voix haute sans porter atteinte au devoir de confidentialité lié à notre profession.</p></div></div>`;
  const bandeau = (texte, classe, ico) => `<div class="bandeau ${classe || ''}"><span class="ico">${ico || 'ℹ️'}</span><span>${texte}</span></div>`;

  // ---------------------------------------------------------------- agenda
  function vueAgenda() {
    const dates = datesDuVoyage();
    return enTeteVoyage() + bandeauJours(dates) + dates.map((d, i) => sectionJour(d, i)).join('') + horsPeriode();
  }
  function enTeteVoyage() {
    const v = etat.voyage, s = statistiques(); const fin = Voyage.fin(v);
    const compteur = (val, lib) => `<div class="compteur"><b>${h(val)}</b><span>${h(lib)}</span></div>`;
    let html = `<section class="hero"><h2>${h(v.titre)}</h2><p>Voyage professionnel · départ ${Fmt.nomDuJour(v.debut)} ${Fmt.dateLongue(v.debut)} · retour ${Fmt.nomDuJour(fin)} ${Fmt.dateLongue(fin)}</p><div class="compteurs">${compteur(s.jours, 'jours')}${compteur(s.rendezVous, 'rendez-vous')}${compteur(s.evenements, 'événements')}${compteur(s.joursAvantDepart !== null ? 'J−' + s.joursAvantDepart : (s.enCours ? 'en cours' : '—'), s.joursAvantDepart !== null ? 'avant départ' : 'voyage')}</div>${etat.moi ? `<p class="qui">${estOrganisateur() ? '👑' : '👤'} ${h(etat.moi.nom)} · ${h(DESCRIPTION_PARTAGE)}</p>` : ''}</section>`;
    if (DEMO) html += bandeau('Démonstration : des données fictives, rien ne part sur iCloud.', 'jade', '🧪');
    html += bandeauBoite();
    html += bandeau('🕐 ' + h(rappelFuseaux()), 'cyan', '🌏');
    if (etat.moi) html += `<div class="legende"><span class="rel rel-participant">● participant</span><span class="rel rel-lecteur">● lecteur</span><span class="rel rel-aucun">● ni l'un ni l'autre</span></div>`;
    return html;
  }
  function bandeauBoite() {
    const b = compteBoite();
    if (b.bloques) return bandeau(`${Fmt.pluriel(b.bloques, 'modification')} n'ont pas pu être envoyées — voir Réglages ▸ Données.`, 'danger', '⚠️');
    if (b.enAttente) return bandeau(`${Fmt.pluriel(b.enAttente, 'modification')} en attente d'envoi : elles partiront à la prochaine connexion.`, '', '📤');
    return '';
  }
  function bandeauJours(dates) {
    const aujourdhui = Fmt.aujourdhui();
    return `<div class="bande">${dates.map((date) => {
      const ville = jour(date).ville.toLowerCase();
      const teinte = ville.includes('hong') ? 'var(--accent)' : (ville.includes('shang') ? 'var(--cyan)' : 'var(--secondaire)');
      const points = evenementsLe(date).slice(0, 4).map((ev) => (peutVoir(ev) ? '#' + Types.teinte(ev.type) : 'var(--pale)'));
      const c = Fmt.composants(date);
      return `<button type="button" class="chip-jour${date === aujourdhui ? ' aujourdhui' : ''}" data-action="aller" data-date="${date}" aria-label="${h(Fmt.nomDuJour(date) + ' ' + Fmt.dateCourte(date))}"><span class="dow" style="color:${teinte}">${h(Fmt.nomDuJourCourt(date))}</span><span class="num">${c ? c.jour : '?'}</span><span class="points">${points.map((p) => `<i style="background:${p}"></i>`).join('')}</span></button>`;
    }).join('')}</div>`;
  }
  function villeMenu(date) {
    const ville = jour(date).ville;
    const noms = SUGGESTIONS_VILLES.concat(Fuseaux.noms.filter((n) => !SUGGESTIONS_VILLES.includes(n)));
    const options = [`<option value=""${ville ? '' : ' selected'}>Ville ?</option>`];
    if (ville && !noms.includes(ville)) options.push(`<option value="${h(ville)}" selected>${h(ville)}</option>`);
    for (const n of noms) options.push(`<option value="${h(n)}"${n === ville ? ' selected' : ''}>${h(n)}</option>`);
    options.push('<option disabled>────────</option>', '<option value="__autre">Autre ville…</option>', '<option value="__deux">Deux villes (matin → après-midi)…</option>');
    if (ville) options.push('<option value="__effacer">Effacer</option>');
    return `<select class="ville-select${ville ? '' : ' vide'}" data-change="ville" data-date="${date}" aria-label="Ville du jour">${options.join('')}</select>`;
  }
  function sectionJour(date, index) {
    const els = elements(date);
    const n = (g) => els.filter((x) => x.genre === g).length;
    const morceaux = []; if (n('own')) morceaux.push(Fmt.pluriel(n('own'), 'événement')); if (n('arr')) morceaux.push(Fmt.pluriel(n('arr'), 'arrivée')); if (n('co')) morceaux.push(n('co') + ' check-out');
    const nuitDuJour = nuit(date);
    return `<section class="jour" id="jour-${date}"><header><b>${h(capitalise(Fmt.nomDuJour(date)))}</b><span class="sec">${h(Fmt.dateCourte(date))}</span><span class="j">J${index + 1}</span><span class="resume">${h(morceaux.join(' · '))}</span></header>
      <div class="ligne-ville">📍 ${villeMenu(date)}${nuitDuJour ? `<span class="nuit">🌙 ${h(nuitDuJour)}</span>` : ''}</div>
      ${els.length ? els.map(carteElement).join('') : '<p class="vide">Rien de prévu pour l\'instant.</p>'}
      <button type="button" class="btn-ajouter" data-action="creer" data-date="${date}">＋ Ajouter un événement</button></section>`;
  }
  function horsPeriode() {
    const n = Regles.horsPeriode(etat.voyage, etat.evenements);
    return n > 0 ? bandeau(`${Fmt.pluriel(n, 'événement')} hors des dates du voyage, conservé${n > 1 ? 's' : ''} mais masqué${n > 1 ? 's' : ''}. Élargissez les dates dans les paramètres pour les revoir.`, '', '📅') : '';
  }

  // ---- cartes
  const styleType = (t) => `--teinte:#${Types.teinte(t)};--encre-type:#${Types.teinteTexte(t)}`;
  const colonneHeure = (debut, fin, decalage) => `<div class="heure"><b>${h(debut || '—')}</b>${fin ? `<span>→ ${h(fin)}${decalage ? ' ' + h(decalage) : ''}</span>` : ''}</div>`;
  function carteElement(el) { const ev = el.evenement; if (el.genre === 'arr') return carteArrivee(ev); if (el.genre === 'co') return carteCheckOut(ev); return carteEvenement(ev); }
  function carteEvenement(ev) {
    if (!peutVoir(ev)) return carteOccupe(ev, 'Occupé', null, '🔒');
    const confl = conflits(ev); const attenue = !Regles.filtreCorrespond(etat.filtre, ev);
    const lux = Fuseaux.heureALuxembourg(ev.debut, ev.date, villePour(ev));
    return `<article class="carte rel-${relation(ev)}${attenue ? ' attenue' : ''}${confl.length ? ' conflit' : ''}" style="${styleType(ev.type)}" data-action="ouvrir" data-id="${h(ev.id)}">
      ${colonneHeure(ev.debut, ev.fin, Regles.decalageJour(ev))}<div class="icone">${Regles.emoji(ev)}</div>
      <div class="corps"><div class="titre-ligne"><span class="titre${ev.titre ? '' : ' sec'}">${h(ev.titre || '(à compléter)')}</span><span class="etiquette">${h(Regles.etiquette(ev))}</span>${chipRelation(ev)}</div>
      ${sousDetails(ev)}${champsPourMoi(ev)}${lux ? `<div class="mini">🕐 ${h(lux)}</div>` : ''}${ev.notes ? `<div class="notes">${h(ev.notes)}</div>` : ''}${chipsParticipants(ev, false)}${confl.length ? alerteConflit(confl) : ''}${signature(ev)}</div>
      <button type="button" class="plus" data-action="menu" data-id="${h(ev.id)}" aria-label="Plus d'actions">⋯</button></article>`;
  }
  function carteOccupe(ev, libelle, heure, symbole) {
    const p = Regles.personnesPourOccupe(ev, etat.voyage.nomsDansOccupe); const attenue = !Regles.filtreCorrespond(etat.filtre, ev);
    const puces = p.noms.map((n) => `<span class="puce">${h(n)}</span>`).concat(p.externes ? [`<span class="puce externe">+${p.externes} externe</span>`] : []);
    return `<article class="carte occupe rel-aucun${attenue ? ' attenue' : ''}">${colonneHeure(heure !== null && heure !== undefined ? heure : ev.debut, heure === null || heure === undefined ? ev.fin : '', heure === null || heure === undefined ? Regles.decalageJour(ev) : '')}<div class="icone verrou">${symbole || '🔒'}</div><div class="corps"><div class="titre-ligne"><span class="titre">${h(libelle)}</span><span class="mini">· détail privé</span></div>${puces.length ? `<div class="chips">${puces.join('')}</div>` : ''}</div></article>`;
  }
  function carteArrivee(ev) {
    if (!peutVoir(ev)) return carteOccupe(ev, 'Arrivée — occupé', ev.fin, '🛬');
    const attenue = !Regles.filtreCorrespond(etat.filtre, ev);
    return `<article class="carte derivee rel-${relation(ev)}${attenue ? ' attenue' : ''}" style="${styleType(ev.type)}" data-action="ouvrir" data-id="${h(ev.id)}">${colonneHeure(ev.fin, '', '')}<div class="icone">${ev.type === 'vol' ? '🛬' : '🚉'}</div>
      <div class="corps"><div class="titre-ligne"><span class="titre">${h(titreOuType(ev))}</span><span class="etiquette">Arrivée</span>${chipRelation(ev)}</div>${champDe(ev, 'arrLieu') ? `<div class="details">🧭 ${h(champDe(ev, 'arrLieu'))}</div>` : ''}<div class="mini">Parti le ${h(Fmt.dateMini(ev.date))}${ev.debut ? ' à ' + h(ev.debut) : ''}${champDe(ev, 'depLieu') ? ' de ' + h(champDe(ev, 'depLieu')) : ''}</div>${chipsParticipants(ev, true)}</div></article>`;
  }
  function carteCheckOut(ev) {
    if (!peutVoir(ev)) return carteOccupe(ev, 'Check-out — occupé', ev.fin, '🧳');
    const attenue = !Regles.filtreCorrespond(etat.filtre, ev);
    return `<article class="carte derivee rel-${relation(ev)}${attenue ? ' attenue' : ''}" style="${styleType('hotel')}" data-action="ouvrir" data-id="${h(ev.id)}">${colonneHeure(ev.fin, '', '')}<div class="icone">🧳</div>
      <div class="corps"><div class="titre-ligne"><span class="titre">${h(titreOuType(ev))}</span><span class="etiquette">Check-out</span>${chipRelation(ev)}</div>${Plan.resumeDuLieu(ev) ? `<div class="details">${h(Plan.resumeDuLieu(ev))}</div>` : ''}<div class="mini">Arrivé le ${h(Fmt.dateMini(ev.date))}</div>${chipsParticipants(ev, true)}</div></article>`;
  }
  const MASQUES_DETAILS = ['depLieu', 'arrLieu', 'adresse', 'lienCarte', 'depTz', 'arrTz', 'arrDay'];
  function horairesTrajet(ev) {
    if (!ev.debut && !ev.fin) return '';
    const zone = (cle) => { const z = champDe(ev, cle); return z && Fuseaux.estConnue(z) ? ' ' + z : ''; };
    const morceaux = []; if (ev.debut) morceaux.push(`🛫 ${ev.debut}${zone('depTz')}`);
    if (ev.fin) { const dj = Regles.decalageJour(ev); morceaux.push(`🛬 ${ev.fin}${zone('arrTz')}${dj ? ' ' + dj : ''}`); }
    const duree = Regles.dureeTrajet(ev);
    return morceaux.join('  →  ') + (duree ? ' · ' + duree : '');
  }
  function sousDetails(ev) {
    const lignes = [];
    if (champDe(ev, 'depLieu') || champDe(ev, 'arrLieu')) lignes.push(`🧭 ${champDe(ev, 'depLieu') || '?'} → ${champDe(ev, 'arrLieu') || '?'}`);
    const lieu = Plan.resumeDuLieu(ev); if (lieu) lignes.push(lieu);
    if (Types.estTrajet(ev.type)) { const hz = horairesTrajet(ev); if (hz) lignes.push(hz); }
    const reste = Types.champs(ev.type).filter((c) => !MASQUES_DETAILS.includes(c.cle) && champDe(ev, c.cle)).map((c) => `${c.libelle} : ${c.genre === 'date' ? Fmt.dateMini(champDe(ev, c.cle)) : champDe(ev, c.cle)}`);
    if (reste.length) lignes.push(reste.join(' · '));
    return lignes.length ? `<div class="details">${lignes.map((l) => `<div>${h(l)}</div>`).join('')}</div>` : '';
  }
  function champsPourMoi(ev) {
    const moi = etat.moi ? etat.moi.nom : null; if (!moi) return '';
    const table = (ev.champsPersonnels || {})[moi] || {};
    const miens = Types.champsPersonnels(ev.type).filter((c) => table[c.cle]);
    return miens.length ? `<div class="pour-moi">👤 ${h(miens.map((c) => `${c.libelle} : ${table[c.cle]}`).join(' · '))}</div>` : '';
  }
  function puce(nom, presence, externe) { return `<span class="puce${externe ? ' externe' : ''}">${h(nom)}${presence ? `<span class="h">🕒 ${h(presence.from || '?')}–${h(presence.to || '?')}</span>` : ''}</span>`; }
  function chipsParticipants(ev, sansHoraires) {
    if (!ev.participants.length && !(ev.lecteurs || []).length && !ev.autre) return '<div class="mini ter">aucun participant coché</div>';
    const p = ev.presence || {};
    return `<div class="chips">${ev.participants.map((n) => puce(n, sansHoraires ? null : p[n], false)).join('')}${(ev.lecteurs || []).map((n) => puce('👁 ' + n, null, false)).join('')}${ev.autre ? puce(ev.autreNom || 'Autre', sansHoraires ? null : p[ev.autreNom || 'Autre'], true) : ''}</div>`;
  }
  function alerteConflit(confl) {
    const gens = []; for (const c of confl) for (const p of c.personnes) if (!gens.includes(p)) gens.push(p);
    const autres = confl.map((c) => `« ${peutVoir(c.autre) ? (c.autre.titre || 'sans titre') : '(occupé)'} »${c.autre.debut ? ` (${c.autre.debut})` : ''}`);
    return `<div class="alerte-conflit">⚠️ Conflit d'agenda pour ${h(gens.join(', '))} — chevauche ${h(autres.join(', '))}</div>`;
  }
  function signature(ev) { const m = []; if (ev.auteur) m.push(`🖊️ Créé par ${ev.auteur}`); if (ev.editeur) m.push(`✏️ Modifié par ${ev.editeur}`); return m.length ? `<div class="signature">${h(m.join(' · '))}</div>` : ''; }
  function boutonsPlan(ev) {
    const actions = Plan.actions(ev); if (!actions.length) return '';
    return `<div class="menu-actions">${actions.map((a) => a.url ? `<a class="bouton sobre" href="${h(a.url)}" target="_blank" rel="noopener">🗺️ ${h(a.libelle)}</a>` : `<button type="button" class="bouton" data-action="copier" data-texte="${h(a.texte)}">📋 ${h(a.libelle)}</button>`).join('')}</div>`;
  }

  // ---------------------------------------------------------------- semaine
  const HAUTEUR_HEURE = 52;
  function contenuSemaine(jours) {
    const c = { segments: {}, sansHeure: {}, horaires: [] };
    for (const j of jours) { c.segments[j] = []; c.sansHeure[j] = []; }
    for (const ev of etat.evenements) {
      if (Fmt.minutes(ev.debut) === null) { if (c.sansHeure[ev.date]) c.sansHeure[ev.date].push(ev); continue; }
      let retenu = false;
      for (const seg of Regles.segments(ev)) if (c.segments[seg.date]) { c.segments[seg.date].push(seg); retenu = true; }
      if (retenu) c.horaires.push(ev);
    }
    for (const j of jours) c.segments[j] = Regles.disposer(c.segments[j]);
    return c;
  }
  function bornes(c) {
    let minM = 8 * 60, maxM = 20 * 60;
    for (const ev of c.horaires) {
      const s = Fmt.minutes(ev.debut); if (s === null) continue;
      minM = Math.min(minM, s); maxM = Math.max(maxM, s + 30);
      const te = Fmt.minutes(ev.fin);
      if (te !== null && te > s) { minM = Math.min(minM, te); maxM = Math.max(maxM, te); } else maxM = Math.max(maxM, s + 60);
    }
    const gMin = Math.max(0, Math.floor(minM / 60) * 60); let gMax = Math.min(1440, Math.ceil(maxM / 60) * 60);
    if (gMax <= gMin) gMax = Math.min(1440, gMin + 60);
    return { min: gMin, max: gMax };
  }
  function lignesBloc(seg) {
    const ev = seg.evenement, icone = Regles.emoji(ev), titre = titreOuType(ev);
    switch (seg.partie) {
      case 'debut': return [`${icone} ${titre}`, `🛫 ${ev.debut}`];
      case 'fin': return [`🛬 ${ev.fin}`, titre];
      case 'plein': return [`${icone} ${titre}`, '(en cours)'];
      default: return [`${icone} ${titre}`, ev.debut];
    }
  }
  function lundiAffiche() { if (etat.lundiChoisi) return etat.lundiChoisi; const a = Fmt.aujourdhui(); return Fmt.lundi(Voyage.contient(etat.voyage, a) ? a : etat.voyage.debut); }
  function vueSemaine() {
    const lundi = lundiAffiche(); const jours = Array.from({ length: 7 }, (_, i) => Fmt.ajouterJours(lundi, i));
    const c = contenuSemaine(jours); const b = bornes(c); const pxMin = HAUTEUR_HEURE / 60; const hauteur = (b.max - b.min) * pxMin;
    const aujourdhui = Fmt.aujourdhui(); const j0 = Fmt.composants(jours[0]), j6 = Fmt.composants(jours[6]);
    const libelle = j0 && j6 ? `${j0.jour} ${Fmt.moisCourt[j0.mois - 1]} → ${j6.jour} ${Fmt.moisCourt[j6.mois - 1]} ${j6.annee}` : '';
    const aUneLigneJour = jours.some((j) => c.sansHeure[j].length);
    let html = `<div class="sem-nav"><button type="button" class="outil" data-action="semaine-precedente" aria-label="Semaine précédente">‹</button><span class="lib">${h(libelle)}</span><button type="button" class="outil" data-action="semaine-suivante" aria-label="Semaine suivante">›</button></div>`;
    html += `<div class="grille"><div class="tete"><div></div>${jours.map((d) => { const dans = Voyage.contient(etat.voyage, d); const comp = Fmt.composants(d); return `<div class="${dans ? 'voyage' : 'hors'}${d === aujourdhui ? ' aujourdhui' : ''}">${h(Fmt.nomDuJourCourt(d).toUpperCase())}<b>${comp ? comp.jour : '?'}</b></div>`; }).join('')}</div>`;
    if (aUneLigneJour) html += `<div class="ligne-jour"><div class="lib">JOUR</div>${jours.map((d) => `<div class="cel">${c.sansHeure[d].map((ev) => { const visible = peutVoir(ev); return `<button type="button" class="puce-jour${Regles.filtreCorrespond(etat.filtre, ev) ? '' : ' attenue'}" style="${visible ? styleType(ev.type) : ''}" data-action="ouvrir" data-id="${h(ev.id)}"${visible ? '' : ' disabled'}>${visible ? h(Regles.emoji(ev) + ' ' + titreOuType(ev)) : '🔒'}</button>`; }).join('')}</div>`).join('')}</div>`;
    html += `<div class="corps-sem"><div class="gouttiere" style="height:${hauteur}px">${(() => { let s = ''; for (let hh = b.min / 60; hh <= b.max / 60; hh++) s += `<span style="top:${(hh * 60 - b.min) * pxMin}px">${String(hh).padStart(2, '0')}</span>`; return s; })()}</div>`;
    html += `<div class="colonnes" style="height:${hauteur}px;background-size:100% ${HAUTEUR_HEURE}px">${jours.map((d) => {
      const dans = Voyage.contient(etat.voyage, d);
      const blocs = c.segments[d].map((seg) => {
        const s = Math.max(b.min, seg.debut), e = Math.min(b.max, seg.fin); if (e <= s) return '';
        const visible = peutVoir(seg.evenement); const enConflit = conflits(seg.evenement).length > 0;
        const [l1, l2] = visible ? lignesBloc(seg) : ['🔒', ''];
        const largeur = 100 / Math.max(1, seg.colonnes);
        return `<div class="bloc rel-${visible ? relation(seg.evenement) : 'aucun'} ${seg.partie === 'full' ? '' : seg.partie}${visible ? '' : ' occupe'}${enConflit ? ' conflit' : ''}${Regles.filtreCorrespond(etat.filtre, seg.evenement) ? '' : ' attenue'}" style="${visible ? styleType(seg.evenement.type) : ''};top:${(s - b.min) * pxMin}px;height:${Math.max(14, (e - s) * pxMin)}px;left:calc(${seg.colonne * largeur}% + 1px);width:calc(${largeur}% - 2px)"${visible ? ` data-action="ouvrir" data-id="${h(seg.evenement.id)}"` : ''}><b>${h(l1)}</b>${l2 ? `<span>${h(l2)}</span>` : ''}</div>`;
      }).join('');
      let maintenant = '';
      if (d === aujourdhui) { const now = new Date(); const m = now.getHours() * 60 + now.getMinutes(); if (m >= b.min && m <= b.max) maintenant = `<div class="maintenant" style="left:0;right:0;top:${(m - b.min) * pxMin - 1}px"></div>`; }
      return `<div class="col${dans ? ' voyage' : ''}">${blocs}${maintenant}</div>`;
    }).join('')}</div></div></div>`;
    return html;
  }

  // ---------------------------------------------------------------- voyageurs
  function teinteNom(nom) { const t = ['#1E5AE8', '#38BDF8', '#6366F1', '#2DD4BF', '#0B2A6F', '#5B7BA6']; let s = 0; for (const c of nom) s += c.codePointAt(0); return t[s % t.length]; }
  function vueVoyageurs() {
    const moi = etat.moi ? etat.moi.nom : null;
    let html = bandeau(h(DESCRIPTION_PARTAGE + ' Les lecteurs se choisissent sur chaque événement, par celui qui l\'édite.'), 'jade', '👁');
    html += `<div class="panneau"><h3>Les voyageurs</h3>${etat.voyage.participants.map((n) => {
      const fiche = etat.membres.find((x) => x.id === 'local:' + n);
      const m = []; if (fiche) m.push(fiche.creePar ? (fiche.creePar === monCompte() ? 'prénom lié à votre compte Apple' : 'prénom lié à un compte Apple') : "a rejoint l'app"); const k = nombreDEvenements(n); if (k) m.push(Fmt.pluriel(k, 'événement'));
      const liberer = estOrganisateur() && fiche ? `<button type="button" class="lien-bouton" data-action="liberer" data-nom="${h(n)}">Libérer</button>` : '';
      return `<div class="personne"><span class="avatar" style="background:${teinteNom(n)}">${h(n.slice(0, 1).toUpperCase())}</span><span class="nom">${h(n)}<small>${h(m.length ? m.join(' · ') : '—')}</small></span>${n === etat.voyage.organisateur ? '<span class="etiquette neutre">Organisateur</span>' : ''}${n === moi ? '<span class="etiquette discret">vous</span>' : ''}${liberer}</div>`;
    }).join('')}<p class="note">${estOrganisateur() ? 'La liste se complète dans les paramètres du voyage. « Libérer » rend un prénom à qui veut le prendre, par exemple quand quelqu\'un change de compte Apple.' : 'Seul l\'organisateur complète cette liste.'} Un prénom appartient au premier compte Apple qui le choisit.</p></div>`;
    if (estOrganisateur()) html += `<button type="button" class="bouton sobre" data-action="parametres">Modifier la liste…</button>`;
    return html;
  }

  // ---------------------------------------------------------------- réglages
  function vueReglages() {
    const moi = etat.moi ? etat.moi.nom : ''; const b = compteBoite(); const apparence = local.lire(Cles.apparence, 'systeme');
    let html = `<div class="panneau"><h3>Identité</h3><div class="ligne"><label for="r-identite">Je suis</label><select id="r-identite" data-change="identite">${moi ? '' : '<option value="" selected>— à choisir —</option>'}${etat.voyage.participants.map((n) => `<option value="${h(n)}"${n === moi ? ' selected' : ''}>${h(n)}</option>`).join('')}</select></div><div class="ligne"><span class="lib">Rôle</span><span class="sec">${etat.moi ? (estOrganisateur() ? 'Organisateur' : 'Voyageur') : '—'}</span></div><p class="note">Votre prénom décide de ce que vous voyez en clair ; il appartient au premier compte Apple qui le choisit. Seul l'organisateur ajoute un voyageur ou libère un prénom.</p></div>`;
    if (etat.moi) html += `<div class="panneau"><div class="ligne"><label for="r-organisateur">Je suis l'organisateur</label><input type="checkbox" id="r-organisateur" data-change="organisateur"${estOrganisateur() ? ' checked' : ''}></div><p class="note">L'organisateur voit tout en clair, règle le voyage et reçoit les signalements.</p></div>`;
    html += `<div class="panneau"><h3>Apparence</h3><div class="pilules">${[['systeme', '◐ Automatique'], ['clair', '☀️ Jour'], ['sombre', '🌙 Nuit']].map(([v, l]) => `<button type="button" class="pilule${apparence === v ? ' active' : ''}" data-action="apparence" data-valeur="${v}">${l}</button>`).join('')}</div><p class="note">« Automatique » suit le réglage du téléphone. Le choix ne vaut que pour ce navigateur. La couleur de l'app (Réglages ▸ Couleur sur iPhone) n'existe pas encore ici.</p></div>`;
    html += `<div class="panneau"><h3>Aide</h3><div class="ligne"><button type="button" class="lien-bouton" data-action="notice">📖 Mode d'emploi</button></div><div class="ligne"><button type="button" class="lien-bouton" data-action="conditions">✋ Conditions d'utilisation</button></div>${estOrganisateur() ? '<div class="ligne"><button type="button" class="lien-bouton" data-action="signalements">💬 Signalements reçus</button></div>' : ''}</div>`;
    const m = Array.from(masques()).sort();
    if (m.length) html += `<div class="panneau"><h3>Personnes masquées</h3>${m.map((n) => `<div class="ligne"><span class="lib">${h(n)}</span><button type="button" class="lien-bouton" data-action="demasquer" data-nom="${h(n)}">Afficher à nouveau</button></div>`).join('')}<p class="note">Leurs événements n'apparaissent pas dans ce navigateur. Rien n'est effacé.</p></div>`;
    html += `<div class="panneau"><h3>Voyage</h3><button type="button" class="bouton sobre" data-action="parametres"${estOrganisateur() ? '' : ' disabled'}>Paramètres du voyage…</button><p class="note">Titre, dates, participants, villes. Réservé à l'organisateur. Renommer un prénom ou réinitialiser le voyage se fait dans l'app iPhone.</p></div>`;
    html += `<div class="panneau"><h3>Compte</h3><div class="ligne"><span class="lib">${DEMO ? 'Démonstration' : 'Identifiant Apple'}</span><span class="sec">${DEMO ? 'données fictives' : 'connecté'}</span></div><div id="place-deconnexion" class="apple-boutons"></div><p class="note">La déconnexion ne retire rien de l'agenda : elle ferme simplement la page à ce navigateur.</p></div>`;
    html += `<div class="panneau"><h3>Données</h3><div class="ligne"><span class="lib">Dernière synchronisation</span><span class="sec">${etat.synchroniseLe ? h(Fmt.age(etat.synchroniseLe)) : 'jamais'}</span></div><div class="ligne"><span class="lib">En attente d'envoi</span><span class="sec">${b.enAttente}${b.bloques ? ` · ${b.bloques} bloquée${b.bloques > 1 ? 's' : ''}` : ''}</span></div>${b.bloques ? `<div class="ligne"><button type="button" class="lien-bouton" data-action="reessayer-envois">Réessayer les envois</button><button type="button" class="lien-bouton danger" data-action="oublier-envois">Abandonner les envois bloqués</button></div>` : ''}<div class="ligne"><button type="button" class="lien-bouton" data-action="synchroniser">↻ Synchroniser maintenant</button></div><p class="note">L'agenda affiché est gardé dans ce navigateur pour s'ouvrir sans réseau ; ce qui n'a pas pu partir attend dans une boîte d'envoi.</p></div>`;
    html += `<div class="panneau"><h3>À propos</h3><div class="ligne"><span class="lib">Version</span><span class="sec">${h(VERSION)}</span></div><p class="note">Termin reprend l'agenda partagé du voyage : mêmes types d'événements, mêmes règles, même cloisonnement que l'app iPhone. L'agenda est partagé par iCloud entre les voyageurs ; aucun suivi.</p>${rappelRegle()}</div>`;
    return html;
  }

  // ---------------------------------------------------------------- formulaire d'événement
  let formulaire = null;
  function normaliseLeLieu(b) {
    const adresse = (b.champs.adresse || '').trim(), carte = (b.champs.lienCarte || '').trim();
    if (!carte) { delete b.champs.lienCarte; return; }
    if (!adresse) { b.champs.adresse = carte; delete b.champs.lienCarte; } else if (adresse === carte) delete b.champs.lienCarte;
  }
  function ouvrirFormulaire(ev, nouveau) {
    const b = cloner(ev); normaliseLeLieu(b);
    formulaire = { brouillon: b, nouveau };
    ouvrirFeuille({ id: 'formulaire', titre: nouveau ? 'Nouveau' : 'Modifier', bloquee: true, gauche: { libelle: 'Annuler', action: fermerFeuille }, droite: { libelle: 'Enregistrer', action: enregistrerDepuisFormulaire }, corps: corpsFormulaire() });
  }
  function rafraichirFormulaire() { const f = $('#feuille-formulaire .defile'); if (f && formulaire) f.innerHTML = corpsFormulaire(); }
  const libelleJour = (date) => { const v = jour(date).ville; return Fmt.dateMini(date) + (v ? ' · ' + v : ''); };
  function libelleDebut(b) { if (b.type !== 'repas') return Types.libelleDebut(b.type); if (!b.debut) return "Début · selon l'heure"; const r = Regles.repas(b.debut); return `Début · ${r.emoji} ${r.libelle}`; }
  function corpsFormulaire() {
    const b = formulaire.brouillon, moi = etat.moi ? etat.moi.nom : null;
    const principal = Types.champPrincipal(b.type);
    const dates = datesDuVoyage().slice(); if (!dates.includes(b.date)) { dates.push(b.date); dates.sort(); }
    const champsDate = Types.champs(b.type).filter((c) => c.genre === 'date'), champsAutres = Types.champs(b.type).filter((c) => c.genre !== 'date');
    const dernierLieu = champsAutres.map((c) => c.cle).lastIndexOf('adresse');
    const concernees = Regles.personnesConcernees(b);
    const candidats = etat.voyage.participants.filter((n) => !b.participants.includes(n) && n !== b.auteur);
    const trajetAvecHeure = Types.estTrajet(b.type) && !!b.debut;
    let html = `<div class="panneau"><h3>Quoi</h3><div class="ligne"><label for="f-type">Type</label><select id="f-type" data-change="f-type">${Types.ordre.map((t) => `<option value="${t}"${t === b.type ? ' selected' : ''}>${Types.emoji(t)} ${h(Types.libelle(t))}</option>`).join('')}</select></div><div class="ligne"><label for="f-titre">${h(principal.libelle)}</label><input id="f-titre" type="text" data-champ="titre" value="${h(b.titre)}" placeholder="${h(principal.indication)}"></div></div>`;
    html += `<div class="panneau"><h3>Quand</h3><div class="ligne"><label for="f-date">Jour</label><select id="f-date" data-change="f-date">${dates.map((d) => `<option value="${d}"${d === b.date ? ' selected' : ''}>${h(libelleJour(d))}</option>`).join('')}</select></div><div class="ligne"><label for="f-debut" id="f-lib-debut">${h(libelleDebut(b))}</label><input id="f-debut" type="time" data-champ="debut" value="${h(b.debut)}"></div>${champsDate.map((c) => `<div class="ligne"><label for="f-x-${c.cle}">${h(c.libelle)}</label><input id="f-x-${c.cle}" type="date" data-x="${c.cle}" value="${h(b.champs[c.cle] || '')}"></div>`).join('')}<div class="ligne"><label for="f-fin">${h(Types.libelleFin(b.type))}</label><input id="f-fin" type="time" data-champ="fin" value="${h(b.fin)}"></div><div class="ligne" id="f-arrivee"${trajetAvecHeure ? '' : ' hidden'}><span class="lib">Arrivée le</span><span class="sec">${trajetAvecHeure ? h(Fmt.dateMini(Regles.jourArrivee(b))) : ''}</span></div></div>`;
    if (champsAutres.length) {
      html += `<div class="panneau"><h3>Détails</h3>${champsAutres.map((c, i) => {
        let ligne;
        if (c.genre === 'fuseau') ligne = `<div class="ligne"><label for="f-x-${c.cle}">${h(c.libelle)}</label><select id="f-x-${c.cle}" data-x="${c.cle}"><option value="">—</option>${Fuseaux.noms.map((n) => `<option value="${h(n)}"${(b.champs[c.cle] || '') === n ? ' selected' : ''}>${h(Fuseaux.libelle(n, b.date))}</option>`).join('')}</select></div>`;
        else if (c.genre === 'jourArrivee') ligne = `<div class="ligne"><label for="f-x-${c.cle}">${h(c.libelle)}</label><select id="f-x-${c.cle}" data-x="${c.cle}"><option value="">Automatique</option><option value="1"${b.champs[c.cle] === '1' ? ' selected' : ''}>Le lendemain (+1 j)</option><option value="2"${b.champs[c.cle] === '2' ? ' selected' : ''}>Le surlendemain (+2 j)</option></select></div>`;
        else ligne = `<div class="ligne"><label for="f-x-${c.cle}">${h(c.libelle)}</label><input id="f-x-${c.cle}" type="text" data-x="${c.cle}" value="${h(b.champs[c.cle] || '')}" placeholder="${h(c.indication)}"${c.cle === 'tel' ? ' inputmode="tel"' : ''}${c.cle === 'adresse' ? ' autocomplete="off"' : ''}></div>`;
        if (i === dernierLieu) ligne += `<div id="f-plan">${boutonsPlan(b)}</div>`;
        return ligne;
      }).join('')}${dernierLieu < 0 ? `<div id="f-plan">${boutonsPlan(b)}</div>` : ''}</div>`;
    }
    html += `<div class="panneau"><h3>👤 Pour moi seul</h3>${moi ? Types.champsPersonnels(b.type).map((c) => `<div class="ligne"><label for="f-p-${c.cle}">${h(c.libelle)}</label><input id="f-p-${c.cle}" type="text" data-perso="${c.cle}" value="${h((b.champsPersonnels[moi] || {})[c.cle] || '')}" placeholder="${h(c.indication)}"></div>`).join('') + `<p class="note">Ces champs sont les vôtres, ${h(moi)} : les autres participants ne les voient pas, chacun remplit les siens.</p>` : '<p class="note">Choisissez d\'abord votre prénom dans Réglages pour remplir vos champs personnels.</p>'}</div>`;
    html += `<div class="panneau"><h3>Notes</h3><div class="ligne"><textarea data-champ="notes" placeholder="Remarques, consignes, réf. dossier…">${h(b.notes)}</textarea></div></div>`;
    html += `<div class="panneau"><h3>Participants</h3><div class="pilules">${etat.voyage.participants.map((n) => `<button type="button" class="pilule${b.participants.includes(n) ? ' active' : ''}" data-action="f-participant" data-nom="${h(n)}">${b.participants.includes(n) ? '✓ ' : ''}${h(n)}</button>`).join('')}<button type="button" class="pilule${b.autre ? ' active' : ''}" data-action="f-autre">${b.autre ? '✓ ' : ''}Autre</button></div>${b.autre ? `<div class="ligne"><input type="text" data-champ="autreNom" value="${h(b.autreNom)}" placeholder="Préciser (nom de l'externe)" style="text-align:left"></div>` : ''}</div>`;
    html += `<div class="panneau"><h3>Lecteurs</h3>${candidats.length ? `<div class="pilules">${candidats.map((n) => `<button type="button" class="pilule jade${b.lecteurs.includes(n) ? ' active' : ''}" data-action="f-lecteur" data-nom="${h(n)}">${b.lecteurs.includes(n) ? '✓ ' : ''}👁 ${h(n)}</button>`).join('')}</div>` : '<p class="note">Tous les voyageurs participent déjà.</p>'}<p class="note">Les participants voient et modifient cet événement ; seul son auteur (et l'organisateur) peut le supprimer. Les lecteurs le voient sans le modifier. Tous les autres ne voient qu'« Occupé ».</p></div>`;
    if (concernees.length) html += `<div class="panneau"><h3>Présence partielle</h3>${concernees.map((p) => b.presence[p] ? `<div class="ligne"><b>${h(p)}</b><button type="button" class="lien-bouton danger" data-action="f-presence-retirer" data-nom="${h(p)}">Retirer</button></div><div class="ligne"><label>de</label><input type="time" data-presence="${h(p)}|from" value="${h(b.presence[p].from || '')}"></div><div class="ligne"><label>à</label><input type="time" data-presence="${h(p)}|to" value="${h(b.presence[p].to || '')}"></div>` : `<div class="ligne"><button type="button" class="lien-bouton" data-action="f-presence-ajouter" data-nom="${h(p)}">Limiter la présence de ${h(p)}</button></div>`).join('')}<p class="note">Si quelqu'un n'assiste qu'à une partie du créneau. Sert à la détection des conflits.</p></div>`;
    if (!formulaire.nouveau && peutSupprimer(b)) html += `<div class="panneau"><button type="button" class="bouton danger" data-action="f-supprimer">Supprimer cet événement</button></div>`;
    return html;
  }
  function saisieFormulaire(el) {
    if (!formulaire) return; const b = formulaire.brouillon;
    if (el.dataset.champ !== undefined) b[el.dataset.champ] = el.value;
    else if (el.dataset.x !== undefined) { if (el.value) b.champs[el.dataset.x] = el.value; else delete b.champs[el.dataset.x]; if (el.dataset.x === 'adresse') { const z = $('#f-plan'); if (z) z.innerHTML = boutonsPlan(b); } }
    else if (el.dataset.perso !== undefined) { const moi = etat.moi ? etat.moi.nom : null; if (!moi) return; const table = Object.assign({}, b.champsPersonnels[moi] || {}); if (el.value) table[el.dataset.perso] = el.value; else delete table[el.dataset.perso]; if (Object.keys(table).length) b.champsPersonnels[moi] = table; else delete b.champsPersonnels[moi]; }
    else if (el.dataset.presence !== undefined) { const [nom, cle] = el.dataset.presence.split('|'); const f = Object.assign({ from: '', to: '' }, b.presence[nom] || {}); f[cle] = el.value; b.presence[nom] = f; }
    else return;
    const lib = $('#f-lib-debut'); if (lib) lib.textContent = libelleDebut(b);
    const arr = $('#f-arrivee'); if (arr) { const ok = Types.estTrajet(b.type) && !!b.debut; arr.hidden = !ok; if (ok) $('.sec', arr).textContent = Fmt.dateMini(Regles.jourArrivee(b)); }
  }
  async function enregistrerDepuisFormulaire(fond) {
    if (!formulaire) return; const b = formulaire.brouillon; if (!b.date) return;
    $('.droite', fond).disabled = true;
    const confl = await enregistrer(b);
    fermerFeuille(fond);
    if (confl === null) return;
    if (confl.length) {
      const gens = []; for (const c of confl) for (const p of c.personnes) if (!gens.includes(p)) gens.push(p);
      const premier = confl[0]; const titre = peutVoir(premier.autre) ? (premier.autre.titre || 'événement sans titre') : '(occupé)';
      toast(`⚠️ Conflit : ${gens.join(', ')} déjà pris·e sur ce créneau — « ${titre} »${premier.autre.debut ? ' à ' + premier.autre.debut : ''}`, true);
    } else toast('Enregistré');
  }

  // ---------------------------------------------------------------- détail (lecture seule), menus
  function ouvrir(ev) { if (!peutVoir(ev)) return; if (peutModifier(ev)) ouvrirFormulaire(ev, false); else ouvrirDetail(ev); }
  function ouvrirDetail(ev) {
    const moi = etat.moi ? etat.moi.nom : null;
    ouvrirFeuille({ titre: 'Événement', gauche: ev.auteur !== moi ? { libelle: '⋯', action: () => menuModeration(ev) } : null, droite: { libelle: 'Fermer', action: fermerFeuille }, corps: corpsDetail(ev) });
  }
  function ligneDetail(lib, valeur) { return `<div class="ligne"><span class="lib">${h(lib)}</span><span class="sec" style="text-align:right">${valeur}</span></div>`; }
  function corpsDetail(ev) {
    const moi = etat.moi ? etat.moi.nom : null;
    let html = `<div class="panneau" style="${styleType(ev.type)}"><div style="display:flex;gap:12px;align-items:flex-start;margin-bottom:6px"><div class="icone" style="width:44px;height:44px;font-size:22px">${Regles.emoji(ev)}</div><div><div style="font-size:18px;font-weight:600">${h(titreOuType(ev))}</div><span class="etiquette">${h(Regles.etiquette(ev))}</span></div></div>`;
    html += ligneDetail('Jour', h(`${Fmt.nomDuJour(ev.date)} ${Fmt.dateCourte(ev.date)}`));
    for (const c of Types.champs(ev.type).filter((x) => x.genre === 'date' && champDe(ev, x.cle))) html += ligneDetail(c.libelle, h(Fmt.dateMini(champDe(ev, c.cle))));
    if (ev.debut || ev.fin) html += ligneDetail('Horaire', h(`${ev.debut || '—'}${ev.fin ? ' → ' + ev.fin : ''}${Regles.decalageJour(ev) ? ' ' + Regles.decalageJour(ev) : ''}`));
    const lux = Fuseaux.heureALuxembourg(ev.debut, ev.date, villePour(ev)); if (lux) html += ligneDetail('Luxembourg', h(lux));
    html += '</div>';
    const champs = Types.champs(ev.type).filter((c) => c.genre !== 'date' && champDe(ev, c.cle));
    if (champs.length) {
      html += `<div class="panneau"><h3>Détails</h3>${champs.map((c) => {
        const v = champDe(ev, c.cle);
        if (c.cle === 'tel') { const propre = v.trim(); const href = propre.includes('@') ? 'mailto:' + propre : 'tel:' + propre.replace(/[^+0-9]/g, ''); return ligneDetail(c.libelle, `<a href="${h(href)}">${h(v)}</a>`); }
        if (c.cle === 'adresse') return ligneDetail(c.libelle, h(Plan.lien(v) ? 'lien collé' : v));
        if (c.cle === 'lienCarte') return '';
        if (c.cle === 'arrDay') return ligneDetail(c.libelle, h(v === '1' ? 'le lendemain (+1 j)' : '+' + v + ' j'));
        return ligneDetail(c.libelle, h(v));
      }).join('')}${Types.estTrajet(ev.type) && Regles.dureeTrajet(ev) ? ligneDetail('Durée', h(Regles.dureeTrajet(ev))) : ''}${boutonsPlan(ev)}</div>`;
    }
    const table = (ev.champsPersonnels || {})[moi] || {}; const miens = Types.champsPersonnels(ev.type).filter((c) => table[c.cle]);
    if (miens.length) html += `<div class="panneau"><h3>👤 Pour moi seul</h3>${miens.map((c) => ligneDetail(c.libelle, h(table[c.cle]))).join('')}</div>`;
    if (ev.notes) html += `<div class="panneau"><h3>Notes</h3><div class="notes" style="color:var(--encre)">${h(ev.notes)}</div></div>`;
    html += `<div class="panneau"><h3>Participants</h3>${chipsParticipants(ev, false)}</div>`;
    html += `<div class="panneau">${signature(ev)}${peutModifier(ev) ? '' : '<p class="note">👁 Vous êtes lecteur de cet événement : lecture seule</p>'}</div>`;
    return html;
  }
  function menuCarte(ev) {
    const moi = etat.moi ? etat.moi.nom : null; let corps = '<div class="menu-actions">';
    if (peutVoir(ev)) corps += `<button type="button" class="bouton" data-action="ouvrir-depuis-menu" data-id="${h(ev.id)}">${peutModifier(ev) ? '✏️ Modifier' : '👁 Voir le détail'}</button>`;
    corps += boutonsPlan(ev).replace('<div class="menu-actions">', '').replace(/<\/div>$/, '');
    if (ev.auteur !== moi) corps += `<button type="button" class="bouton" data-action="signaler" data-id="${h(ev.id)}">💬 Signaler cet événement…</button><button type="button" class="bouton danger" data-action="masquer" data-nom="${h(ev.auteur)}">🙈 Masquer les événements de ${h(ev.auteur)}</button>`;
    corps += '</div>';
    ouvrirFeuille({ titre: titreOuType(ev), droite: { libelle: 'Fermer', action: fermerFeuille }, corps });
  }
  function menuModeration(ev) {
    ouvrirFeuille({ titre: 'Signaler ou masquer', droite: { libelle: 'Fermer', action: fermerFeuille }, corps: `<div class="menu-actions"><button type="button" class="bouton" data-action="signaler" data-id="${h(ev.id)}">💬 Signaler cet événement…</button><button type="button" class="bouton danger" data-action="masquer" data-nom="${h(ev.auteur)}">🙈 Masquer les événements de ${h(ev.auteur)}</button></div>` });
  }

  // ---------------------------------------------------------------- signalement, notice, conditions, paramètres
  let signalement = null;
  function ouvrirSignalement(ev) {
    signalement = { ev, motif: 'confidentialite', precision: '' };
    ouvrirFeuille({ id: 'signalement', titre: 'Signaler', bloquee: true, gauche: { libelle: 'Annuler', action: fermerFeuille }, droite: { libelle: 'Envoyer', action: envoyerSignalement }, corps: corpsSignalement() });
  }
  function corpsSignalement() {
    const s = signalement, ev = s.ev;
    return `<div class="panneau"><h3>Événement</h3><p style="margin:0">${h(`${Types.libelle(ev.type)} · ${titreOuType(ev)} · ${Fmt.dateCourte(ev.date)}`)}</p></div><div class="panneau"><h3>Pourquoi signalez-vous cet événement ?</h3>${MOTIFS.map(([v, l, d]) => `<button type="button" class="signalement-motif${s.motif === v ? ' actif' : ''}" data-action="s-motif" data-motif="${v}"><span class="rond"></span><span>${h(l)}<small>${h(d)}</small></span></button>`).join('')}</div><div class="panneau"><h3>Précision (facultatif)</h3><div class="ligne"><textarea id="s-precision" placeholder="Ce qui vous a alerté…">${h(s.precision)}</textarea></div></div>`;
  }
  async function envoyerSignalement(fond) {
    if (!signalement) return; const s = signalement; const t = $('#s-precision', fond); const precision = t ? t.value.trim() : '';
    $('.droite', fond).disabled = true;
    const ok = await signaler(s.ev, s.motif, precision || null);
    fermerFeuille(fond);
    if (ok) ouvrirFeuille({ titre: 'Signaler', droite: { libelle: 'Fermer', action: fermerFeuille }, corps: `<div class="panneau"><p style="margin:0 0 6px;color:var(--jade);font-weight:600">✓ Signalement transmis</p><p class="note" style="margin:0">L'organisateur l'examinera sous 24 heures. Vous pouvez aussi masquer cette personne si vous ne souhaitez plus voir ses saisies.</p></div>` });
  }
  async function ouvrirSignalements() {
    const fond = ouvrirFeuille({ titre: 'Signalements', droite: { libelle: 'Fermer', action: fermerFeuille }, corps: '<p class="sec" style="padding:14px 0">Chargement…</p>' });
    let liste = []; try { liste = await magasin.chargerSignalements(); } catch (e) { liste = null; }
    const d = $('.defile', fond); if (!d) return;
    if (liste === null) d.innerHTML = '<p class="sec" style="padding:14px 0">Impossible de charger les signalements.</p>';
    else if (!liste.length) d.innerHTML = '<p class="sec" style="padding:14px 0">Aucun signalement. C\'est bon signe.</p>';
    else d.innerHTML = liste.map((s) => `<div class="panneau"><div class="ligne" style="border:0;padding:0 0 4px"><b>${h((MOTIFS.find((m) => m[0] === s.motif) || MOTIFS[3])[1])}</b><span class="mini">${h(Fmt.age(s.creeLe))}</span></div><div>${h(s.resume)}</div>${s.precision ? `<div class="mini">${h(s.precision)}</div>` : ''}<div class="ligne" style="border:0;padding:6px 0 0"><span class="mini">signalé par ${h(s.signaleParNom)}</span><button type="button" class="lien-bouton" data-action="s-clore" data-id="${h(s.id)}">Clore</button></div></div>`).join('');
  }
  const POINTS = [
    ['À quoi ça sert', "Termin est l'agenda partagé d'un voyage professionnel. Chacun y met ses vols, hôtels, rendez-vous et repas ; tout le monde voit qui est pris à quel moment, et retrouve les informations pratiques sans se les redemander."],
    ['Qui êtes-vous', "À la première ouverture, connectez-vous avec votre identifiant Apple, puis choisissez votre prénom dans la liste des voyageurs. Seul l'organisateur y ajoute un prénom. Un prénom appartient au premier compte Apple qui le choisit : personne d'autre ne peut ensuite le prendre ; si vous changez de compte, l'organisateur libère votre prénom. L'organisateur, lui, voit tout et règle le voyage."],
    ["L'agenda et la semaine", "L'onglet Agenda déroule les jours du voyage ; touchez un jour dans la grille du haut pour y aller. L'onglet Semaine donne la vue d'ensemble. Le menu 👁 en haut filtre l'agenda sur une personne. Le bouton ↻ synchronise."],
    ['Ajouter un événement', "Le ＋ en haut à droite, ou « Ajouter un événement » sous un jour. Choisissez le type (vol, transport, hébergement, rendez-vous, repas…), le jour, les heures, les participants. Les champs de la section « Pour moi seul » (ma place, ma chambre, ma note) ne sont visibles que de vous ; le reste est commun."],
    ["L'adresse et le plan", "Dans « Adresse », écrivez l'adresse ou collez un lien Plans / Google Maps (dans Google Maps : bouton Partager, pas « Copier l'adresse »). Les boutons juste en dessous ouvrent la carte ; le bouton ⋯ d'une carte de l'agenda les propose aussi."],
    ['Qui voit quoi', "Un événement se lit en clair par son auteur, ses participants, ses lecteurs et l'organisateur. Pour les autres, il apparaît en « Occupé » — l'heure, pas le contenu. Les participants peuvent le modifier, les lecteurs seulement le lire ; seul l'auteur (ou l'organisateur) le supprime. Les lecteurs se choisissent dans le formulaire de l'événement."],
    ['Villes et heures', "Chaque jour porte une ville ; les heures sont celles du lieu. Pour un vol, précisez le fuseau de chaque horaire et le jour d'arrivée : la durée et l'heure de Luxembourg se calculent tout seuls. Les nuits d'hôtel et les arrivées se déduisent des événements."],
    ['Sans réseau', "L'agenda affiché reste disponible dans le navigateur. Ce qui n'a pas pu partir attend dans une boîte d'envoi (bandeau « en attente ») et part à la synchronisation suivante."],
    ["Sur le téléphone", "Android : dans Chrome, menu ⋮ puis « Ajouter à l'écran d'accueil » — Termin s'ouvre ensuite comme une app. iPhone : l'app Termin fait la même chose, mieux ; la page web sert surtout aux autres téléphones."],
    ['Signaler, masquer', "Sur l'événement d'un collègue (bouton ⋯ de sa carte, ou menu de la fiche) : « Signaler » prévient l'organisateur, « Masquer » retire de votre écran les saisies de cette personne — réversible dans Réglages."],
  ];
  function ouvrirNotice() { ouvrirFeuille({ titre: "Mode d'emploi", droite: { libelle: 'Fermer', action: fermerFeuille }, corps: `<h2 style="font-size:22px;margin:14px 0">Termin en dix points</h2><ol class="points" style="padding-left:20px">${POINTS.map(([t, x]) => `<li><b>${h(t)}</b><p>${h(x)}</p></li>`).join('')}</ol>${rappelRegle()}` }); }
  function ouvrirConditions() { const date = local.lire(Cles.conditions, null); ouvrirFeuille({ titre: 'Conditions', droite: { libelle: 'Fermer', action: fermerFeuille }, corps: `<div style="padding:10px 0">${texteConditions()}${date ? `<p class="mini">Acceptées le ${h(Fmt.dateHeure(new Date(date)))}</p>` : ''}</div>` }); }

  let parametres = null;
  function ouvrirParametres() {
    if (!estOrganisateur()) { alerte('Seul l\'organisateur règle le voyage.'); return; }
    const v = etat.voyage;
    parametres = { titre: v.titre, debut: v.debut, fin: Voyage.fin(v), participants: v.participants.slice(), organisateur: v.organisateur || '', nomsDansOccupe: v.nomsDansOccupe };
    ouvrirFeuille({ id: 'parametres', titre: 'Paramètres', bloquee: true, gauche: { libelle: 'Annuler', action: fermerFeuille }, droite: { libelle: 'Enregistrer', action: enregistrerParametres }, corps: corpsParametres() });
  }
  function rafraichirParametres() { const f = $('#feuille-parametres .defile'); if (f && parametres) f.innerHTML = corpsParametres(); }
  function corpsParametres() {
    const p = parametres; const moi = etat.moi ? etat.moi.nom : null; const duree = Math.max(1, Fmt.ecartJours(p.debut, p.fin) + 1);
    let html = `<div class="panneau"><h3>Voyage</h3><div class="ligne"><label for="p-titre">Titre</label><input id="p-titre" type="text" data-param="titre" value="${h(p.titre)}"></div><div class="ligne"><label for="p-debut">Date de départ</label><input id="p-debut" type="date" data-param="debut" value="${h(p.debut)}"></div><div class="ligne"><label for="p-fin">Date de retour</label><input id="p-fin" type="date" data-param="fin" value="${h(p.fin)}"></div><div class="ligne"><span class="lib">Durée</span><span class="sec" id="p-duree">${h(Fmt.pluriel(duree, 'jour'))}</span></div></div>`;
    html += `<div class="panneau participants-param"><h3>Participants du voyage</h3>${p.participants.map((n) => `<div class="ligne"><span class="lib">👤 ${h(n)}${n === moi ? ' <span class="mini">vous</span>' : ''}</span><button type="button" class="lien-bouton danger" data-action="p-retirer" data-nom="${h(n)}">Retirer</button></div>`).join('')}<div class="ligne"><input type="text" id="p-nouveau" placeholder="Ajouter un participant" autocomplete="off"><button type="button" class="lien-bouton" data-action="p-ajouter">Ajouter</button></div><p class="note">Ces prénoms alimentent les cases à cocher des événements, le filtre 👁 et le choix de l'identité. Retirer un prénom conserve ses événements. Corriger l'orthographe d'un prénom se fait dans l'app iPhone (le renommage est répercuté partout).</p></div>`;
    html += `<div class="panneau"><div class="ligne"><label for="p-organisateur">Organisateur</label><select id="p-organisateur" data-param="organisateur"><option value="">Personne</option>${participantsNettoyes(p.participants).map((n) => `<option value="${h(n)}"${n === p.organisateur ? ' selected' : ''}>${h(n)}</option>`).join('')}</select></div><p class="note">L'organisateur voit tout en clair, règle le voyage et peut le réinitialiser. Si vous choisissez « Personne », plus personne ne pourra modifier ces paramètres.</p></div>`;
    html += `<div class="panneau"><div class="ligne"><label for="p-noms">Prénoms des collègues dans « Occupé »</label><input type="checkbox" id="p-noms" data-param="nomsDansOccupe"${p.nomsDansOccupe ? ' checked' : ''}></div><p class="note">Désactivé, une carte masquée ne montre plus que l'heure. Le nom d'un externe n'apparaît jamais sur une carte masquée.</p></div>`;
    html += `<div class="panneau"><h3>Ville de chaque jour</h3>${datesDuVoyage().map((d) => `<div class="ligne"><span class="lib">${h(Fmt.dateMini(d))}</span>${villeMenu(d)}</div>`).join('')}<p class="note">Les villes s'enregistrent immédiatement.</p></div>`;
    return html;
  }
  function saisieParametres(el) {
    if (!parametres) return; const p = parametres; const k = el.dataset.param;
    p[k] = el.type === 'checkbox' ? el.checked : el.value;
    const d = $('#p-duree'); if (d) d.textContent = Fmt.pluriel(Math.max(1, Fmt.ecartJours(p.debut, p.fin) + 1), 'jour');
  }
  async function enregistrerParametres(fond) {
    if (!parametres) return; const p = parametres; $('.droite', fond).disabled = true;
    const masquesN = await enregistrerVoyage(p);
    fermerFeuille(fond);
    toast(masquesN > 0 ? `Enregistré — ${Fmt.pluriel(masquesN, 'événement')} hors période (conservés mais masqués)` : 'Paramètres enregistrés');
  }

  // ---------------------------------------------------------------- apparence
  function appliquerApparence() { const v = local.lire(Cles.apparence, 'systeme'); const theme = { clair: 'light', sombre: 'dark' }[v]; if (theme) document.documentElement.dataset.theme = theme; else delete document.documentElement.dataset.theme; }

  // ---------------------------------------------------------------- actions (délégation)
  const ACTIONS = {
    onglet(el) { etat.onglet = el.dataset.onglet; local.ecrire(Cles.onglet, etat.onglet); rendre(); window.scrollTo(0, 0); },
    'accepter-conditions'() { local.ecrire(Cles.conditions, new Date().toISOString()); rendre(); },
    'enregistrer-jeton'() { const i = $('#jeton-saisie'); const v = i ? i.value.trim() : ''; if (!v) return; local.ecrire(Cles.jeton, v); location.reload(); },
    identite(el) { choisirIdentite(el.dataset.nom); },
    synchroniser() { synchroniser(); },
    aller(el) { const s = $('#jour-' + el.dataset.date); if (s) s.scrollIntoView({ behavior: 'smooth', block: 'start' }); },
    creer(el) { if (!etat.moi) { alerte('Choisissez d\'abord votre prénom.'); return; } ouvrirFormulaire(evenementVide(etat.moi.nom, el.dataset.date || jourParDefaut()), true); },
    ouvrir(el) { const ev = evenement(el.dataset.id); if (ev) ouvrir(ev); },
    'ouvrir-depuis-menu'(el) { const ev = evenement(el.dataset.id); fermerFeuille(); if (ev) ouvrir(ev); },
    menu(el) { const ev = evenement(el.dataset.id); if (ev) menuCarte(ev); },
    copier(el) { const t = el.dataset.texte || ''; (navigator.clipboard ? navigator.clipboard.writeText(t) : Promise.reject()).then(() => toast('Adresse copiée'), () => prompt('Copiez l\'adresse :', t)); },
    signaler(el) { const ev = evenement(el.dataset.id); fermerFeuille(); if (ev) ouvrirSignalement(ev); },
    masquer(el) { fermerFeuille(); masquer(el.dataset.nom); },
    demasquer(el) { demasquer(el.dataset.nom); },
    liberer(el) { const n = el.dataset.nom; if (confirm(`Libérer le prénom « ${n} » ? Le prochain compte Apple qui le choisira le gardera.`)) libererPrenom(n); },
    apparence(el) { local.ecrire(Cles.apparence, el.dataset.valeur); appliquerApparence(); rendre(); },
    notice() { ouvrirNotice(); },
    conditions() { ouvrirConditions(); },
    signalements() { ouvrirSignalements(); },
    parametres() { ouvrirParametres(); },
    'reessayer-envois'() { const l = boite(); for (const e of l) { e.essais = 0; e.bloquee = false; } ecrireBoite(l); synchroniser(); },
    'oublier-envois'() { ecrireBoite(boite().filter((x) => !x.bloquee)); toast('Envois bloqués abandonnés'); rendre(); },
    'semaine-precedente'() { etat.lundiChoisi = Fmt.ajouterJours(lundiAffiche(), -7); rendre(); },
    'semaine-suivante'() { etat.lundiChoisi = Fmt.ajouterJours(lundiAffiche(), 7); rendre(); },
    'semaine-voyage'() { etat.lundiChoisi = Fmt.lundi(etat.voyage.debut); rendre(); },
    // formulaire
    'f-participant'(el) { if (!formulaire) return; const b = formulaire.brouillon, n = el.dataset.nom; const i = b.participants.indexOf(n); if (i >= 0) b.participants.splice(i, 1); else { b.participants.push(n); b.lecteurs = b.lecteurs.filter((x) => x !== n); } rafraichirFormulaire(); },
    'f-autre'() { if (!formulaire) return; const b = formulaire.brouillon; b.autre = !b.autre; if (!b.autre) b.autreNom = ''; rafraichirFormulaire(); },
    'f-lecteur'(el) { if (!formulaire) return; const b = formulaire.brouillon, n = el.dataset.nom; const i = b.lecteurs.indexOf(n); if (i >= 0) b.lecteurs.splice(i, 1); else b.lecteurs.push(n); rafraichirFormulaire(); },
    'f-presence-ajouter'(el) { if (!formulaire) return; const b = formulaire.brouillon; b.presence[el.dataset.nom] = { from: b.debut, to: b.fin || b.debut }; rafraichirFormulaire(); },
    'f-presence-retirer'(el) { if (!formulaire) return; delete formulaire.brouillon.presence[el.dataset.nom]; rafraichirFormulaire(); },
    'f-supprimer'() { if (!formulaire) return; const b = formulaire.brouillon; if (!confirm(`Supprimer cet événement${b.titre ? ' « ' + b.titre + ' »' : ''} ?`)) return; const ev = evenement(b.id) || b; fermerFeuille(); supprimer(ev); },
    // signalement, paramètres
    's-motif'(el) { if (!signalement) return; signalement.motif = el.dataset.motif; const t = $('#s-precision'); if (t) signalement.precision = t.value; const f = $('#feuille-signalement .defile'); if (f) f.innerHTML = corpsSignalement(); },
    's-clore'(el) { magasin.retirerSignalement(el.dataset.id).then(() => { fermerFeuille(); ouvrirSignalements(); }, (e) => alerte((e && e.message) || String(e))); },
    'p-retirer'(el) { if (!parametres) return; parametres.participants = parametres.participants.filter((n) => n !== el.dataset.nom); rafraichirParametres(); },
    'p-ajouter'() { if (!parametres) return; const i = $('#p-nouveau'); const v = i ? i.value.trim() : ''; if (!v) return; if (!participantsNettoyes(parametres.participants).includes(v)) parametres.participants.push(v); rafraichirParametres(); const j = $('#p-nouveau'); if (j) j.focus(); },
  };
  const CHANGEMENTS = {
    filtre(el) { etat.filtre = el.value; rendre(); },
    identite(el) { choisirIdentite(el.value || null); },
    organisateur(el) { designerOrganisateur(el.checked ? etat.moi.nom : null); },
    async ville(el) {
      const date = el.dataset.date, v = el.value, actuelle = jour(date).ville;
      if (v === '__autre') { const t = prompt('Ville du jour — le fuseau horaire se déduit de la ville quand elle est connue (Paris, Hong Kong, Shanghai, Tokyo…).', actuelle); if (t === null) { rendre(); rafraichirParametres(); return; } await definirVille(date, t.trim()); }
      else if (v === '__deux') {
        const parts = Fuseaux.villes_dans(actuelle);
        const a = prompt('Deux villes dans la journée — avant le vol ou le trajet du jour, c\'est la première ville qui vaut ; après, la seconde.\n\nLe matin :', parts[0] || '');
        if (a === null) { rendre(); rafraichirParametres(); return; }
        const b = prompt('L\'après-midi :', parts.length > 1 ? parts[parts.length - 1] : '');
        if (b === null) { rendre(); rafraichirParametres(); return; }
        await definirVille(date, [a.trim(), b.trim()].filter(Boolean).join(' → '));
      }
      else if (v === '__effacer') await definirVille(date, '');
      else await definirVille(date, v);
      rafraichirParametres();
    },
    'f-type'(el) { if (!formulaire) return; formulaire.brouillon.type = el.value; rafraichirFormulaire(); },
    'f-date'(el) { if (!formulaire) return; formulaire.brouillon.date = el.value; rafraichirFormulaire(); },
  };
  function brancherEvenements() {
    document.addEventListener('click', (e) => { const el = e.target.closest('[data-action]'); if (!el || el.disabled) return; const fn = ACTIONS[el.dataset.action]; if (fn) { e.preventDefault(); fn(el, e); } });
    document.addEventListener('change', (e) => {
      const el = e.target;
      if (el.dataset && el.dataset.change && CHANGEMENTS[el.dataset.change]) { CHANGEMENTS[el.dataset.change](el, e); return; }
      if (el.dataset && (el.dataset.champ !== undefined || el.dataset.x !== undefined || el.dataset.perso !== undefined || el.dataset.presence !== undefined)) saisieFormulaire(el);
      if (el.dataset && el.dataset.param !== undefined) saisieParametres(el);
    });
    document.addEventListener('input', (e) => {
      const el = e.target; if (!el.dataset) return;
      if (el.dataset.champ !== undefined || el.dataset.x !== undefined || el.dataset.perso !== undefined || el.dataset.presence !== undefined) saisieFormulaire(el);
      if (el.dataset.param !== undefined) saisieParametres(el);
    });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && feuilles.length) fermerFeuille(); });
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && etat.connecte && (!etat.synchroniseLe || Date.now() - etat.synchroniseLe > 60000)) synchroniser(); });
  }

  // ---------------------------------------------------------------- démarrage
  async function init() {
    appliquerApparence();
    const cache = revivre(local.lire(Cles.cache, null)); if (cache) appliquer(cache);
    retablirIdentite();
    brancherEvenements();
    rendre();
    // La coquille de la page reste disponible sans réseau (sw.js) — pas en
    // local ni en démonstration, pour ne pas servir une version périmée.
    if ('serviceWorker' in navigator && location.protocol === 'https:' && !DEMO) navigator.serviceWorker.register('sw.js').catch(() => {});
    try {
      if (DEMO) {
        await chargerScript('magasin-local.js'); await chargerScript('demo.js');
        magasin = new window.TerminMagasinLocal.MagasinLocal(revivre(window.TERMIN_DEMO));
      } else {
        if (!window.CloudKit) throw new Error('CloudKit JS ne s\'est pas chargé (cdn.apple-cloudkit.com injoignable). Vérifiez le réseau.');
        const jeton = CFG.apiToken || local.lire(Cles.jeton, '');
        if (!jeton) { etat.erreurConnexion = 'jeton'; etat.pret = true; rendre(); return; }
        magasin = new M.Magasin(jeton, CFG.environment);
        magasin.surConnexion(async (u) => { etat.connecte = { identifiant: u.userRecordName }; rendre(); await synchroniser(); });
        magasin.surDeconnexion(() => { etat.connecte = null; rendre(); });
      }
      const id = await magasin.identite();
      etat.connecte = id.connecte ? { identifiant: id.identifiant } : null;
      etat.pret = true; rendre();
      if (etat.connecte) await synchroniser();
    } catch (e) { etat.erreurConnexion = (e && e.message) || String(e); etat.pret = true; rendre(); }
  }
  window.TerminApp = { etat, synchroniser, rendre, version: VERSION };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
