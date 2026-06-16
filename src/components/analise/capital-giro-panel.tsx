import { Card } from "@/components/ui/card";
import { formatBRL, formatBRLCompact } from "@/lib/format";
import type { CapitalGiroResultado } from "@/lib/analise-capital-giro";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, ResponsiveContainer, Tooltip, LabelList, Cell,
} from "recharts";
import { AXIS_PROPS, GRID_PROPS, TOOLTIP_STYLE } from "@/lib/chart-config";

interface Props {
  resultado: CapitalGiroResultado;
}

function Metric({
  label, valor, sufixo, hint, tone,
}: { label: string; valor: string; sufixo?: string; hint?: string; tone?: "ok" | "warn" | "crit" | "neutral" }) {
  const color =
    tone === "ok" ? "text-success"
    : tone === "warn" ? "text-amber-500"
    : tone === "crit" ? "text-destructive"
    : "text-foreground";
  return (
    <Card className="p-4">
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className={`text-2xl font-semibold tabular-nums mt-1 ${color}`}>
        {valor}{sufixo ? <span className="text-sm font-normal text-muted-foreground ml-1">{sufixo}</span> : null}
      </p>
      {hint && <p className="text-[11px] text-muted-foreground mt-2 leading-snug">{hint}</p>}
    </Card>
  );
}

