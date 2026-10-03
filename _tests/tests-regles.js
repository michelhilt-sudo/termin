#!/usr/bin/env node
// Les extensions de Termin au-delà du HTML, mêmes cas que SelfTests.swift.
'use strict';
const T = require('../regles.js');
const { egal, check, bilan } = require('./harnais.js');
const { Regles, Fuseaux, Plan } = T;
const evt = (id, o) => Object.assign(T.evenementVide('David', '2026-11-16'), { id }, o || {});
const partages = { 'Hervé': '*', 'Xavier': ['Michel'] };
const regard = (moi, organisateur) => ({ moi: moi || null, estOrganisateur: !!organisateur, partages });

// Règle du HTML (étalon) : le partage ouvre en lecture
const deHerve = evt('b', { participants: ['David'], auteur: 'Hervé' });
check('HTML : Hervé a tout ouvert, Michel voit', Regles.peutVoirHTML(deHerve, regard('Michel')));
check('HTML : discret ferme', !Regles.peutVoirHTML(Object.assign({}, deHerve, { discret: true }), regard('Michel')));
// Règle de Termin
const avecLecteur = evt('l', { participants: ['David'], auteur: 'Hervé', lecteurs: ['Michel'] });
check('un lecteur voit', Regles.peutVoir(avecLecteur, regard('Michel')));
check('… mais ne modifie pas', !Regles.peutModifier(avecLecteur, regard('Michel')));
check('… ni ne supprime', !Regles.peutSupprimer(avecLecteur, regard('Michel')));
check('un participant voit et modifie', Regles.peutVoir(avecLecteur, regard('David')) && Regles.peutModifier(avecLecteur, regard('David')));
check('… mais ne supprime pas', !Regles.peutSupprimer(avecLecteur, regard('David')));
check("l'auteur supprime", Regles.peutSupprimer(avecLecteur, regard('Hervé')));
check("l'organisateur aussi", Regles.peutSupprimer(avecLecteur, regard(null, true)));
check('un tiers ne voit pas', !Regles.peutVoir(avecLecteur, regard('Xavier')));
check("l'ancien partage n'ouvre plus rien", !Regles.peutVoir(deHerve, regard('Michel')));
check('non identifié : rien', !Regles.peutVoir(avecLecteur, regard(null)));
const externe = evt('d', { participants: [], auteur: 'Séverine', autre: true, autreNom: 'Mme Lee' });
check("l'externe nommé voit", Regles.peutVoir(externe, regard('Mme Lee')));
egal('Occupé : prénoms sans l\'externe', Regles.personnesPourOccupe(externe, true), { noms: [], externes: 1 });

