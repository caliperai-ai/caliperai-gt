// Default runtime feature flags (everything ON). Served at /feature-config.js.
//
// In production the frontend container OVERWRITES this file on startup from the
// FEATURE_* environment variables (see frontend/docker-entrypoint.d/20-features.sh),
// so the same built image can serve any edition without a rebuild. This checked-in
// copy is the fallback used by `npm run dev` and plain builds — all features on.
//
// To preview a gated edition in dev, set a key to false, e.g.:
//   window.__FEATURES__ = { pm_dashboard: false, chat: false };
window.__FEATURES__ = {};
