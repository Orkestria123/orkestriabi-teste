import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import {
  LayoutDashboard,
  Building2,
  Users,
  BarChart3,
  Receipt,
  Wallet,
  LineChart,
  Stethoscope,
  FileSpreadsheet,
  Cable,
  LogOut,
  Briefcase,
  Menu,
  Target,
  Settings,
  BookOpen,
  Tags,
  ScrollText,
} from "lucide-react";
import { useState } from "react";
import { useAuth } from "@/hooks/use-auth";
import { cn } from "@/lib/utils";
import { ThemeToggle } from "@/components/theme-toggle";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

type NavItem = { to: string; label: string; icon: any };

// Itens da engrenagem, ao lado do usuário. São coisas de ESTRUTURA do
// escritório, não operação do dia a dia — por isso saem da barra
// principal e ficam agrupadas aqui.
const CONFIG_ITEMS: NavItem[] = [
  { to: "/admin/plano-padrao", label: "Plano de Contas", icon: BookOpen },
  { to: "/admin/sistemas", label: "Sistemas e layouts", icon: Cable },
  { to: "/admin/empresas", label: "Cadastro de empresas", icon: Building2 },
  { to: "/admin/indicadores", label: "Indicadores", icon: LineChart },
  { to: "/admin/diagnostico", label: "Diagnóstico", icon: Stethoscope },
];

// Na visualização do BI (variant "client") a barra só tem as
// demonstrações — não havia caminho de volta para a lista de empresas.
// A engrenagem passa a aparecer lá também, com esse atalho.
const CONFIG_ITEMS_BI: NavItem[] = [
  { to: "/admin/empresas", label: "Voltar para Empresas", icon: Building2 },
  { to: "/admin/plano-padrao", label: "Plano de Contas", icon: BookOpen },
  { to: "/admin/sistemas", label: "Sistemas e layouts", icon: Cable },
  { to: "/admin/indicadores", label: "Indicadores", icon: LineChart },
];

const ORK_NAV: NavItem[] = [
  { to: "/orkestria-admin", label: "Visão geral", icon: LayoutDashboard },
  { to: "/orkestria-admin/tenants", label: "Tenants", icon: Briefcase },
];

const ADMIN_NAV: NavItem[] = [
  { to: "/admin", label: "Dashboard", icon: LayoutDashboard },
  { to: "/admin/comparativo", label: "Comparativo", icon: BarChart3 },
  { to: "/admin/empresas", label: "Empresas", icon: Building2 },
  
  { to: "/admin/usuarios", label: "Usuários", icon: Users },
  { to: "/admin/segmentos", label: "Segmentos", icon: Tags },
  { to: "/admin/logs", label: "Logs", icon: ScrollText },
];

const CLIENT_NAV: NavItem[] = [
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { to: "/dashboard/dre", label: "DRE", icon: Receipt },
  { to: "/dashboard/balanco", label: "Balanço", icon: BarChart3 },
  { to: "/dashboard/fluxo-de-caixa", label: "Fluxo", icon: Wallet },
  { to: "/dashboard/indicadores", label: "Indicadores", icon: LineChart },
  { to: "/dashboard/orcamento", label: "Orçamento", icon: Target },
  { to: "/dashboard/fornecedores", label: "Fornecedores", icon: Users },
  { to: "/dashboard/notas-fiscais", label: "NF-e", icon: FileSpreadsheet },
  { to: "/dashboard/analise", label: "Análise", icon: FileSpreadsheet },
];

