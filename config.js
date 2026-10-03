// Termin web — réglage de la page.
//
// `apiToken` : le jeton d'accès web (« API Token ») du conteneur
// iCloud.com.michelhilt.Termin, environnement Production, créé dans la
// CloudKit Console (jeton « Termin web »). Ce jeton est PUBLIC par nature :
// toute page CloudKit JS le contient, et il ne donne accès à rien sans
// connexion Apple (les rôles du conteneur ferment la lecture à `_world`).
// Il se restreint au domaine de cette page dans la console (Allowed Origins).
//
// Tant qu'il est vide, l'écran de connexion propose de le saisir une fois
// (il reste alors dans le navigateur) : pratique pour un essai en local.
window.TERMIN_CONFIG = {
  apiToken: '1c5fe68f4c688f3c9688ba8216cd573e6cec52bf6e9383380f18efd0a6c8bee6',
  environment: 'production',
};



