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
  component: () => (
    <FilterProvider>
      <DashboardLayout />
    </FilterProvider>
  ),
});

function DashboardLayout() {
  const { role, profile } = useAuth();
  const { data: companies } = useMyCompanies();
  const [selectedCompany, setSelectedCompany] = useState<string | null>(null);

  useEffect(() => {
    if (role === "client" && profile?.company_id) {
      setSelectedCompany(profile.company_id);
    } else if (companies && companies.length > 0 && !selectedCompany) {
      setSelectedCompany(companies[0].id);
    }
  }, [role, profile, companies, selectedCompany]);

  const company = useMemo(
    () => companies?.find((c) => c.id === selectedCompany) ?? null,
    [companies, selectedCompany],
  );

  return (
    <Ctx.Provider value={{ companyId: selectedCompany, company }}>
      <PortalShell
        variant="client"
        unstyled
        title={company?.name ?? "Dashboard"}
        actions={
          role !== "client" && companies && companies.length > 1 ? (
            <Select
              value={selectedCompany ?? ""}
              onValueChange={(v) => setSelectedCompany(v)}
            >
              <SelectTrigger className="w-[260px]">
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
    </Ctx.Provider>
  );
}

function PeriodSync({ companyId }: { companyId: string | null }) {
  const { data } = useAvailablePeriods(companyId);
  const { setAvailableYears } = useFilters();
  useEffect(() => {
    if (!data) return;
    const years = Array.from(new Set(data.map((p) => new Date(p).getUTCFullYear()))).sort();
    if (years.length > 0) setAvailableYears(years);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);
  return null;
}
