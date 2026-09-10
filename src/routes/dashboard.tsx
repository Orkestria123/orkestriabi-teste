import { createFileRoute, Outlet, useRouterState } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { PortalShell } from "@/components/portal-shell";
import { FilterProvider, FilterBar, useFilters } from "@/components/filter-bar";
import { useAuth } from "@/hooks/use-auth";
import { useMyCompanies, useAvailablePeriods } from "@/hooks/use-financial-data";
import { DashboardCompanyContext } from "@/components/dashboard-context";
import { VisaoGerencialProvider } from "@/hooks/use-visao-gerencial";
import { VisaoToggle } from "@/components/visao-toggle";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export const Route = createFileRoute("/dashboard")({
  validateSearch: (s: Record<string, unknown>) => ({
    company: typeof s.company === "string" ? s.company : undefined,
  }),
  component: () => (
    <VisaoGerencialProvider>
      <FilterProvider>
        <DashboardLayout />
      </FilterProvider>
    </VisaoGerencialProvider>
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
    // Deep-link via ?company= tem prioridade para admins
    if (
      companyParam &&
      companyParam !== selectedCompany &&
      companies?.some((c) => c.id === companyParam)
    ) {
      setSelectedCompany(companyParam);
      return;
    }
    if (selectedCompany) return;
    // Usuário vinculado a uma empresa (cliente) — independe de role já ter carregado
    if (profile?.company_id) {
      setSelectedCompany(profile.company_id);
      return;
    }
    if (companies && companies.length > 0) {
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
    <DashboardCompanyContext.Provider value={{ companyId: selectedCompany, company }}>
      <div style={brandStyle}>
      <PortalShell
        variant="client"
        unstyled
        title={company?.name ?? "Dashboard"}
        actions={
          <div className="flex items-center gap-2">
            <VisaoToggle />
            {role !== "client" && companies && companies.length > 0 ? (
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
            ) : null}
          </div>
        }
      >
        <PeriodSync companyId={selectedCompany} />
        <FilterBar />
        <div className="p-3 sm:p-4">
          <Outlet />
        </div>
      </PortalShell>
      </div>
    </DashboardCompanyContext.Provider>
  );
}

function ymDe(p: string): { y: number; m: number } {
  const d = new Date(p);
  return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1 };
}

function PeriodSync({ companyId }: { companyId: string | null }) {
  const noBalanco = useRouterState({
    select: (s) => s.location.pathname === "/dashboard/balanco",
  });
  const { data } = useAvailablePeriods(companyId);
  const {
    setAvailableYears,
    setAvailablePeriods,
    years,
    setYears,
    months,
    setMonths,
    preservarFiltro,
    restaurarFiltro,
    pegarFiltroPreservado,
  } = useFilters();

  useEffect(() => {
    if (!data || data.length === 0) {
      if (data) setAvailablePeriods(data);
      return;
    }
    setAvailablePeriods(data);
    const ys = Array.from(new Set(data.map((p) => ymDe(p).y))).sort((a, b) => a - b);
    setAvailableYears(ys);
    if (ys.length === 0) return;

    const overlapAnos = years.filter((y) => ys.includes(y));
    const targetYear = overlapAnos.length === 0 ? ys[ys.length - 1] : overlapAnos[overlapAnos.length - 1];
    const monthsDoAno = Array.from(
      new Set(data.filter((p) => ymDe(p).y === targetYear).map((p) => ymDe(p).m)),
    ).sort((a, b) => a - b);
    const lastM = monthsDoAno.length > 0 ? monthsDoAno[monthsDoAno.length - 1] : 0;
    const ateUltimoMovimento = lastM > 0 ? Array.from({ length: lastM }, (_, i) => i + 1) : [];

    if (noBalanco) {
      if (!pegarFiltroPreservado()) {
        const mesesSnap =
          months.filter((m) => lastM === 0 || m <= lastM).length > 0
            ? months.filter((m) => lastM === 0 || m <= lastM)
            : ateUltimoMovimento;
        preservarFiltro(
          overlapAnos.length > 0 ? years : [targetYear],
          mesesSnap.length > 0 ? mesesSnap : ateUltimoMovimento,
        );
      }
      const base = pegarFiltroPreservado();
      if (!base) return;
      const noDash = data
        .filter((p) => {
          const { y, m } = ymDe(p);
          return base.years.includes(y) && base.months.includes(m);
        })
        .sort();
      const fonte = noDash.length > 0 ? noDash : [...data].sort();
      const ultimoPorAno = new Map<number, string>();
      for (const p of fonte) {
        ultimoPorAno.set(ymDe(p).y, p);
      }
      const pares = [...ultimoPorAno.values()].sort();
      if (pares.length === 0) return;
      const anosBP = pares.map((p) => ymDe(p).y);
      const mesesBP = [...new Set(pares.map((p) => ymDe(p).m))].sort((a, b) => a - b);
      const sameYears =
        years.length === anosBP.length && years.every((y, i) => y === anosBP[i]);
      const sameMonths =
        months.length === mesesBP.length && months.every((m, i) => m === mesesBP[i]);
      if (!sameYears) setYears(anosBP);
      if (!sameMonths) setMonths(mesesBP);
      return;
    }

    if (restaurarFiltro()) return;

    if (overlapAnos.length === 0) setYears([targetYear]);
    if (ateUltimoMovimento.length === 0) return;
    if (months.length === 0 || months.every((m) => m > lastM)) {
      setMonths(ateUltimoMovimento);
    } else if (months.some((m) => m > lastM)) {
      setMonths(months.filter((m) => m <= lastM));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, noBalanco]);

  return null;
}
