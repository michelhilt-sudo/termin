#!/usr/bin/env node
// Rejoue Etalon.json (les vraies fonctions du HTML, sur le jeu fictif) contre
// les règles JavaScript de la version web — même preuve que l'app iPhone.
'use strict';
const fs = require('fs'); const path = require('path');
const T = require('../regles.js');
const { egal, check, bilan } = require('./harnais.js');
const { Fmt, Regles, Fuseaux, Voyage, Types, Instantane } = T;
const E = JSON.parse(fs.readFileSync(path.join(__dirname, '../../_tests/etalon/Etalon.json'), 'utf8'));
const D = JSON.parse(fs.readFileSync(path.join(__dirname, '../../_tests/etalon/donnees-etalon.json'), 'utf8'));

// Le jeu fictif, dans le modèle de l'app
const parId = {}; let rang = 0;
for (const [date, jour] of Object.entries(D.days)) {
  for (const e of jour.events || []) {
    parId[e.id] = { id: e.id, date, debut: e.time || '', fin: e.timeEnd || '', type: Types.depuisHTML(e.type), titre: e.title || '',
      champs: Object.fromEntries(Object.entries(e.x || {}).map(([k, v]) => [k, String(v ?? '')])), champsPersonnels: {}, notes: e.notes || '',
      participants: Voyage.participantsNettoyes(e.participants || []), lecteurs: [], autre: !!e.autre, autreNom: e.autreNom || '',
      auteur: e.author || '', presence: e.presence || {}, editeur: null, modifieLe: null, creeLe: new Date(rang++), version: 1, retiree: false, discret: false };
  }
}
const ordre = E.evenements.map((e) => e.id);
const evenements = ordre.map((id) => parId[id]).filter(Boolean);
const dates = E.dates;
const voyage = Voyage.normaliser({ titre: D.title, debut: D.start, nbJours: D.len, participants: D.participants, organisateur: D.organisateur, nomsDansOccupe: D.nomsDansOccupe });
const jours = Instantane.joursComplets(voyage, Object.entries(D.days).map(([date, j]) => ({ date, ville: j.city || '' })));
const ev = (id) => parId[id];
const regard = (identite) => identite === '__maitre' ? { moi: null, estOrganisateur: true, partages: D.partages } : { moi: identite || null, estOrganisateur: false, partages: D.partages || {} };

egal('étalon : jeu identique', E.controle.evenements, evenements.length);
egal('participants', voyage.participants, E.participants);
egal('dates du voyage', Voyage.dates(voyage), dates);
for (const brut of E.evenements) { check(`événement ${brut.id} rangé le bon jour`, ev(brut.id).date === brut.dISO); check(`événement ${brut.id} du bon type`, ev(brut.id).type === brut.type); }