// Villes du jour
egal('une ville', Fuseaux.villes_dans('Hong Kong'), ['Hong Kong']);
egal('deux villes', Fuseaux.villes_dans('Hong Kong → Shanghai'), ['Hong Kong', 'Shanghai']);
egal('… avec une barre', Fuseaux.villes_dans('Hong Kong / Shanghai'), ['Hong Kong', 'Shanghai']);
egal('avant le vol', Fuseaux.villePour('08:30', 'Hong Kong → Shanghai', '10:00'), 'Hong Kong');
egal('le vol lui-même', Fuseaux.villePour('10:00', 'Hong Kong → Shanghai', '10:00'), 'Hong Kong');
egal('après le vol', Fuseaux.villePour('16:00', 'Hong Kong → Shanghai', '10:00'), 'Shanghai');
egal('sans trajet : midi', Fuseaux.villePour('11:59', 'Paris → Hong Kong', null), 'Paris');
egal('sans heure : le matin', Fuseaux.villePour('', 'Paris → Hong Kong', null), 'Paris');
const vol = (date, debut, fin, de, a) => evt('v', { date, debut, fin, type: 'vol', champs: { depLieu: de, arrLieu: a } });
const jours = [{ date: '2026-11-20', ville: 'Hong Kong' }, { date: '2026-11-21', ville: '' }];
const memeJour = vol('2026-11-20', '10:00', '12:30', 'Hong Kong HKG', 'Shanghai PVG');
egal('vol le jour même : deux villes', Regles.villeAPoserEtendue(memeJour, jours)?.ville, 'Hong Kong → Shanghai');
egal('… la règle HTML ne garde que l\'arrivée', Regles.villeAPoser(memeJour, jours)?.ville, 'Shanghai');
check('déjà posé : rien à faire', Regles.villeAPoserEtendue(memeJour, [{ date: '2026-11-20', ville: 'Hong Kong → Shanghai' }]) === null);
egal('ville écrasée : le départ la rétablit', Regles.villeAPoserEtendue(memeJour, [{ date: '2026-11-20', ville: 'Shanghai' }])?.ville, 'Hong Kong → Shanghai');
egal('minuscules reconnues', Regles.villeAPoserEtendue(memeJour, [{ date: '2026-11-20', ville: 'hong kong' }])?.ville, 'Hong Kong → Shanghai');
egal('sans matin ni départ : arrivée seule', Regles.villeAPoserEtendue(vol('2026-11-20', '10:00', '12:30', '', 'Shanghai PVG'), [{ date: '2026-11-20', ville: '' }])?.ville, 'Shanghai');
const nuit = vol('2026-11-20', '23:30', '06:00', 'Hong Kong HKG', 'Paris CDG');
egal('vol de nuit : le lendemain, arrivée seule', (() => { const r = Regles.villeAPoserEtendue(nuit, jours); return r && `${r.date} ${r.ville}`; })(), '2026-11-21 Paris');
check('heure de Luxembourg : suit la ville qui vaut', Fuseaux.heureALuxembourg('15:00', '2026-11-15', Fuseaux.villePour('15:00', 'Luxembourg → Hong Kong', '10:00')) !== null
  && Fuseaux.heureALuxembourg('08:00', '2026-11-15', Fuseaux.villePour('08:00', 'Luxembourg → Hong Kong', '10:00')) === null);
egal('heure de Luxembourg depuis Hong Kong en novembre', Fuseaux.heureALuxembourg('15:00', '2026-11-16', 'Hong Kong'), '8 h à Luxembourg');
egal('… la veille quand on passe minuit', Fuseaux.heureALuxembourg('03:00', '2026-11-16', 'Hong Kong'), '20 h à Luxembourg la veille');

// Plan
check('un lien https est un lien', Plan.lien('https://maps.app.goo.gl/x') !== null);
check('une adresse écrite n\'est pas un lien', Plan.lien('5 Connaught Road') === null);
check('ftp refusé', Plan.lien('ftp://exemple.lu/carte') === null);
check('maps.app.goo.gl sans schéma complété', Plan.lien('maps.app.goo.gl/AbCd') === 'https://maps.app.goo.gl/AbCd');
check('St.Germain n\'est pas une adresse web', Plan.lien('St.Germain') === null);
check('maps.app.goo.gl est Google', Plan.estGoogle('https://maps.app.goo.gl/AbCd'));
check('google.com/search n\'est pas une carte', !Plan.estGoogle('https://www.google.com/search?q=X'));
const ecrite = evt('L', { type: 'rdv', champs: { adresse: 'IFC Tower 2, Central' } });
egal('adresse écrite : trois actions', Plan.actions(ecrite).map((a) => a.id), ['google', 'plans', 'copier']);
egal('… la carte l\'écrit', Plan.resumeDuLieu(ecrite), '📍 IFC Tower 2, Central');
const colle = evt('C', { type: 'rdv', champs: { adresse: 'https://maps.app.goo.gl/AbCd1234' } });
egal('lien collé : une action', Plan.actions(colle).map((a) => a.libelle), ['Ouvrir dans Google Maps']);
egal('… la carte ne recopie pas l\'URL', Plan.resumeDuLieu(colle), '🔗 Plan');
egal('texte dans le champ du lien : cherché', Plan.actions(evt('T', { champs: { lienCarte: '12 rue des Bains' } })).map((a) => a.id), ['google', 'plans', 'copier']);
process.exit(bilan('règles Termin (web)') ? 0 : 1);
