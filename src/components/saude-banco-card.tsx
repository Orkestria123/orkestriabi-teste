import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Database } from "lucide-react";
import {
  CUSTO_HORA_CREDITOS,
  TAMANHO_BANCO,
  custoPorDia,
  custoPorMes,
} from "@/lib/monitoramento/custo-banco";

interface Metrica {
  coletado_em: string;
  tamanho_bytes: number;
  conexoes: number;
  conexoes_ativas: number;
  max_conexoes: number;
}
interface Saude {
  atual: Metrica | null;
  historico: Metrica[];
  cache_hit: number | null;
  consultas_lentas: { consulta: string; chamadas: number; media_ms: number; max_ms: number }[];
}

const gb = (b: number) => `${(b / 1024 ** 3).toFixed(2).replace(".", ",")} GB`;
const num = (n: number, d = 2) => n.toLocaleString("pt-BR", { minimumFractionDigits: d, maximumFractionDigits: d });

export function SaudeBancoCard() {
  const { data, error } = useQuery({
    queryKey: ["saude-banco"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("obter_saude_db" as never);
      if (error) throw error;
      return data as unknown as Saude;
    },
    refetchInterval: 5 * 60_000,
  });

  if (error) return null;
  const a = data?.atual;
  const hist = data?.historico ?? [];
  const pico = hist.reduce<Metrica | null>((p, m) => (!p || m.conexoes > p.conexoes ? m : p), null);
  const inicio = hist[0];
  const crescimento = a && inicio ? a.tamanho_bytes - inicio.tamanho_bytes : 0;
  const ocupacao = a ? (a.conexoes / a.max_conexoes) * 100 : 0;
  const status = ocupacao > 80 ? "Atenção" : "Normal";
  const maxBarra = Math.max(1, ...hist.map((m) => m.conexoes));
  const ultimos = hist.slice(-48);

  return (
    <Card className="p-5">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-sm font-semibold flex items-center gap-2">
          <Database className="h-4 w-4" /> Banco de dados
        </h3>
        <span className={ocupacao > 80 ? "text-xs font-medium text-destructive" : "text-xs font-medium text-primary"}>
          Monitoramento: {status}
        </span>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
        <Info label="Tamanho" value={a ? gb(a.tamanho_bytes) : "—"} hint={hist.length > 1 ? `${crescimento >= 0 ? "+" : ""}${gb(crescimento)} em ${Math.max(1, Math.round((Date.now() - new Date(inicio.coletado_em).getTime()) / 864e5))} dia(s)` : undefined} />
        <Info label="Conexões agora" value={a ? `${a.conexoes} de ${a.max_conexoes}` : "—"} hint={a ? `${a.conexoes_ativas} executando` : undefined} />
        <Info label="Pico de conexões" value={pico ? String(pico.conexoes) : "—"} hint={pico ? new Date(pico.coletado_em).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }) : undefined} />
        <Info label="Leituras da memória" value={data?.cache_hit != null ? `${num(data.cache_hit)}%` : "—"} hint="acima de 99% é saudável" />
      </div>
      <div className="mt-4 rounded-lg border bg-muted/40 p-3">
        <div className="mb-2 flex items-center justify-between gap-3">
          <div className="text-xs uppercase tracking-wider text-muted-foreground">Resumo do custo estimado</div>
          <div className="text-[11px] text-muted-foreground">tamanho {TAMANHO_BANCO} · banco ligado o dia todo</div>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <Custo label="Por hora ativa" valor={`≈ ${num(CUSTO_HORA_CREDITOS)}`} unidade="crédito" />
          <Custo label="Por dia (24 h)" valor={`≈ ${num(custoPorDia())}`} unidade="créditos" />
          <Custo label="Por mês (30 dias)" valor={`≈ ${num(custoPorMes(), 0)}`} unidade="créditos" />
        </div>
        <div className="mt-2 text-[11px] text-muted-foreground">
          Se o banco ficar ativo só parte do dia, o valor cai na mesma proporção: 8 h por dia dá ≈ {num(custoPorMes() / 3, 0)} créditos no mês.
        </div>
      </div>
      {ultimos.length > 1 && (
        <div className="mt-4">
          <div className="text-xs text-muted-foreground mb-1">Conexões por hora (últimos registros)</div>
          <div className="flex h-12 items-end gap-0.5">
            {ultimos.map((m) => (
              <div key={m.coletado_em} title={`${new Date(m.coletado_em).toLocaleString("pt-BR")}: ${m.conexoes}`}
                className="flex-1 rounded-sm bg-primary/70" style={{ height: `${(m.conexoes / maxBarra) * 100}%` }} />
            ))}
          </div>
        </div>
      )}
      {!!data?.consultas_lentas?.length && (
        <div className="mt-4">
          <div className="text-xs text-muted-foreground mb-1">Consultas que mais consomem tempo</div>
          <ul className="space-y-1 text-xs">
            {data.consultas_lentas.map((q, i) => (
              <li key={i} className="flex justify-between gap-3">
                <span className="truncate font-mono text-muted-foreground">{q.consulta}</span>
                <span className="shrink-0 tabular-nums">{q.chamadas}× · média {num(q.media_ms, 1)} ms · pico {num(q.max_ms, 1)} ms</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      <p className="mt-3 text-[11px] text-muted-foreground">
        Custo é estimativa do tamanho Small; valores reais e memória ficam no painel do Lovable Cloud. Medições registradas a cada hora.
      </p>
    </Card>
  );
}

function Custo({ label, valor, unidade }: { label: string; valor: string; unidade: string }) {
  return (
    <div>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-0.5 text-lg font-semibold tabular-nums leading-tight">{valor}</div>
      <div className="text-[11px] text-muted-foreground">{unidade}</div>
    </div>
  );
}

function Info({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="mt-1 text-lg font-semibold tabular-nums">{value}</div>
      {hint && <div className="text-xs text-muted-foreground">{hint}</div>}
    </div>
  );
}
