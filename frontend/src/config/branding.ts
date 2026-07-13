declare global {
  interface Window {
    __BRAND__?: {
      name?: string;
      company?: string;
      showLogo?: boolean;
    };
  }
}

const runtime =
  (typeof window !== 'undefined' && window.__BRAND__) || {};

export const BRAND = {
  name: runtime.name ?? import.meta.env.VITE_BRAND_NAME ?? 'CaliperGT',
  company:
    runtime.company ?? import.meta.env.VITE_BRAND_COMPANY ?? 'Caliper AI',
  showLogo:
    runtime.showLogo ?? import.meta.env.VITE_BRAND_LOGO !== 'none',
} as const;
