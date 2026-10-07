// Termin web — le partage CloudKit, lu et écrit par CloudKit JS.
//
// Même conteneur, mêmes enregistrements, mêmes règles d'écriture que
// `MagasinCloudKit.swift` : relire avant d'écrire, version strictement
// supérieure ou refus « modifié entre-temps », suppression = tombe
// (retiree = 1). Les listes et dictionnaires voyagent en JSON dans une
// chaîne, comme dans l'app ; les dates en TIMESTAMP (millisecondes).
'use strict';
(function () {
  const T = window.Termin;
  const CONTENEUR = 'iCloud.com.michelhilt.Termin';

  const json = (v) => JSON.stringify(v);
  const depuisJSON = (brut, defaut) => { try { const v = JSON.parse(brut); return v === null || v === undefined ? defaut : v; } catch (_) { return defaut; } };
  /// Un identifiant d'enregistrement sûr, comme `MagasinCloudKit.cle` :
  /// accents retirés, tout ce qui n'est ni lettre ni chiffre devient « - ».
  const cle = (texte) => { const sans = String(texte || '').normalize('NFD').replace(/[̀-ͯ]/g, ''); const propre = sans.replace(/[^\p{L}\p{N}]/gu, '-'); return propre || 'x'; };
  const champ = (r, nom) => (r.fields && r.fields[nom] !== undefined && r.fields[nom] !== null) ? r.fields[nom].value : undefined;
  const texte = (r, nom, defaut = '') => { const v = champ(r, nom); return v === undefined ? defaut : String(v); };
  const nombre = (r, nom, defaut = 0) => { const v = champ(r, nom); return v === undefined ? defaut : Number(v); };
  const dateDe = (r, nom) => { const v = champ(r, nom); return v === undefined ? null : new Date(Number(v)); };
  const codeDe = (e) => e && (e.ckErrorCode || e.serverErrorCode) || '';

  class ErreurPartage extends Error {
    constructor(code, message) { super(message); this.code = code; }
  }
  function traduire(e) {
    if (e instanceof ErreurPartage) return e;
    const code = codeDe(e);
    const raison = (e && (e.reason || e.message)) || '';
    switch (code) {
      case 'AUTHENTICATION_REQUIRED': case 'AUTHENTICATION_FAILED':
        return new ErreurPartage('sansCompte', 'Connectez-vous avec votre identifiant Apple pour écrire dans l\'agenda.');
      case 'ACCESS_DENIED': return new ErreurPartage('droitRefuse', "Vous n'avez pas le droit de modifier cet événement.");
      case 'NOT_FOUND': return new ErreurPartage('introuvable', 'Cet événement a été supprimé entre-temps.');
      case 'CONFLICT': return new ErreurPartage('modifieEntreTemps', "Modifié entre-temps par un collègue. L'agenda a été rechargé : reprenez votre modification.");
      case 'NETWORK_ERROR': case 'SERVICE_UNAVAILABLE': case 'THROTTLED': case 'TRY_AGAIN_LATER':
        return new ErreurPartage('horsLigne', "Pas de réseau. L'agenda affiché est celui de la dernière synchronisation.");
      default: return new ErreurPartage('autre', `[CloudKit ${code || '?'}] ${raison}`);
    }
  }
  function verifier(reponse) { if (reponse && reponse.hasErrors) throw traduire(reponse.errors[0]); return reponse; }
  /// Une valeur de champ au format de CloudKit JS : les dates typées, le reste tel quel.
  const valeur = (v) => (v instanceof Date ? { value: +v, type: 'TIMESTAMP' } : { value: v });

  class Magasin {
    constructor(apiToken, environnement) {
      CloudKit.configure({ containers: [{ containerIdentifier: CONTENEUR,
        apiTokenAuth: { apiToken, persist: true, signInButton: { id: 'apple-sign-in-button', theme: 'black' }, signOutButton: { id: 'apple-sign-out-button', theme: 'black' } },
        environment: environnement || 'production' }] });
      this.conteneur = CloudKit.getDefaultContainer();
      this.base = this.conteneur.publicCloudDatabase;
      this.codeVoyage = 'voyage';
    }
    get nom() { return 'iCloud'; }
    async identite() {
      const u = await this.conteneur.setUpAuth();
      this.utilisateur = u ? u.userRecordName : null;
      return u ? { identifiant: u.userRecordName, connecte: true } : { identifiant: 'anonyme', connecte: false };
    }
    /// Appelé à chaque connexion / déconnexion, autant de fois qu'il y en a.
    surConnexion(f) { const boucle = () => this.conteneur.whenUserSignsIn().then((u) => { this.utilisateur = u ? u.userRecordName : null; f(u); boucle(); }); boucle(); }
    surDeconnexion(f) { const boucle = () => this.conteneur.whenUserSignsOut().then(() => { f(); boucle(); }); boucle(); }

    // ---- lecture
    async tous(requete) {
      let resultat = []; let options = {};
      for (;;) {
        const r = verifier(await this.base.performQuery(requete, options));
        resultat = resultat.concat(r.records || []);
        if (!r.moreComing || !r.continuationMarker) break;
        options = { continuationMarker: r.continuationMarker };
      }
      return resultat;
    }
    egal(champNom, v) { return { fieldName: champNom, comparator: 'EQUALS', fieldValue: { value: v } }; }
    async chargerInstantane() {
      const voyage = await this.lireVoyage();
      this.codeVoyage = voyage.code;
      const [jours, evenements, membres] = await Promise.all([this.lireJours(voyage.code), this.lireEvenements(voyage.code), this.lireMembres()]);
      return { voyage, jours: T.Instantane.joursComplets(voyage, jours), evenements: T.Instantane.tri(evenements), membres, synchroniseLe: new Date() };
    }
    async lireVoyage() {
      try {
        const trouves = (await this.tous({ recordType: 'Voyage', filterBy: [this.egal('code', this.codeVoyage)] })).map((r) => this.voyageDepuis(r)).filter(Boolean);
        if (!trouves.length) return T.Voyage.parDefaut();
        return trouves.reduce((a, b) => (+b.modifieLe > +a.modifieLe ? b : a));
      } catch (e) { if (this.schemaAbsent(e)) return T.Voyage.parDefaut(); throw traduire(e); }
    }
    voyageDepuis(r) {
      const code = texte(r, 'code'); if (!code) return null;
      return T.Voyage.normaliser({ code, titre: texte(r, 'titre'), debut: texte(r, 'debut'), nbJours: nombre(r, 'nbJours', 12),
        participants: depuisJSON(texte(r, 'participants', '[]'), []), organisateur: texte(r, 'organisateur') || null,
        nomsDansOccupe: nombre(r, 'nomsDansOccupe', 1) === 1, modifieLe: dateDe(r, 'modifieLe') || new Date(0) });
    }
    async lireJours(code) {
      try { return (await this.tous({ recordType: 'Jour', filterBy: [this.egal('voyageCode', code)] }))
        .map((r) => ({ date: texte(r, 'date'), ville: texte(r, 'ville') })).filter((j) => j.date).sort((a, b) => (a.date < b.date ? -1 : 1)); }
      catch (e) { if (this.schemaAbsent(e)) return []; throw traduire(e); }
    }
    async lireEvenements(code) {
      try { return (await this.tous({ recordType: 'Evenement', filterBy: [this.egal('voyageCode', code), this.egal('retiree', 0)] }))
        .map((r) => this.evenementDepuis(r)).filter(Boolean); }
      catch (e) { if (this.schemaAbsent(e)) return []; throw traduire(e); }
    }
    async lireMembres() {
      try { return (await this.tous({ recordType: 'Membre', filterBy: [{ fieldName: 'inscritLe', comparator: 'GREATER_THAN', fieldValue: { value: 1, type: 'TIMESTAMP' } }] }))
        .map((r) => this.membreDepuis(r)).filter((m) => m && m.id && m.nom).sort((a, b) => a.nom.localeCompare(b.nom, 'fr')); }
      catch (e) { if (this.schemaAbsent(e)) return []; throw traduire(e); }
    }
    /// Le compte Apple créateur vient du serveur (`created.userRecordName`),
    /// jamais d'un champ de l'app : personne ne peut le falsifier.
    membreDepuis(r) {
      if (!r) return null;
      return { id: texte(r, 'identifiant'), nom: texte(r, 'nom'), role: texte(r, 'role', 'voyageur') === 'organisateur' ? 'organisateur' : 'voyageur',
        inscritLe: dateDe(r, 'inscritLe') || new Date(), creePar: this.createur(r) };
    }
    /// CloudKit désigne le créateur par « _defaultOwner » quand c'est l'utilisateur
    /// courant : on le ramène à son vrai identifiant, sinon on se refuserait soi-même.
    createur(r) {
      const c = (r.created && r.created.userRecordName) || null;
      if (!c) return null;
      return (c === '_defaultOwner' || c === '__defaultOwner__') ? (this.utilisateur || null) : c;
    }
    /// Une fiche relue à l'instant, pour décider d'un prénom sans dépendre du cache.
    async lireMembre(id) { return this.membreDepuis(await this.relire(`membre-${cle(id)}`)); }
    async retirerMembre(id) { verifier(await this.base.deleteRecords([`membre-${cle(id)}`])); }
    evenementDepuis(r) {
      const id = texte(r, 'identifiant'), date = texte(r, 'date'); if (!id || !date) return null;
      const editeur = texte(r, 'editeur');
      return { id, date, debut: texte(r, 'debut'), fin: texte(r, 'fin'), type: T.Types.depuisHTML(texte(r, 'type', 'autre')), titre: texte(r, 'titre'),
        champs: depuisJSON(texte(r, 'champs', '{}'), {}), champsPersonnels: depuisJSON(texte(r, 'champsPersonnels', '{}'), {}), notes: texte(r, 'notes'),
        participants: depuisJSON(texte(r, 'participants', '[]'), []), lecteurs: depuisJSON(texte(r, 'lecteurs', '[]'), []),
        autre: nombre(r, 'autre') === 1, autreNom: texte(r, 'autreNom'), auteur: texte(r, 'auteur'), presence: depuisJSON(texte(r, 'presence', '{}'), {}),
        editeur: editeur || null, modifieLe: dateDe(r, 'modifieLe'), creeLe: dateDe(r, 'creeLe') || new Date(), version: nombre(r, 'version', 1),
        retiree: nombre(r, 'retiree') === 1, discret: nombre(r, 'discret') === 1 };
    }
    /// Au premier lancement aucun type n'existe : le serveur répond « type
    /// inconnu ». Ce n'est pas une panne, c'est une base vide.
    schemaAbsent(e) { return codeDe(e) === 'BAD_REQUEST' && /does not exist|Unknown record type|not marked queryable/i.test((e && e.reason) || ''); }

    // ---- écriture
    async relire(nom) {
      let r;
      try { r = await this.base.fetchRecords([nom]); }
      catch (e) { if (codeDe(e) === 'NOT_FOUND') return null; throw traduire(e); }
      if (r.hasErrors) { if (codeDe(r.errors[0]) === 'NOT_FOUND') return null; throw traduire(r.errors[0]); }
      const rec = r.records && r.records[0];
      return rec && rec.recordType ? rec : null;
    }
    async deposer(type, nom, champs, existant) {
      const record = { recordType: type, recordName: nom, fields: {} };
      for (const [k, v] of Object.entries(champs)) record.fields[k] = valeur(v);
      if (existant && existant.recordChangeTag) record.recordChangeTag = existant.recordChangeTag;
      const r = verifier(await this.base.saveRecords([record]));
      return r.records[0];
    }
    remplir(ev) {
      return { identifiant: ev.id, voyageCode: this.codeVoyage, date: ev.date, debut: ev.debut || '', fin: ev.fin || '', type: ev.type, titre: ev.titre || '',
        champs: json(ev.champs || {}), champsPersonnels: json(ev.champsPersonnels || {}), notes: ev.notes || '', participants: json(ev.participants || []),
        lecteurs: json(ev.lecteurs || []), presence: json(ev.presence || {}), autre: ev.autre ? 1 : 0, autreNom: ev.autreNom || '', auteur: ev.auteur || '',
        editeur: ev.editeur || '', discret: ev.discret ? 1 : 0, version: ev.version || 1, retiree: ev.retiree ? 1 : 0,
        creeLe: ev.creeLe instanceof Date ? ev.creeLe : new Date(ev.creeLe || Date.now()), modifieLe: ev.modifieLe ? new Date(ev.modifieLe) : new Date() };
    }
    async enregistrerEvenement(ev) {
      const nom = `ev-${this.codeVoyage}-${ev.id}`;
      const existant = await this.relire(nom);
      if (existant) {
        const enPlace = this.evenementDepuis(existant);
        if (enPlace.retiree) throw new ErreurPartage('introuvable', 'Cet événement a été supprimé entre-temps.');
        // Jamais de fusion silencieuse : une écriture partie d'une version
        // dépassée est refusée, l'agenda est rechargé.
        if (!(ev.version > enPlace.version)) throw new ErreurPartage('modifieEntreTemps', `Modifié entre-temps par ${enPlace.editeur || enPlace.auteur || 'un collègue'}. L'agenda a été rechargé : reprenez votre modification.`);
      }
      const r = await this.deposer('Evenement', nom, this.remplir(ev), existant);
      return this.evenementDepuis(r) || ev;
    }
    async retirerEvenement(id) {
      const nom = `ev-${this.codeVoyage}-${id}`;
      const existant = await this.relire(nom); if (!existant) throw new ErreurPartage('introuvable', 'Cet événement a été supprimé entre-temps.');
      const ev = this.evenementDepuis(existant);
      ev.retiree = true; ev.modifieLe = new Date(); ev.version += 1;
      await this.deposer('Evenement', nom, this.remplir(ev), existant);
    }
    async enregistrerJour(jour) {
      const nom = `jour-${this.codeVoyage}-${jour.date}`;
      await this.deposer('Jour', nom, { voyageCode: this.codeVoyage, date: jour.date, ville: jour.ville || '', modifieLe: new Date() }, await this.relire(nom));
    }
    async enregistrerVoyage(v) {
      this.codeVoyage = v.code;
      const nom = `voyage-${v.code}`;
      await this.deposer('Voyage', nom, { code: v.code, titre: v.titre, debut: v.debut, nbJours: v.nbJours, participants: json(v.participants), organisateur: v.organisateur || '', nomsDansOccupe: v.nomsDansOccupe ? 1 : 0, modifieLe: v.modifieLe ? new Date(v.modifieLe) : new Date() }, await this.relire(nom));
    }
    async enregistrerMembre(m) {
      const nom = `membre-${cle(m.id)}`;
      await this.deposer('Membre', nom, { identifiant: m.id, nom: m.nom, role: m.role || 'voyageur', inscritLe: m.inscritLe ? new Date(m.inscritLe) : new Date() }, await this.relire(nom));
    }
    async signaler(s) {
      const nom = `signalement-${cle(s.id)}`;
      await this.deposer('Signalement', nom, { identifiant: s.id, voyageCode: this.codeVoyage, evenementId: s.evenementId, resume: s.resume, motif: s.motif, precision: s.precision || '', signaleParNom: s.signaleParNom, creeLe: s.creeLe ? new Date(s.creeLe) : new Date() }, await this.relire(nom));
    }
    async chargerSignalements() {
      try { return (await this.tous({ recordType: 'Signalement', filterBy: [this.egal('voyageCode', this.codeVoyage)] }))
        .map((r) => ({ id: texte(r, 'identifiant'), evenementId: texte(r, 'evenementId'), resume: texte(r, 'resume'), motif: texte(r, 'motif', 'autre'), precision: texte(r, 'precision') || null, signaleParNom: texte(r, 'signaleParNom', '?'), creeLe: dateDe(r, 'creeLe') || new Date() }))
        .filter((s) => s.id).sort((a, b) => b.creeLe - a.creeLe); }
      catch (e) { if (this.schemaAbsent(e)) return []; throw traduire(e); }
    }
    async retirerSignalement(id) { verifier(await this.base.deleteRecords([`signalement-${cle(id)}`])); }
  }
  window.TerminMagasin = { Magasin, ErreurPartage, cle };
})();
