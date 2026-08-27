import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { descendeDe, getMascaraConfig } from "@/lib/mascara/interpretar";
import { useVisaoGerencial } from "@/hooks/use-visao-gerencial";
import { lerTudo } from "@/lib/supabase-paginado";

export interface DrilldownAccount {
  codigo_conta: string;
  nome_conta: string | null;
  nivel: number | null;
  tipo_conta: string | null;
  natureza: string | null;
  values: Record<string, number>;
  total: number;
}

/**
 * @deprecated Substituído por `useLancamentosDrilldown`. Mantido apenas
 * para o `account-drilldown-sheet.tsx` legado. As demonstrações são
 * construídas a partir de `plano_contas` + `lancamentos_diario`,
 * não de `chart_of_accounts` + `account_balances`.
 */
export function useAccountDrilldown(
  companyId: string | null,
  codigoConta: string | null,
  periodos: string[],
  enabled: boolean,
) {
  const years = periodos.map((p) => Number(p.slice(0, 4))).filter((n) => !isNaN(n));
  const minYear = years.length > 0 ? Math.min(...years) : 1900;
  const maxYear = years.length > 0 ? Math.max(...years) : 2999;

  return useQuery({
    queryKey: ["drilldown-legacy", companyId, codigoConta, minYear, maxYear],
    enabled: enabled && !!companyId && !!codigoConta,
    queryFn: async (): Promise<DrilldownAccount[]> => {
      const { data: accounts, error: aErr } = await supabase
        .from("chart_of_accounts")
        .select("codigo_conta, nome_conta, nivel, tipo_conta, natureza")
        .eq("company_id", companyId!)
        .ilike("codigo_conta", `${codigoConta}%`)
        .order("codigo_conta");
      if (aErr) throw aErr;

      const codes = (accounts ?? []).map((a) => a.codigo_conta);
      if (codes.length === 0) return [];

      const { data: balances, error: bErr } = await supabase
        .from("account_balances")
        .select("codigo_conta, periodo, saldo_final")
        .eq("company_id", companyId!)
        .in("codigo_conta", codes)
        .gte("periodo", `${minYear}-01-01`)
        .lte("periodo", `${maxYear}-12-31`);
      if (bErr) throw bErr;

      const map = new Map<string, DrilldownAccount>();
      for (const a of accounts ?? []) {
        map.set(a.codigo_conta, {
          codigo_conta: a.codigo_conta,
          nome_conta: a.nome_conta,
          nivel: a.nivel,
          tipo_conta: a.tipo_conta,
          natureza: a.natureza,
          values: {},
          total: 0,
        });
      }
      for (const b of balances ?? []) {
        const acc = map.get(b.codigo_conta);
        if (!acc) continue;
        const v = Number(b.saldo_final) || 0;
        acc.values[b.periodo] = (acc.values[b.periodo] ?? 0) + v;
        acc.total += v;
      }
      return Array.from(map.values())
        .filter((a) => Object.keys(a.values).length > 0)
        .sort((a, b) => Math.abs(b.total) - Math.abs(a.total));
    },
  });
}

// ---------------------------------------------------------------------------
// Novo drill-down: lançamentos do diário
// ---------------------------------------------------------------------------

export interface LancamentoRow {
  id: string;
  data: string; // yyyy-mm-dd
  historico: string | null;
  debito: number;
  credito: number;
  conta_codigo: string;
}

export interface SaldoInicialRow {
  conta_codigo: string;
  data_referencia: string;
  saldo: number;
}

export interface AjusteGerencialRow {
  id: string;
  competencia: string; // YYYY-MM-DD
  descricao: string;
  valor: number;
  debito: number;   // valor se nossa conta está no débito, senão 0
  credito: number;  // valor se nossa conta está no crédito, senão 0
  conta_codigo: string;    // nossa conta (lado que bateu)
  contraconta: string;     // a outra conta da partida
  isAnterior: boolean;     // true se competência < min (só relevante para BP)
}

export interface LancamentosDrilldownResult {
  entries: LancamentoRow[];
  saldoInicial: SaldoInicialRow[]; // por conta
  contasMap: Record<string, { codigo: string; descricao: string }>;
  contasEncontradas: number;
  minCompetencia: string;
  maxCompetencia: string;
  ajustes: AjusteGerencialRow[];
}


function competenciaRange(periodos: string[]): { min: string; max: string } {
  // periodos: YYYY-MM ou YYYY-MM-01 (aceita ambos)
  const norm = periodos
    .map((p) => p.slice(0, 7)) // YYYY-MM
    .filter((p) => /^\d{4}-\d{2}$/.test(p))
    .sort();
  if (norm.length === 0) {
    return { min: "1900-01-01", max: "2999-12-01" };
  }
  return { min: `${norm[0]}-01`, max: `${norm[norm.length - 1]}-01` };
}

