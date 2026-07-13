import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

export interface Organization {
  id: string;
  name: string;
  slug: string;
  description?: string;
  settings?: Record<string, unknown>;
  is_active?: boolean;
  created_at?: string;
  updated_at?: string;
}

export interface OrganizationMembership {
  id: string;
  organization_id: string;
  user_id: string;
  role: string;
  is_default: boolean;
  joined_at?: string;
}

export interface OrganizationWithMembership extends Organization {
  membership: OrganizationMembership;
}

interface OrganizationState {
  currentOrganization: Organization | null;

  organizations: OrganizationWithMembership[];

  isLoading: boolean;

  setCurrentOrganization: (org: Organization | null) => void;
  setOrganizations: (orgs: OrganizationWithMembership[]) => void;
  setLoading: (loading: boolean) => void;
  clear: () => void;

  getCurrentOrganizationId: () => string | null;
}

export const useOrganizationStore = create<OrganizationState>()(
  persist(
    (set, get) => ({
      currentOrganization: null,
      organizations: [],
      isLoading: false,

      setCurrentOrganization: (org) => {
        set({ currentOrganization: org });
      },

      setOrganizations: (orgs) => {
        set({ organizations: orgs });

        const state = get();

        const currentOrgStillValid = state.currentOrganization
          && orgs.some(o => o.id === state.currentOrganization?.id);

        if (!currentOrgStillValid && orgs.length > 0) {
          const defaultOrg = orgs.find(o => o.membership.is_default);
          if (defaultOrg) {
            set({ currentOrganization: defaultOrg });
          } else {
            set({ currentOrganization: orgs[0] });
          }
        } else if (!currentOrgStillValid && orgs.length === 0) {
          set({ currentOrganization: null });
        }
      },

      setLoading: (loading) => {
        set({ isLoading: loading });
      },

      clear: () => {
        set({
          currentOrganization: null,
          organizations: [],
          isLoading: false,
        });
      },

      getCurrentOrganizationId: () => {
        const state = get();
        return state.currentOrganization?.id ?? null;
      },
    }),
    {
      name: 'organization-storage',
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        currentOrganization: state.currentOrganization,
      }),
    }
  )
);

export const useCurrentOrganization = () => useOrganizationStore((state) => state.currentOrganization);
export const useCurrentOrganizationId = () => useOrganizationStore((state) => state.currentOrganization?.id ?? null);
export const useOrganizations = () => useOrganizationStore((state) => state.organizations);
