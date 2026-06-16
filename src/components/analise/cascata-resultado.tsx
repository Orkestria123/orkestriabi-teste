import { Card } from "@/components/ui/card";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Cell,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  LabelList,
} from "recharts";
import { formatBRL, formatBRLCompact } from "@/lib/format";
import { AXIS_PROPS, TOOLTIP_STYLE } from "@/lib/chart-config";
import type { ReceitaDespesaDetalhado } from "@/lib/analise-receita-despesa";

interface Props {
  data: ReceitaDespesaDetalhado;
}

// Constrói a cascata Receita → Deduções → Custos → Despesas por grupo → Lucro
export function CascataResultado({ data }: Props) {
  const r = data.raiz_receita;
  const d = data.raiz_despesa;

  const find = (no: typeof r, cls: string): number => {
    if (no.classificacao === cls) return Math.abs(no.valor);
    for (const f of no.filhos) {
      const v = find(f, cls);
      if (v) return v;
    }
    return 0;
  };

  const receitaBruta = find(r, "3.01.01") || data.receita_total;
  const deducoes = find(r, "3.01.02");
  // Custos (3.02 a 3.05)
  const custos = ["3.02", "3.03", "3.04", "3.05"].reduce((s, c) => s + find(r, c) || s, 0);
  // Por grupo de despesa (nivel 4 dentro de 3.06)
  const gruposDesp = (d.filhos.find((g) => g.classificacao === "3.06")?.filhos ?? [])
    .filter((g) => Math.abs(g.valor) > 0.01)
    .map((g) => ({ nome: g.descricao, valor: Math.abs(g.valor) }));
  const outrasDesp = Math.abs(d.filhos.find((g) => g.classificacao === "3.15")?.valor ?? 0);

  const totalDesp = gruposDesp.reduce((s, g) => s + g.valor, 0) + outrasDesp;
  const lucro = data.receita_total - deducoes - custos - totalDesp;

  // dados do waterfall — usamos barras simples para clareza
  const rows = [
    { nome: "Receita Bruta", valor: receitaBruta, tipo: "base" as const },
    { nome: "(−) Deduções", valor: -deducoes, tipo: "neg" as const },
    { nome: "(−) Custos", valor: -custos, tipo: "neg" as const },
    ...gruposDesp.map((g) => ({ nome: `(−) ${g.nome}`, valor: -g.valor, tipo: "neg" as const })),
    ...(outrasDesp > 0
      ? [{ nome: "(−) Outras Despesas", valor: -outrasDesp, tipo: "neg" as const }]
      : []),
    { nome: "= Lucro Líquido", valor: lucro, tipo: (lucro >= 0 ? "total" : "neg") as "total" | "neg" },
  ];

  const cor = (tipo: string) =>
    tipo === "base"
      ? "var(--chart-2)"
      : tipo === "total"
        ? lucro >= 0
          ? "var(--success)"
          : "var(--destructive)"
        : "var(--destructive)";

  return (
    <Card className="p-5">
      <h3 className="text-sm font-semibold mb-1">Da receita ao lucro</h3>
      <p className="text-xs text-muted-foreground mb-4">
        Cada barra mostra quanto cada bloco consome da receita até sobrar o lucro.
      </p>
      <ResponsiveContainer width="100%" height={320}>
        <BarChart data={rows} layout="vertical" margin={{ left: 12, right: 24, top: 8, bottom: 8 }}>
          <XAxis type="number" {...AXIS_PROPS} tickFormatter={formatBRLCompact} />
          <YAxis type="category" dataKey="nome" {...AXIS_PROPS} width={190} />
          <Tooltip
            contentStyle={TOOLTIP_STYLE}
            formatter={(v: any) => formatBRL(Math.abs(Number(v)))}
            cursor={{ fill: "var(--muted)", opacity: 0.3 }}
          />
          <ReferenceLine x={0} stroke="var(--border)" />
          <Bar dataKey="valor" radius={[0, 5, 5, 0]}>
            {rows.map((r, i) => (
              <Cell key={i} fill={cor(r.tipo)} />
            ))}
            <LabelList
              dataKey="valor"
              position="right"
              fontSize={10}
              formatter={(v: any) => formatBRLCompact(Math.abs(Number(v)))}
            />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </Card>
  );
}