function diasFmt(v: number | null): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${v.toFixed(0)} d`;
}

export function CapitalGiroPanel({ resultado: r }: Props) {
  const ciclo = r.cicloFinanceiro;
  const tomCiclo = ciclo == null ? "neutral" : ciclo < 30 ? "ok" : ciclo < 60 ? "warn" : "crit";
  const tomNcg = r.ncg <= 0 ? "ok" : r.ncg > r.capitalGiroLiquido ? "crit" : "warn";
  const tomTes = r.saldoTesouraria >= 0 ? "ok" : "crit";
  const tomDias = r.diasCaixa == null ? "neutral" : r.diasCaixa > 60 ? "ok" : r.diasCaixa > 30 ? "warn" : "crit";

  const cicloHint =
    ciclo == null
      ? "Sem dados suficientes para o ciclo."
      : ciclo < 0
      ? "Você recebe dos clientes ANTES de pagar fornecedores — caixa positivo no ciclo."
      : `Da venda ao recebimento líquido você espera ${ciclo.toFixed(0)} dias. Cada dia a mais consome caixa.`;

  const ncgHint =
    r.ncg <= 0
      ? "Operação se autofinancia — fornecedores cobrem clientes + estoque."
      : `Você precisa de ${formatBRLCompact(r.ncg)} de caixa para girar o negócio.`;

  const tesHint =
    r.saldoTesouraria >= 0
      ? "Sobra de caixa: capital de giro cobre a necessidade operacional."
      : "Aperto: a operação consome mais caixa do que o capital de giro disponível.";

  const dadosCiclo = [
    { nome: "PMR (recebimento)", dias: r.pmr ?? 0, cor: "var(--chart-1)" },
    { nome: "PME (estoque)", dias: r.pme ?? 0, cor: "var(--chart-2)" },
    { nome: "PMP (pagamento)", dias: -(r.pmp ?? 0), cor: "var(--chart-4)" },
  ];

  const dadosComposicao = [
    { nome: "Contas a Receber", valor: r.contasAReceber },
    { nome: "Estoque", valor: r.estoque },
    { nome: "Fornecedores (−)", valor: -r.fornecedores },
  ];

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Metric label="Ciclo Financeiro" valor={diasFmt(r.cicloFinanceiro)} hint={cicloHint} tone={tomCiclo} />
        <Metric label="NCG — Necessidade de Capital de Giro" valor={formatBRLCompact(r.ncg)} hint={ncgHint} tone={tomNcg} />
        <Metric label="Saldo de Tesouraria" valor={formatBRLCompact(r.saldoTesouraria)} hint={tesHint} tone={tomTes} />
        <Metric
          label="Dias de Caixa"
          valor={diasFmt(r.diasCaixa)}
          hint={r.diasCaixa == null
            ? "Sem despesa para projetar."
            : `${formatBRLCompact(r.disponivel)} disponíveis cobrem ${r.diasCaixa.toFixed(0)} dias de operação.`}
          tone={tomDias}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card className="p-5">
          <h3 className="text-sm font-semibold mb-1">Ciclo em dias — PMR + PME − PMP</h3>
          <p className="text-xs text-muted-foreground mb-4">
            Quanto tempo seu dinheiro fica fora do caixa. Quanto menor, melhor.
          </p>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={dadosCiclo} layout="vertical" margin={{ top: 8, right: 24, left: 24, bottom: 8 }}>
              <CartesianGrid {...GRID_PROPS} horizontal={false} />
              <XAxis type="number" {...AXIS_PROPS} tickFormatter={(v) => `${Math.round(v)}d`} />
              <YAxis type="category" dataKey="nome" {...AXIS_PROPS} width={140} />
              <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v: any) => `${Math.round(Number(v))} dias`} />
              <Bar dataKey="dias" radius={[0, 6, 6, 0]}>
                {dadosCiclo.map((d, i) => (
                  <Cell key={i} fill={d.cor} fillOpacity={0.85} />
                ))}
                <LabelList dataKey="dias" position="right" formatter={(v: any) => `${Math.round(Math.abs(Number(v)))}d`} className="fill-foreground" />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </Card>

        <Card className="p-5">
          <h3 className="text-sm font-semibold mb-1">Composição da Necessidade de Capital de Giro</h3>
          <p className="text-xs text-muted-foreground mb-4">
            Clientes + estoque travam caixa; fornecedores liberam. NCG = Clientes + Estoque − Fornecedores.
          </p>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={dadosComposicao} margin={{ top: 8, right: 12, left: 12, bottom: 8 }}>
              <CartesianGrid {...GRID_PROPS} />
              <XAxis dataKey="nome" {...AXIS_PROPS} />
              <YAxis {...AXIS_PROPS} tickFormatter={formatBRLCompact} />
              <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v: any) => formatBRL(Number(v))} />
              <Bar dataKey="valor" radius={[6, 6, 0, 0]}>
                {dadosComposicao.map((d, i) => (
                  <Cell key={i} fill={d.valor >= 0 ? "var(--chart-2)" : "var(--chart-4)"} fillOpacity={0.85} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </Card>
      </div>

      <Card className="p-5">
        <h3 className="text-sm font-semibold mb-3">Detalhamento</h3>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 text-sm">
          <Item label="PMR" valor={diasFmt(r.pmr)} />
          <Item label="PME" valor={diasFmt(r.pme)} />
          <Item label="PMP" valor={diasFmt(r.pmp)} />
          <Item label="Ciclo Operacional" valor={diasFmt(r.cicloOperacional)} />
          <Item label="Ativo Circulante" valor={formatBRLCompact(r.ativoCirculante)} />
          <Item label="Passivo Circulante" valor={formatBRLCompact(r.passivoCirculante)} />
          <Item label="CGL (AC − PC)" valor={formatBRLCompact(r.capitalGiroLiquido)} />
          <Item label="Disponível" valor={formatBRLCompact(r.disponivel)} />
          <Item label="Receita Média/Mês" valor={formatBRLCompact(r.receitaMensal)} />
          <Item label="CMV Médio/Mês" valor={formatBRLCompact(r.cmvMensal)} />
          <Item label="Despesa Média/Mês" valor={formatBRLCompact(r.despesaMensal)} />
        </div>
      </Card>
    </div>
  );
}

function Item({ label, valor }: { label: string; valor: string }) {
  return (
    <div className="border-l-2 border-border pl-3">
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className="font-semibold tabular-nums">{valor}</p>
    </div>
  );
}