for (const [date, f] of Object.entries(E.formats)) {
  egal(`format long ${date}`, Fmt.dateLongue(date), f.long); egal(`format court ${date}`, Fmt.dateCourte(date), f.court);
  egal(`format mini ${date}`, Fmt.dateMini(date), f.mini); egal(`jour ${date}`, Fmt.nomDuJour(date), f.dow);
  egal(`jour court ${date}`, Fmt.nomDuJourCourt(date), f.dowCourt); egal(`lundi de ${date}`, Fmt.lundi(date), f.lundi);
  egal(`${date} + 3`, Fmt.ajouterJours(date, 3), f.plus3); egal(`${date} − 1`, Fmt.ajouterJours(date, -1), f.moins1);
}
for (const [h, v] of Object.entries(E.hm)) egal(`hm(${h})`, Fmt.minutes(h), v);
for (const [id, v] of Object.entries(E.repas)) { const r = Regles.repas(ev(id).debut); egal(`repas ${id}`, r.libelle + r.emoji, v.label + v.icon); }
for (const [h, v] of Object.entries(E.repasHeures)) { const r = Regles.repas(h); egal(`repas à « ${h} »`, r.libelle + r.emoji, v.label + v.icon); }
for (const [id, v] of Object.entries(E.partsOf)) egal(`personnes concernées ${id}`, Regles.personnesConcernees(ev(id)), v);
for (const [id, fen] of Object.entries(E.fenetres)) for (const [p, f] of Object.entries(fen)) { const o = Regles.fenetre(ev(id), p); egal(`fenêtre ${id}/${p}`, o.from + '|' + o.to, f.from + '|' + f.to); }
E.chevauche.forEach((cas, i) => egal(`chevauchement ${i}`, Regles.chevauche(cas.a, cas.b), cas.resultat));
for (const [id, attendus] of Object.entries(E.conflits)) {
  const e = ev(id); const obtenus = Regles.conflits(e, evenements.filter((x) => x.date === e.date)).map((c) => `${c.autre.id}|${c.personnes.join(',')}`).sort();
  egal(`conflits ${id}`, obtenus, attendus.map((a) => `${a.id}|${(a.personnes || []).join(',')}`).sort());
}
for (const [identite, table] of Object.entries(E.peutVoir)) for (const [id, attendu] of Object.entries(table)) egal(`peutVoir(${id}) pour « ${identite} »`, Regles.peutVoirHTML(ev(id), regard(identite)), attendu);
for (const [identite, table] of Object.entries(E.peutModifier)) for (const [id, attendu] of Object.entries(table)) egal(`peutModifier(${id}) pour « ${identite} »`, Regles.peutModifier(ev(id), regard(identite)), attendu);
for (const [identite, s] of Object.entries(E.stats)) {
  const r = regard(identite); const st = Regles.statistiques(voyage, evenements, (x) => Regles.peutVoirHTML(x, r), '2026-09-25');
  egal(`stats « ${identite} »`, [st.jours, st.rendezVous, st.evenements], [s.jours, s.rdv, s.evenements]);
}
for (const [identite, table] of Object.entries(E.nuits)) { const r = regard(identite); for (const [date, attendu] of Object.entries(table)) egal(`nuit du ${date} pour « ${identite} »`, Regles.hotelsDeLaNuit(date, dates, evenements, (x) => Regles.peutVoirHTML(x, r)).join(' · '), attendu); }
for (const [date, liste] of Object.entries(E.arrivees)) egal(`arrivées du ${date}`, Regles.arrivees(date, evenements).map((x) => `${x.id}@${x.date}`).sort(), liste.map((a) => `${a.id}@${a.storedISO}`).sort());
for (const [date, liste] of Object.entries(E.checkouts)) egal(`check-out du ${date}`, Regles.checkOuts(date, evenements).map((x) => `${x.id}@${x.date}`).sort(), liste.map((a) => `${a.id}@${a.storedISO}`).sort());
for (const [id, v] of Object.entries(E.jourArrivee)) egal(`jour d'arrivée ${id}`, Regles.jourArrivee(ev(id)), v);
for (const [id, v] of Object.entries(E.decalageJour)) egal(`décalage de jour ${id}`, Regles.decalageJour(ev(id)), v);
const special = (id, extra) => Object.assign(T.evenementVide('David', '2026-11-16'), { id, type: 'vol' }, extra);
const speciaux = {
  libre: special('libre', { champs: { arrTz: '', arrLieu: '  shanghai pudong ' } }),
  inconnue: special('inconnue', { champs: { arrTz: 'Mars', arrLieu: 'Hangzhou' } }),
  vide: special('vide', { champs: {} }),
  sansFuseau: special('sansFuseau', { debut: '10:00', fin: '12:00', champs: {} }),
  negatif: special('negatif', { debut: '23:00', fin: '01:00', champs: { depTz: 'Paris', arrTz: 'Paris', arrDay: '' } }),
  delhi: special('delhi', { debut: '10:00', fin: '20:00', champs: { depTz: 'Paris', arrTz: 'Delhi', arrDay: '' } }),
};
for (const [id, v] of Object.entries(E.villeArrivee)) egal(`ville d'arrivée ${id}`, Regles.villeArrivee(ev(id) || speciaux[id]), v);
for (const [id, v] of Object.entries(E.dureeTrajet)) egal(`durée du trajet ${id}`, Regles.dureeTrajet(ev(id) || speciaux[id]), v);
for (const [id, v] of Object.entries(E.autoVille)) {
  const e = ev(id); const dArr = Regles.jourArrivee(e); const r = Regles.villeAPoser(e, jours);
  egal(`auto-ville ${id} : date`, dArr, v.date);
  egal(`auto-ville ${id} : ville`, r ? r.ville : (jours.find((j) => j.date === dArr) || {}).ville, v.ville);
}
for (const [id, liste] of Object.entries(E.segments)) egal(`segments ${id}`, Regles.segments(ev(id)).map((s) => `${s.date}|${s.debut}|${s.fin}|${s.partie}`), liste.map((s) => `${s.dayISO}|${s.s}|${s.e}|${s.part}`));
const parJour = {}; for (const e of evenements) for (const s of Regles.segments(e)) (parJour[s.date] = parJour[s.date] || []).push(s);
for (const [date, liste] of Object.entries(E.disposition)) {
  if (date === '__cluster') {
    const segs = liste.map((c) => ({ evenement: { id: c.id }, dateRangee: '2026-11-16', date: '2026-11-16', debut: c.s, fin: c.e, partie: 'full', colonne: 0, colonnes: 1 }));
    egal('disposition (grappe)', Regles.disposer(segs).map((s) => `${s.evenement.id}|${s.debut}|${s.fin}|${s.colonne}|${s.colonnes}`), liste.map((c) => `${c.id}|${c.s}|${c.e}|${c.col}|${c.cols}`));
  } else {
    egal(`disposition du ${date}`, Regles.disposer(parJour[date] || []).map((s) => `${s.evenement.id}|${s.partie}|${s.debut}|${s.fin}|${s.colonne}|${s.colonnes}`), liste.map((c) => `${c.id}|${c.part}|${c.s}|${c.e}|${c.col}|${c.cols}`));
  }
}
for (const [date, liste] of Object.entries(E.ordreAgenda)) egal(`ordre des cartes du ${date}`, Regles.elements(date, evenements).map((x) => x.id), liste);
for (const [f, table] of Object.entries(E.filtre)) for (const [id, attendu] of Object.entries(table)) egal(`filtre « ${f} » sur ${id}`, Regles.filtreCorrespond(f, ev(id)), attendu);
for (const cas of E.bornesDuree) egal(`borne de durée ${cas.n}`, Voyage.normaliser({ titre: 'T', debut: '2026-11-15', nbJours: cas.n, participants: ['A'] }).nbJours, cas.borne);
process.exit(bilan('étalon (web)') ? 0 : 1);
