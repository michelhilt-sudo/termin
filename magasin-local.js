// Termin web — un magasin en mémoire, sans réseau, pour la démonstration et
// les essais d'écran : mêmes méthodes que le magasin CloudKit, mêmes refus
// (version dépassée, événement retiré), rien ne quitte la page.
'use strict';
(function () {
  const T = window.Termin;
  class ErreurLocale extends Error { constructor(code, message) { super(message); this.code = code; } }
  class MagasinLocal {
    constructor(instantane) {
      const i = instantane || { voyage: T.Voyage.parDefaut(), jours: [], evenements: [], membres: [] };
      this.voyage = T.Voyage.normaliser(i.voyage); this.jours = (i.jours || []).slice();
      this.evenements = (i.evenements || []).map((e) => Object.assign({}, e)); this.membres = (i.membres || []).slice(); this.signalements = [];
    }
    get nom() { return 'démo'; }
    async identite() { return { identifiant: 'demo', connecte: true }; }
    surConnexion() {} surDeconnexion() {}
    async chargerInstantane() {
      return { voyage: Object.assign({}, this.voyage), jours: T.Instantane.joursComplets(this.voyage, this.jours), evenements: T.Instantane.tri(this.evenements.map((e) => Object.assign({}, e))), membres: this.membres.slice(), synchroniseLe: new Date() };
    }
    async enregistrerEvenement(ev) {
      const i = this.evenements.findIndex((e) => e.id === ev.id);
      if (i >= 0) { if (this.evenements[i].retiree) throw new ErreurLocale('introuvable', 'Cet événement a été supprimé entre-temps.'); if (!(ev.version > this.evenements[i].version)) throw new ErreurLocale('modifieEntreTemps', 'Modifié entre-temps par un collègue. L\'agenda a été rechargé : reprenez votre modification.'); this.evenements[i] = Object.assign({}, ev); }
      else this.evenements.push(Object.assign({}, ev));
      return Object.assign({}, ev);
    }
    async retirerEvenement(id) { const e = this.evenements.find((x) => x.id === id); if (!e) throw new ErreurLocale('introuvable', 'Cet événement a été supprimé entre-temps.'); e.retiree = true; e.version += 1; e.modifieLe = new Date(); }
    async enregistrerJour(j) { this.jours = this.jours.filter((x) => x.date !== j.date).concat([Object.assign({}, j)]); }
    async enregistrerVoyage(v) { this.voyage = T.Voyage.normaliser(Object.assign({}, v)); }
    async lireMembre(id) { const m = this.membres.find((x) => x.id === id); return m ? Object.assign({}, m) : null; }
    async retirerMembre(id) { this.membres = this.membres.filter((x) => x.id !== id); }
    async enregistrerMembre(m) { this.membres = this.membres.filter((x) => x.id !== m.id).concat([Object.assign({}, m)]); }
    async signaler(s) { this.signalements.push(Object.assign({}, s)); }
    async chargerSignalements() { return this.signalements.slice().sort((a, b) => b.creeLe - a.creeLe); }
    async retirerSignalement(id) { this.signalements = this.signalements.filter((s) => s.id !== id); }
  }
  window.TerminMagasinLocal = { MagasinLocal };
})();