/**
 * O texto da linha agregada, por MOTIVO — e não por chute.
 *
 * A primeira versão escrevia sempre "ECD sem partidas no arquivo". Isso é
 * uma conclusão, não um fato: o banco só sabe que não há lançamento
 * gravado. Quando o ECD foi importado antes do diário existir, o arquivo
 * pode estar cheio de partidas e a frase mandava procurar defeito no
 * lugar errado.
 */
const MOTIVO_AGREGADO: Record<string, string> = {
  ecd_diario_nao_lido:
    "Movimento do mês — o diário deste ECD ainda não foi lido " +
    "(painel do ECD › \"Reler o arquivo\")",
  ecd_sem_partida_na_conta:
    "Movimento do mês — o diário foi lido e não há partida nesta conta",
  sem_diario: "Movimento do mês (saldo agregado, sem diário)",
};

async function fetchTenantId(companyId: string): Promise<string | null> {
  const { data } = await supabase
    .from("companies")
    .select("tenant_id")
    .eq("id", companyId)
    .maybeSingle();
  return (data?.tenant_id as string | undefined) ?? null;
}

async function fetchInBatches<T>(
  codes: string[],
  runner: (batch: string[]) => Promise<T[]>,
): Promise<T[]> {
  const batchSize = 400;
  const out: T[] = [];
  for (let i = 0; i < codes.length; i += batchSize) {
    const batch = codes.slice(i, i + batchSize);
    const rows = await runner(batch);
    out.push(...rows);
  }
  return out;
}

/**
 * O miolo do drill-down, fora do hook.
 *
 * Existe separado por uma razão que custou caro: a bateria do ajuste 37
 * conferia a RPC `drilldown_contas` e dava tudo verde, enquanto a tela
 * continuava vazia — porque o que a tela faz DEPOIS da RPC (buscar o
 * lançamento pelos códigos que ela devolveu) não estava sendo exercitado
 * por ninguém. Testar a peça errada é o mesmo que não testar.
 *
 * Agora a bateria chama ISTO, que é literalmente o que o navegador roda.
 */
export async function carregarDrilldown(
  companyId: string,
  classificacao: string,
  periodos: string[],
  opts: { incluirSaldoInicial: boolean; visao?: string; chaveDfc?: boolean },
): Promise<LancamentosDrilldownResult> {
  const { min, max } = competenciaRange(periodos);
  const visao = opts.visao ?? "contabil";
  return carregar(
    companyId,
    classificacao,
    min,
    max,
    opts.incluirSaldoInicial,
    visao,
    opts.chaveDfc ?? false,
  );
}

export function useLancamentosDrilldown(
  companyId: string | null,
  classificacao: string | null,
  periodos: string[],
  opts: { incluirSaldoInicial: boolean; chaveDfc?: boolean },
  enabled: boolean,
) {
  const { min, max } = competenciaRange(periodos);
  const { visao } = useVisaoGerencial();

  return useQuery({
    queryKey: [
      "drilldown-lanc",
      companyId,
      classificacao,
      min,
      max,
      opts.incluirSaldoInicial,
      visao,
      opts.chaveDfc ?? false,
    ],
    enabled: enabled && !!companyId && !!classificacao,
    queryFn: () =>
      carregar(
        companyId!,
        classificacao!,
        min,
        max,
        opts.incluirSaldoInicial,
        visao,
        opts.chaveDfc ?? false,
      ),
  });
}

async function prefixosDfc(companyId: string, codigoDfc: string): Promise<string[]> {
  const { data, error } = await (supabase as any).rpc("dfc_mapa", {
    _company_id: companyId,
  });
  if (error) {
    console.warn("[dfc_mapa drilldown]", error.message);
    return [];
  }
  const out: string[] = [];
  for (const r of (data ?? []) as { classificacao: string; codigo_dfc: string }[]) {
    if (r.codigo_dfc === codigoDfc) out.push(r.classificacao);
  }
  return out;
}

