import { createFileRoute, Outlet } from "@tanstack/react-router";
import { useEffect, useMemo, useState, createContext, useContext } from "react";
import { PortalShell } from "@/components/portal-shell";
import { FilterProvider, FilterBar, useFilters } from "@/components/filter-bar";
import { useAuth } from "@/hooks/use-auth";
import { useMyCompanies, useAvailablePeriods, type Company } from "@/hooks/use-financial-data";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface DashboardCtx {
  companyId: string | null;
  company: Company | null;
}
const Ctx = createContext<DashboardCtx>({ companyId: null, company: null });
export function useDashboardCompany() {
  return useContext(Ctx);
}

export const Route = createFileRoute("/dashboard")({
  validateSearch: (s: Record<string, unknown>) => ({
    company: typeof s.company === "string" ? s.company : undefined,
  }),
  component: () => (
    <FilterProvider>
      <DashboardLayout />
    </FilterProvider>
  ),
});

function hexToOklchVar(hex?: string | null): string | undefined {
  if (!hex) return undefined;
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return undefined;
  const r = parseInt(m[1].slice(0, 2), 16) / 255;
  const g = parseInt(m[1].slice(2, 4), 16) / 255;
  const b = parseInt(m[1].slice(4, 6), 16) / 255;
  // Use sRGB directly via Tailwind variable (the design tokens are oklch but a hex works)
  return `${r * 255} ${g * 255} ${b * 255}`;
  // not used — we set raw CSS color below
}

function DashboardLayout() {
  const { role, profile, tenant } = useAuth();
  const { data: companies } = useMyCompanies();
  const { company: companyParam } = Route.useSearch();
  const navigate = Route.useNavigate();
  const [selectedCompany, setSelectedCompany] = useState<string | null>(null);

  useEffect(() => {
    if (role === "client" && profile?.company_id) {
      setSelectedCompany(profile.company_id);
      return;
    }
    if (companyParam && companies?.some((c) => c.id === companyParam)) {
      setSelectedCompany(companyParam);
      return;
    }
    if (companies && companies.length > 0 && !selectedCompany) {
      setSelectedCompany(companies[0].id);
    }
  }, [role, profile, companies, selectedCompany, companyParam]);

  const setCompany = (id: string) => {
    setSelectedCompany(id);
    navigate({ search: { company: id } as any, replace: true });
  };


  const company = useMemo(
    () => companies?.find((c) => c.id === selectedCompany) ?? null,
    [companies, selectedCompany],
  );

  const brandStyle = tenant?.primary_color
    ? ({ "--primary": tenant.primary_color, "--ring": tenant.primary_color, "--sidebar-primary": tenant.primary_color } as React.CSSProperties)
    : undefined;

  return (
    <Ctx.Provider value={{ companyId: selectedCompany, company }}>
      <div style={brandStyle}>
      <PortalShell
        variant="client"
        unstyled
        title={company?.name ?? "Dashboard"}
        actions={
          role !== "client" && companies && companies.length > 0 ? (
            <Select
              value={selectedCompany ?? ""}
              onValueChange={(v) => setCompany(v)}
            >
              <SelectTrigger className="w-[280px]">
                <SelectValue placeholder="Selecione uma empresa" />
              </SelectTrigger>
              <SelectContent>
                {companies.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : null
        }
      >
        <PeriodSync companyId={selectedCompany} />
        <FilterBar />
        <div className="p-6">
          <Outlet />
        </div>
      </PortalShell>
      </div>
    </Ctx.Provider>
  );
}

function PeriodSync({ companyId }: { companyId: string | null }) {
  const { data } = useAvailablePeriods(companyId);
  const { setAvailableYears, setAvailablePeriods, years, setYears } = useFilters();
  useEffect(() => {
    if (!data) return;
    setAvailablePeriods(data);
    const ys = Array.from(new Set(data.map((p) => new Date(p).getUTCFullYear()))).sort();
    if (ys.length > 0) {
      setAvailableYears(ys);
      // If currently selected years have no data, default to the most recent available year
      const overlap = years.filter((y) => ys.includes(y));
      if (overlap.length === 0) setYears([ys[ys.length - 1]]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);
  return null;
}
