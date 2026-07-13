// Default runtime branding (CaliperGT). Served at /brand-config.js.
//
// In production the frontend container OVERWRITES this file on startup from the
// BRAND_* environment variables (see frontend/docker-entrypoint.d/10-brand.sh),
// so the same built image can serve any brand without a rebuild. This checked-in
// copy is the fallback used by `npm run dev` and plain builds.
window.__BRAND__ = {
  name: "CaliperGT",
  company: "Caliper AI",
  showLogo: true,
};