export function AppTopNav({
  variant,
  title,
  actions,
}: {
  variant: "orkestria" | "admin" | "client";
  title?: string;
  actions?: React.ReactNode;
}) {
  const { profile, tenant, signOut, isCliente } = useAuth();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const navigate = useNavigate();
  const [mobileOpen, setMobileOpen] = useState(false);

  const irPara = (to: string) => {
    void navigate({ to: to as never });
  };

  const items =
    variant === "orkestria" ? ORK_NAV : variant === "admin" ? ADMIN_NAV : CLIENT_NAV;

  const brandName =
    variant === "orkestria" ? "Orkestria" : tenant?.name ?? "Orkestria BI";
  const accent =
    variant === "client" && tenant?.primary_color ? tenant.primary_color : undefined;

  const isActive = (to: string) =>
    to === pathname ||
    (to !== "/" && pathname.startsWith(to + "/")) ||
    (to === "/dashboard" && pathname === "/dashboard") ||
    (to === "/admin" && pathname === "/admin") ||
    (to === "/orkestria-admin" && pathname === "/orkestria-admin");

  return (
    <header className="sticky top-0 z-40 border-b border-border bg-card/95 backdrop-blur supports-[backdrop-filter]:bg-card/80">
      <div className="flex h-12 items-center gap-3 px-3 sm:px-4">
        {/* Brand */}
        <div className="flex items-center gap-2 shrink-0">
          {variant === "client" && tenant?.logo_url ? (
            <img
              src={tenant.logo_url}
              alt={brandName}
              className="h-7 w-auto max-w-[100px] object-contain"
            />
          ) : (
            <div
              className="h-7 w-7 rounded-md flex items-center justify-center text-white font-bold text-xs"
              style={{
                background:
                  accent ?? "linear-gradient(135deg, oklch(0.30 0.08 260), oklch(0.55 0.10 245))",
              }}
            >
              {brandName.slice(0, 1).toUpperCase()}
            </div>
          )}
          <div className="hidden sm:block text-sm font-semibold tracking-tight truncate max-w-[160px]">
            {brandName}
          </div>
        </div>

        {/* Title inline on large screens */}
        {title && (
          <span className="hidden lg:inline text-xs text-muted-foreground border-l pl-3 ml-1 truncate max-w-[280px]">
            {title}
          </span>
        )}

        {isCliente && (
          <span className="hidden sm:inline rounded-full border border-border px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
            Área do cliente · somente leitura
          </span>
        )}

        {/* Right side (desktop) */}
        <div className="hidden md:flex items-center gap-2 ml-auto shrink-0">
          {actions}
          <ThemeToggle />
          <div className="flex items-center gap-1.5 pl-2 border-l">
            <div className="h-6 w-6 rounded-full bg-primary/15 text-primary text-[10px] font-semibold flex items-center justify-center">
              {profile?.full_name?.slice(0, 1).toUpperCase() ?? "?"}
            </div>
            <span className="text-xs font-medium truncate max-w-[120px]">
              {profile?.full_name ?? "Usuário"}
            </span>
            {!isCliente && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    className="ml-1 h-7 w-7 grid place-items-center rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                    title="Configurações"
                    aria-label="Configurações"
                  >
                    <Settings className="h-3.5 w-3.5" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56">
                  <DropdownMenuLabel>Configurações do escritório</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  {(variant === "client" ? CONFIG_ITEMS_BI : CONFIG_ITEMS).map((item) => {
                    const Icon = item.icon;
                    return (
                      <DropdownMenuItem
                        key={item.to}
                        className="cursor-pointer"
                        onSelect={() => irPara(item.to)}
                      >
                        <Icon className="h-4 w-4 mr-2" />
                        {item.label}
                      </DropdownMenuItem>
                    );
                  })}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
            <button
              onClick={() => signOut()}
              className="text-muted-foreground hover:text-foreground ml-1"
              title="Sair"
            >
              <LogOut className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>

        {/* Mobile menu button */}
        <button
          className="md:hidden ml-auto h-8 w-8 grid place-items-center rounded-md hover:bg-accent"
          onClick={() => setMobileOpen((v) => !v)}
          aria-label="Menu"
        >
          <Menu className="h-4 w-4" />
        </button>
      </div>

      {/* Desktop nav on a second row — wraps so every item stays visible */}
      <nav className="hidden md:flex flex-wrap items-center gap-0.5 px-3 sm:px-4 py-1.5 border-t border-border/60 bg-card/60">
        {items.map((item) => {
          const Icon = item.icon;
          const active = isActive(item.to);
          return (
            <Link
              key={item.to}
              to={item.to}
              className={cn(
                "flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium whitespace-nowrap transition-colors",
                active
                  ? "bg-accent text-accent-foreground"
                  : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
              )}
            >
              <Icon className="h-3.5 w-3.5" />
              {item.label}
            </Link>
          );
        })}
      </nav>


      {/* Mobile dropdown */}
      {mobileOpen && (
        <div className="md:hidden border-t border-border bg-card px-2 py-2 space-y-0.5">
          {items.map((item) => {
            const Icon = item.icon;
            const active = isActive(item.to);
            return (
              <Link
                key={item.to}
                to={item.to}
                onClick={() => setMobileOpen(false)}
                className={cn(
                  "flex items-center gap-2 px-3 py-2 rounded-md text-sm",
                  active
                    ? "bg-accent text-accent-foreground font-medium"
                    : "text-muted-foreground hover:bg-accent/60",
                )}
              >
                <Icon className="h-4 w-4" />
                {item.label}
              </Link>
            );
          })}
          {(
            <div className="border-t mt-2 pt-2">
              <div className="px-3 py-1 text-[10px] uppercase tracking-wider text-muted-foreground">
                Configurações
              </div>
              {(variant === "client" ? CONFIG_ITEMS_BI : CONFIG_ITEMS).map((item) => {
                const Icon = item.icon;
                return (
                  <Link
                    key={item.to}
                    to={item.to}
                    onClick={() => setMobileOpen(false)}
                    className="flex items-center gap-3 rounded-md px-3 py-2 text-sm text-foreground/80 hover:bg-accent"
                  >
                    <Icon className="h-4 w-4" />
                    {item.label}
                  </Link>
                );
              })}
            </div>
          )}
          <div className="flex items-center justify-between px-3 py-2 border-t mt-2 pt-3">
            <div className="flex items-center gap-2">
              <ThemeToggle />
              <span className="text-xs text-muted-foreground">{profile?.email}</span>
            </div>
            <button
              onClick={() => signOut()}
              className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
            >
              <LogOut className="h-3.5 w-3.5" /> Sair
            </button>
          </div>
        </div>
      )}

      {/* Title bar (when present and on mobile, or actions visible) */}
      {(title || actions) && (
        <div className="md:hidden flex items-center justify-between gap-2 border-t px-3 py-2">
          {title && <h1 className="text-sm font-semibold truncate">{title}</h1>}
          <div className="flex items-center gap-2 ml-auto">{actions}</div>
        </div>
      )}
    </header>
  );
}
