# Termin — version web

L'agenda partagé d'un voyage professionnel entre collègues, dans le navigateur :
le même agenda que l'app iPhone **Termin**, pour celles et ceux qui n'ont pas
d'iPhone (Android, ordinateur). Même conteneur iCloud (CloudKit, base publique
du cercle), mêmes enregistrements, mêmes règles d'affichage.

- `regles.js` — les règles de l'agenda (types, dates, fuseaux, droits de lecture,
  conflits, nuits d'hôtel, arrivées, vue semaine, plan). Port fidèle des règles
  de l'app, prouvé par le même étalon (les vraies fonctions de l'agenda HTML
  d'origine, exécutées sur un jeu fictif) : `_tests/rejouer-etalon.js` — l'étalon
  lui-même vit dans le projet de l'app, pas ici.
- `magasin.js` — la couche CloudKit JS : lecture paginée, relire-avant-écrire,
  version strictement supérieure ou refus, suppression par tombe.
- `app.js` — l'application : cache local, boîte d'envoi hors ligne, agenda,
  semaine, voyageurs, réglages, formulaire, conditions, signalement.
- `config.js` — le jeton d'accès web du conteneur (public par nature, restreint
  au domaine de la page dans la CloudKit Console).
- `#demo` à la fin de l'adresse ouvre une démonstration hors ligne, sur des
  données fictives (`demo.js`, généré par `_tests/generer-demo.js`).

Il faut un identifiant Apple (gratuit) pour entrer : l'agenda vit dans iCloud.
Aucune bibliothèque tierce, aucun suivi.
