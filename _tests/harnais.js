'use strict';
let total = 0, echecs = 0; const rapport = [];
function egal(nom, obtenu, attendu) {
  total++;
  const o = JSON.stringify(obtenu), a = JSON.stringify(attendu);
  if (o === a) return;
  echecs++; rapport.push(`ÉCHEC — ${nom} : obtenu ${o}, attendu ${a}`);
}
function check(nom, condition) { total++; if (!condition) { echecs++; rapport.push(`ÉCHEC — ${nom}`); } }
function bilan(titre) { for (const l of rapport) console.log(l); console.log(`=== ${titre} : ${total} vérifications, ${echecs} échec(s) ===`); return echecs === 0; }
module.exports = { egal, check, bilan, compte: () => ({ total, echecs }) };