async function carregar(
  companyId: string,
  classificacao: string,
  min: string,
  max: string,
  incluirSaldoInicial: boolean,
  visao: string,
  chaveDfc = false,
): Promise<LancamentosDrilldownResult> {
  const opts = { incluirSaldoInicial };
      const tenantId = await fetchTenantId(companyId!);
      const mascara = tenantId
        ? await getMascaraConfig({ tenantId, companyId })
        : undefined;
      const sep = mascara?.separador || ".";

      const prefixos = chaveDfc
        ? await prefixosDfc(companyId, classificacao)
        : [classificacao];

      const contas: {
        codigo: string;
        descricao: string;
        classificacao: string;
      }[] = [];
      const visto = new Set<string>();
      for (const pref of prefixos.length > 0 ? prefixos : [classificacao]) {
        const { data: contasRpc, error: pErr } = await (supabase as any).rpc(
          "drilldown_contas",
          {
            _company_id: companyId!,
            _classificacao: pref,
            _competencia_min: min,
            _competencia_max: max,
          },
        );
        if (pErr) throw pErr;
        for (const r of (contasRpc ?? []) as {
          codigo: string;
          descricao: string;
          classificacao: string;
        }[]) {
          if (visto.has(r.codigo)) continue;
          visto.add(r.codigo);
          contas.push(r);
        }
      }

      // Folha da DRE/BP guarda o CÓDIGO da conta, não a classificação.
      // O RPC só casava prefixo de classificação — a gaveta abria vazia.
      if (contas.length === 0 && !chaveDfc && classificacao && tenantId) {
        const porCodigo = async (escopoEmpresa: boolean) => {
          let q = supabase
            .from("plano_contas")
            .select("codigo, descricao, classificacao")
            .eq("tenant_id", tenantId)
            .eq("ativo", true)
            .eq("codigo", classificacao);
          q = escopoEmpresa
            ? q.eq("company_id", companyId)
            : q.is("company_id", null);
          const { data } = await q.limit(8);
          return (data ?? []) as {
            codigo: string;
            descricao: string;
            classificacao: string;
          }[];
        };
        let achadas = await porCodigo(true);
        if (achadas.length === 0) achadas = await porCodigo(false);
        for (const r of achadas) {
          if (visto.has(r.codigo)) continue;
          visto.add(r.codigo);
          contas.push(r);
        }
      }

      const contasMap: Record<string, { codigo: string; descricao: string }> = {};
      for (const r of contas) {
        contasMap[r.codigo] = { codigo: r.codigo, descricao: r.descricao };
      }
      const codes = contas.map((r) => r.codigo);

      // 1b) Contas gerenciais que caem sob esta classificação (visão gerencial).
      // Classif. virtual = `${classificacao_pai}${sep}${codigo}`.
      const gerCodes: string[] = [];
      if (visao === "gerencial" && classificacao) {
        const { data: gerRows, error: gErr } = await supabase
          .from("contas_gerenciais")
          .select("codigo, descricao, classificacao")
          .eq("company_id", companyId!);
        if (gErr) throw gErr;
        for (const g of (gerRows ?? []) as any[]) {
          const virtual = `${g.classificacao}${sep}${g.codigo}`;
          const match = prefixos.some(
            (pref) => virtual === pref || virtual.startsWith(`${pref}${sep}`),
          );
          if (match) {
            gerCodes.push(g.codigo);
            if (!contasMap[g.codigo]) {
              contasMap[g.codigo] = { codigo: g.codigo, descricao: g.descricao };
            }
          }
        }
      }

      const allOurCodes = new Set<string>([...codes, ...gerCodes]);

      if (codes.length === 0 && gerCodes.length === 0) {
        return {
          entries: [],
          saldoInicial: [],
          contasMap,
          contasEncontradas: 0,
          minCompetencia: min,
          maxCompetencia: max,
          ajustes: [],
        };
      }

      // 2) Lançamentos contábeis (só contas contábeis)
      //
      // Paginado. Sem isso o PostgREST corta em `max_rows = 1000` sem
      // dizer nada: a gaveta de uma conta movimentada mostrava as mil
      // primeiras linhas e um total que não batia com a demonstração —
      // e nada na tela indicava que faltava.
      const entries = codes.length === 0
        ? []
        : await fetchInBatches(codes, async (batch) => {
            const linhas = await lerTudo<any>(
              (de, ate) =>
                supabase
                  .from("lancamentos_diario")
                  .select("id, data, historico, debito, credito, conta_codigo")
                  .eq("company_id", companyId!)
                  .in("conta_codigo", batch)
                  .gte("competencia", min)
                  .lte("competencia", max)
                  .order("data", { ascending: true })
                  .order("id", { ascending: true })
                  .range(de, ate),
              "drill-down: lançamentos",
            );
            return linhas.map((r: any) => ({
              id: r.id,
              data: r.data,
              historico: r.historico,
              debito: Number(r.debito) || 0,
              credito: Number(r.credito) || 0,
              conta_codigo: r.conta_codigo,
            })) as LancamentoRow[];
          });

      // 2b) O mês agregado, onde não há partida.
      //
      // ECD sem os registros I200/I250 — e todo ECD importado antes do
      // ajuste 37 — tem saldo mensal e nenhum lançamento. A gaveta abria
      // a conta certa e dizia "sem lançamentos" para uma conta que
      // claramente moveu. Agora mostra o movimento do mês numa linha só,
      // marcada como agregada. A função do banco só devolve
      // conta+competência que NÃO tenham lançamento: onde existe diário,
      // quem manda é o diário.
      if (codes.length > 0) {
        const { data: mensais, error: mErr } = await (supabase as any).rpc(
          "drilldown_saldo_mensal",
          {
            _company_id: companyId!,
            _codigos: codes,
            _competencia_min: min,
            _competencia_max: max,
          },
        );
        if (mErr) {
          // Função ausente (banco ainda sem a migração) não pode derrubar
          // o drill-down inteiro — o diário de verdade já está na mão.
          console.warn("[drilldown_saldo_mensal]", mErr.message);
        } else {
          for (const r of (mensais ?? []) as any[]) {
            entries.push({
              id: `sm:${r.conta_codigo}:${r.competencia}`,
              data: r.competencia,
              historico: MOTIVO_AGREGADO[r.motivo as string] ??
                (r.do_ecd
                  ? "Movimento do mês (ECD)"
                  : "Movimento do mês (saldo agregado, sem diário)"),
              debito: Number(r.debito) || 0,
              credito: Number(r.credito) || 0,
              conta_codigo: r.conta_codigo,
            });
          }
        }
      }

      entries.sort((a, b) => {
        if (a.data === b.data) return a.id.localeCompare(b.id);
        return a.data.localeCompare(b.data);
      });

      // 3) Saldo inicial (Balanço) — só contas contábeis
      let saldoInicial: SaldoInicialRow[] = [];
      if (opts.incluirSaldoInicial && codes.length > 0) {
        saldoInicial = await fetchInBatches(codes, async (batch) => {
          const data = await lerTudo<any>(
            (de, ate) =>
              supabase
                .from("saldos_abertura")
                .select("conta_codigo, data_referencia, saldo")
                .eq("company_id", companyId!)
                .in("conta_codigo", batch)
                .lte("data_referencia", min)
                .order("conta_codigo", { ascending: true })
                .range(de, ate),
            "drill-down: abertura",
          );
          return (data ?? []).map((r: any) => ({
            conta_codigo: r.conta_codigo,
            data_referencia: r.data_referencia,
            saldo: Number(r.saldo) || 0,
          })) as SaldoInicialRow[];
        });
      }

      // 4) Ajustes gerenciais (visão gerencial).
      //    - DRE  (sem saldo inicial): apenas [min, max] (fluxo do período)
      //    - BP   (com saldo inicial): tudo até max (posição acumulada)
      const ajustes: AjusteGerencialRow[] = [];
      if (visao === "gerencial") {
        let q = supabase
          .from("ajustes_gerenciais")
          .select("id, competencia, descricao, valor, conta_debito, conta_credito")
          .eq("company_id", companyId!)
          .lte("competencia", max);
        if (!opts.incluirSaldoInicial) q = q.gte("competencia", min);
        const { data, error } = await q;
        if (error) throw error;
        for (const a of (data ?? []) as any[]) {
          const valor = Number(a.valor) || 0;
          const hitDeb = allOurCodes.has(a.conta_debito);
          const hitCre = allOurCodes.has(a.conta_credito);
          if (!hitDeb && !hitCre) continue;
          const isAnterior = a.competencia < min;
          if (hitDeb) {
            ajustes.push({
              id: `${a.id}:D`,
              competencia: a.competencia,
              descricao: a.descricao,
              valor,
              debito: valor,
              credito: 0,
              conta_codigo: a.conta_debito,
              contraconta: a.conta_credito,
              isAnterior,
            });
          }
          if (hitCre) {
            ajustes.push({
              id: `${a.id}:C`,
              competencia: a.competencia,
              descricao: a.descricao,
              valor,
              debito: 0,
              credito: valor,
              conta_codigo: a.conta_credito,
              contraconta: a.conta_debito,
              isAnterior,
            });
          }
        }
        ajustes.sort((a, b) => a.competencia.localeCompare(b.competencia));
      }

      return {
        entries,
        saldoInicial,
        contasMap,
        contasEncontradas: codes.length + gerCodes.length,
        minCompetencia: min,
        maxCompetencia: max,
        ajustes,
      };
}

