// Configuration de Cœur All In.
//
// Sans clé Supabase, l'appli tourne en « mode solo » : tout est stocké sur le
// téléphone et la personne en face est simulée (profils fictifs). Parfait pour
// tester le déroulé complet tout de suite.
//
// Pour le vrai mode multi-utilisateurs, crée un projet Supabase (gratuit), exécute
// supabase/schema.sql, puis renseigne les deux valeurs ci-dessous
// (Project Settings → API). La clé « anon » est publique par nature : elle peut
// être commitée, la sécurité repose sur les règles RLS du schéma.
export const CONFIG = {
  APP_NAME: 'Cœur All In',
  SUPABASE_URL: 'https://tdkxdhzdiuhlhfiyharv.supabase.co',
  SUPABASE_ANON_KEY: 'sb_publishable_acoUgLuhg5XdCAPG-o95MQ_SKg-QoMV',
  // Heure du rendez-vous (non négociable, comme dit la carte).
  DATE_HOUR: 20,
  // Jours possibles pour un date, par ordre de préférence (0 = dimanche … 6 = samedi).
  DATE_WEEKDAYS: [6, 5, 4],
  // Délai minimum entre le match et le date (en jours) pour dérouler toutes les cartes.
  MIN_DAYS_BEFORE_DATE: 3,
};

export const IS_REMOTE = Boolean(CONFIG.SUPABASE_URL && CONFIG.SUPABASE_ANON_KEY);
