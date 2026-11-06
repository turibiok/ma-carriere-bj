// Base des enquêtes (Neon). Le jeton anonyme ne permet que de déposer une réponse
// et de lire les statistiques publiques, sans identifiant ni texte libre.
window.NEON = {
  auth: 'https://ep-square-salad-b93sgmhh.neonauth.c-7.eu-central-1.aws.neon.tech/neondb/auth',
  api: 'https://ep-square-salad-b93sgmhh.apirest.c-7.eu-central-1.aws.neon.tech/neondb/rest/v1',
};

// Jeton anonyme de courte durée, gardé en mémoire et renouvelé avant son expiration.
window.jetonAnonyme = (() => {
  let jeton = null, expire = 0;
  return async () => {
    if (jeton && Date.now() < expire) return jeton;
    const res = await fetch(`${window.NEON.auth}/token/anonymous`);
    if (!res.ok) throw new Error('jeton');
    jeton = (await res.json()).token;
    try { expire = JSON.parse(atob(jeton.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).exp * 1000 - 60000; }
    catch { expire = Date.now() + 10 * 60000; }
    return jeton;
  };
})();
