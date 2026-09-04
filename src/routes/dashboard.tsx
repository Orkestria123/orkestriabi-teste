import { createFileRoute, Outlet } from "@tanstack/react-router";
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
  const { role, profile, tenant, isCliente } = useAuth();
  const { data: companies, isLoading: companiesLoading } = useMyCompanies();
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
    if (!companies || companies.length === 0) return;
    // Cliente com várias empresas escolhe na tela inicial; com uma só, entra direto.
    if (isCliente && companies.length > 1) return;
    setSelectedCompany(companies[0].id);
  }, [role, profile, companies, selectedCompany, companyParam, isCliente]);

  const setCompany = (id: string) => {
    setSelectedCompany(id);
    navigate({ search: { company: id } as any, replace: true });
  };


  const company = useMemo(
    () => companies?.find((c) => c.id === selectedCompany) ?? null,
    [companies, selectedCompany],
  );

  // Registra em auditoria qual empresa o usuário abriu.
  useEffect(() => {
    if (!company) return;
    void registrarAcessoEmpresa({
      data: { company_id: company.id, company_nome: company.name },
    }).catch(() => {});
  }, [company?.id]);

  const brandStyle = tenant?.primary_color
    ? ({ "--primary": tenant.primary_color, "--ring": tenant.primary_color, "--sidebar-primary": tenant.primary_color } as React.CSSProperties)
    : undefined;

  const semEmpresas = !companiesLoading && (companies?.length ?? 0) === 0;
  const precisaEscolher = !semEmpresas && !selectedCompany && (companies?.length ?? 0) > 1;

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
            {companies && companies.length > 1 ? (
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
        {semEmpresas ? (
          <div className="flex min-h-[60vh] items-center justify-center p-6">
            <div className="max-w-md rounded-lg border border-border bg-card p-8 text-center">
              <h2 className="text-lg font-semibold tracking-tight">
                Nenhuma empresa disponível
              </h2>
              <p className="mt-2 text-sm text-muted-foreground">
                Contate seu escritório contábil.
              </p>
            </div>
          </div>
        ) : precisaEscolher ? (
          <div className="mx-auto max-w-3xl p-6">
            <h2 className="text-xl font-semibold tracking-tight">Escolha a empresa</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Você tem acesso às empresas abaixo.
            </p>
            <div className="mt-6 grid gap-3 sm:grid-cols-2">
              {companies!.map((c) => (
                <button
                  key={c.id}
                  onClick={() => setCompany(c.id)}
                  className="rounded-lg border border-border bg-card p-4 text-left transition-colors hover:border-primary hover:bg-accent/50"
                >
                  <div className="text-sm font-semibold">{c.name}</div>
                  {c.cnpj && (
                    <div className="mt-0.5 text-xs text-muted-foreground">CNPJ {c.cnpj}</div>
                  )}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <>
            <PeriodSync companyId={selectedCompany} />
            <FilterBar />
            <div className="p-3 sm:p-4">
              <Outlet />
            </div>
          </>
        )}
      </PortalShell>
      </div>
    </DashboardCompanyContext.Provider>
  );
}

function PeriodSync({ companyId }: { companyId: string | null }) {
  const { data } = useAvailablePeriods(companyId);
  const {
    setAvailableYears,
    setAvailablePeriods,
    years,
    setYears,
    months,
    setMonths,
  } = useFilters();
  useEffect(() => {
    if (!data) return;
    setAvailablePeriods(data);
    const ys = Array.from(
      new Set(data.map((p) => new Date(p).getUTCFullYear())),
    ).sort();
    if (ys.length === 0) return;
    setAvailableYears(ys);

    // Se o ano selecionado não tem dados, cai para o ano mais recente disponível
    const overlap = years.filter((y) => ys.includes(y));
    const targetYear = overlap.length === 0 ? ys[ys.length - 1] : overlap[overlap.length - 1];
    if (overlap.length === 0) setYears([targetYear]);

    // Garante que os meses selecionados existam dentro do ano alvo;
    // caso contrário, marca todos os meses disponíveis nesse ano.
    const monthsDoAno = Array.from(
      new Set(
        data
          .filter((p) => new Date(p).getUTCFullYear() === targetYear)
          .map((p) => new Date(p).getUTCMonth() + 1),
      ),
    ).sort((a, b) => a - b);
    const overlapMonths = months.filter((m) => monthsDoAno.includes(m));
    if (overlapMonths.length === 0 && monthsDoAno.length > 0) {
      setMonths(monthsDoAno);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);
  return null;
}
