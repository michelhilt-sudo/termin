#!/usr/bin/env node
// Écrit web/demo.js : le jeu fictif de l'étalon, dans le modèle de l'app,
// avec des prénoms de pure invention. Sert à l'essai hors ligne (`#demo`).
'use strict';
const fs = require('fs'); const path = require('path');
const T = require('../regles.js');
const D = JSON.parse(fs.readFileSync(path.join(__dirname, '../../_tests/etalon/donnees-etalon.json'), 'utf8'));
const NOMS = { 'Michel': 'Marc', 'Hervé': 'Hugo', 'Xavier': 'Xénia', 'Séverine': 'Sonia', 'David': 'Dimitri' };
const r = (s) => { let t = String(s ?? ''); for (const [a, b] of Object.entries(NOMS)) t = t.split(a).join(b); return t; };
const evenements = []; let rang = 0;
for (const [date, jour] of Object.entries(D.days)) for (const e of jour.events || []) {
  const champs = Object.fromEntries(Object.entries(e.x || {}).filter(([k]) => !['siege', 'conf'].includes(k) || e.type === 'repas' || e.type === 'verre').map(([k, v]) => [k, r(v)]));
  const persos = {}; for (const k of ['siege', 'conf']) if (e.x && e.x[k] && !['repas', 'verre'].includes(e.type)) { persos[r(e.author)] = persos[r(e.author)] || {}; persos[r(e.author)][k] = String(e.x[k]); }
  evenements.push({ id: e.id, date, debut: e.time || '', fin: e.timeEnd || '', type: T.Types.depuisHTML(e.type), titre: r(e.title), champs, champsPersonnels: persos, notes: r(e.notes),
    participants: T.participantsNettoyes((e.participants || []).map(r)), lecteurs: [], autre: !!e.autre, autreNom: e.autreNom || '', auteur: r(e.author),
    presence: Object.fromEntries(Object.entries(e.presence || {}).map(([k, v]) => [r(k), v])), editeur: e.editor ? r(e.editor) : null,
    modifieLe: e.editedAt ? new Date(e.editedAt).toISOString() : null, creeLe: new Date(1780000000000 + rang++ * 60000).toISOString(), version: 1, retiree: false, discret: false });
}
const voyage = { code: 'voyage', titre: 'Démonstration — Hong Kong · Shanghai', debut: D.start, nbJours: D.len, participants: D.participants.map(r), organisateur: r(D.organisateur), nomsDansOccupe: true, modifieLe: new Date(1780000000000).toISOString() };
const jours = Object.entries(D.days).map(([date, j]) => ({ date, ville: j.city || '' }));
const membres = [{ id: 'local:' + r(D.organisateur), nom: r(D.organisateur), role: 'organisateur', inscritLe: new Date(1780000000000).toISOString() }];
const sortie = `// Termin web — jeu de démonstration FICTIF (généré par _tests/generer-demo.js).\nwindow.TERMIN_DEMO = ${JSON.stringify({ voyage, jours, evenements, membres }, null, 1)};\n`;
fs.writeFileSync(path.join(__dirname, '../demo.js'), sortie);
console.log(`demo.js : ${evenements.length} événements, ${jours.length} jours, participants ${voyage.participants.join(', ')}`);
