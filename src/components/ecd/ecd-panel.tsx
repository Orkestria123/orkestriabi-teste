// Importação de ECD para os períodos anteriores ao diário.
//
// O fluxo é deliberadamente em três passos, e não um botão só:
//
//   1. Importar   o arquivo vira dados em ESPERA. Nada entra na
//                 contabilidade.
//   2. Vincular   cada conta do ECD ganha um destino no plano. O sistema
//                 sugere; você confere e corrige.
//   3. Aplicar    só então vira saldo de verdade.
//
// A conferência que decide se está certo é a VIRADA: o saldo final do
// ECD no último mês tem que bater com o saldo de abertura que já está no
// sistema, vindo do diário já validado. São dois documentos
// independentes — se batem, o de-para está certo.
import { useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Loader2, Upload, CheckCircle2, AlertTriangle, XCircle, Undo2, Wand2, RefreshCw,
  Search, FolderTree,
} from "lucide-react";
import { toast } from "sonner";
import { parseSpedContabil } from "@/lib/sped-parser";
import { lerTudo } from "@/lib/supabase-paginado";
import { tituloConta } from "@/lib/format";
import { useContasDestino } from "@/hooks/use-contas-destino";
import { SeletorConta } from "@/components/contas/seletor-conta";
import { BarraDepara } from "@/components/contas/barra-depara";
import { CabecalhoGrupo } from "@/components/contas/grupo-depara";
import {
  filtrarLinhas, contarEstados, estadoDe, veioDeSugestaoAutomatica,
  agruparPorClassificacao, agruparPorChave, niveisDisponiveis,
  agruparPorCaminho, niveisDoCaminho, caminhoSemFolha,
  segmentosCaminho, SEP_CAMINHO_TELA,
  type FiltroEstado, type LinhaDepara,
} from "@/lib/contas/filtro-depara";
import { Fragment } from "react";

/**
 * O galho da conta, pronto para a tela: "Ativo › Ativo Imobilizado".
 *
 * Sem a folha — o nome da conta já é o título da linha, repeti-lo no fim
 * do caminho só gasta espaço. E cada degrau em caixa de título, porque o
 * ECD grava tudo em maiúsculas e uma linha inteira gritando é ilegível.
 */
const galhoDeCaminho = (caminho: string | null | undefined) =>
  segmentosCaminho(caminhoSemFolha(caminho))
    .map((s) => tituloConta(s))
    .join(SEP_CAMINHO_TELA);


/**
 * Manda o diário do ECD (I200/I250) para o banco, em blocos.
 *
 * Um ECD de empresa média tem dezenas de milhares de partidas. Mandar
 * tudo num payload só é pedir timeout — e o erro apareceria como
 * "importou mas o drill-down não abre", que é justamente o sintoma que
 * este código existe para remover.
 */
async function enviarLancamentos(importacaoId: string, lancamentos: any[]) {
  const BLOCO = 5000;
  if (lancamentos.length === 0) return 0;
  let total = 0;
  for (let i = 0; i < lancamentos.length; i += BLOCO) {
    const { data, error } = await (supabase as any).rpc("ecd_gravar_lancamentos", {
      _importacao_id: importacaoId,
      // O parser chama de `codigo_conta` (como o resto dele); a função do
      // banco espera `codigo`. A tradução acontece AQUI, na fronteira —
      // sem isto o `jsonb_to_recordset` lê NULL e grava zero linhas, em
      // silêncio, e o sintoma reaparece como "o drill-down não abre".
      _linhas: lancamentos.slice(i, i + BLOCO).map((l: any) => ({
        numero: l.numero, data: l.data, codigo: l.codigo_conta,
        debito: l.debito, credito: l.credito, historico: l.historico,
      })),
      _primeiro_bloco: i === 0,
    });
    if (error) throw new Error(error.message);
    total = Number(data?.total ?? 0);
  }
  return total;
}

const brl = (v: number | null | undefined) =>
  (Number(v) || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const mes = (d: string) => String(d ?? "").slice(0, 7).split("-").reverse().join("/");
const dia = (d: string | null | undefined) =>
  d ? String(d).slice(0, 10).split("-").reverse().join("/") : "—";

interface Props { tenantId: string; companyId: string }

export function EcdPanel({ tenantId, companyId }: Props) {
  const qc = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  // Segundo seletor de arquivo, só para reler I051/I052 de uma importação
  // que já está no banco. Separado do de importar de propósito: são dois
  // gestos com consequências muito diferentes.
  const refRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [selecionada, setSelecionada] = useState<string | null>(null);
  // O que "Conferir grupos" achou fora do lugar. Fica na tela até você
  // realocar ou trocar de importação — é a lista que você vai querer ler
  // com calma antes de deixar o robô mexer.
  const [foraDoGrupo, setForaDoGrupo] = useState<any[]>([]);
  // ---- fila de vínculo: filtro, busca, seleção em lote e janela ----
  const [busca, setBusca] = useState("");
  const [filtro, setFiltro] = useState<FiltroEstado>("todas");
  const [marcadas, setMarcadas] = useState<Set<string>>(new Set());
  // Um ECD de verdade traz centenas de contas; desenhar todas de uma vez
  // trava a rolagem. Mostra um bloco e cresce sob demanda.
  const [limite, setLimite] = useState(150);
  const [nivelGrupo, setNivelGrupo] = useState(0);

  const invalidar = () => {
    qc.invalidateQueries({ queryKey: ["ecd-importacoes", companyId] });
    qc.invalidateQueries({ queryKey: ["ecd-contas", selecionada] });
    qc.invalidateQueries({ queryKey: ["ecd-conferencia", selecionada] });
    qc.invalidateQueries({ queryKey: ["ecd-depara", companyId] });
    qc.invalidateQueries({ queryKey: ["ecd-automaticas", selecionada] });
    qc.invalidateQueries({ queryKey: ["ecd-encerramento", selecionada] });
    qc.invalidateQueries({ queryKey: ["ecd-diario", selecionada] });
    qc.invalidateQueries({ queryKey: ["ecd-natureza", selecionada] });
  };

  const { data: importacoes, isLoading } = useQuery({
    queryKey: ["ecd-importacoes", companyId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("ecd_importacao" as any)
        .select("*").eq("company_id", companyId).order("criado_em", { ascending: false });
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  const atual = useMemo(
    () => (importacoes ?? []).find((i) => i.id === selecionada) ?? (importacoes ?? [])[0] ?? null,
    [importacoes, selecionada],
  );

  // ---------- contas do ECD + vínculo atual ----------
  const { data: contas } = useQuery({
    queryKey: ["ecd-contas", atual?.id],
    enabled: !!atual?.id,
    queryFn: async () => {
      // Paginado: um ECD de 500 contas × 12 meses são 6.000 linhas de
      // saldo, e o servidor corta em 1.000 sem avisar. O resultado era
      // 83% das contas aparecendo com movimento e saldo ZERO — o que
      // corrompe o filtro "com movimento", a contagem de pendentes e a
      // coluna "saldo final", que é justamente o número da virada.
      const cs = await lerTudo<any>(
        (de, ate) => supabase
          .from("ecd_conta" as any)
          .select("codigo, descricao, tipo, classificacao, classificacao_origem, " +
                  "cod_superior, caminho_nomes, caminho_codigos, profundidade")
          .eq("importacao_id", atual.id)
          .order("codigo")
          .range(de, ate),
        "ecd_conta",
      );
      // Nome da conta superior: é o rótulo do grupo quando se agrupa pelo
      // galho do próprio ECD.
      const nomePai = new Map<string, string>();
      for (const c of cs) nomePai.set(c.codigo, c.descricao ?? "");

      const sal = await lerTudo<any>(
        (de, ate) => supabase
          .from("ecd_saldo" as any)
          .select("codigo, competencia, saldo_final, debitos, creditos")
          .eq("importacao_id", atual.id)
          // ORDENADO. O código antigo dizia em comentário "a última lida
          // vale; ordenado abaixo" — e não havia ordenação nenhuma, nem
          // aqui nem depois. Cada conta exibia o saldo final de um mês
          // qualquer.
          .order("codigo").order("competencia")
          .range(de, ate),
        "ecd_saldo",
      );
      const porConta = new Map<string, { mov: number; fim: number }>();
      for (const s of sal) {
        const cur = porConta.get(s.codigo) ?? { mov: 0, fim: 0 };
        cur.mov += Math.abs(Number(s.debitos) || 0) + Math.abs(Number(s.creditos) || 0);
        cur.fim = Number(s.saldo_final) || 0; // ordenado por competência: a última é a última
        porConta.set(s.codigo, cur);
      }
      return cs
        .filter((c) => (c.tipo ?? "A") !== "S")
        .map((c) => ({
          ...c,
          ...(porConta.get(c.codigo) ?? { mov: 0, fim: 0 }),
          nome_pai: nomePai.get(c.cod_superior ?? "") ?? null,
        }));
    },
  });

  const { data: depara } = useQuery({
    queryKey: ["ecd-depara", companyId],
    queryFn: async () => {
      // Paginado: uma linha por conta vinculada. Acima de 1.000, as
      // contas que ficavam de fora apareciam como PENDENTES mesmo já
      // vinculadas — e, como "pendente com movimento" desabilita o
      // botão, o "Aplicar" ficava travado sem nada a corrigir.
      const data = await lerTudo<any>(
        (de, ate) => supabase
          .from("depara_contas" as any)
          .select("conta_codigo, conta_padrao_codigo, ignorada, observacao")
          .eq("company_id", companyId)
          .order("conta_codigo")
          .range(de, ate),
        "depara_contas",
      );
      return new Map(data.map((d: any) => [d.conta_codigo, d]));
    },
  });

  const { data: conferencia } = useQuery({
    queryKey: ["ecd-conferencia", atual?.id],
    enabled: !!atual?.id,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .rpc("ecd_conferencia", { _importacao_id: atual.id });
      if (error) throw error;
      return data as any;
    },
  });

  // Quantas sugestões automáticas ainda estão de pé. É o que decide se
  // o botão "Refazer" aparece — e quantas linhas ele vai jogar fora.
  const { data: automaticas } = useQuery({
    queryKey: ["ecd-automaticas", atual?.id],
    enabled: !!atual?.id,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .rpc("ecd_contar_automaticas", { _importacao_id: atual.id });
      if (error) throw error;
      return Number(data ?? 0);
    },
  });

  // O ECD traz o encerramento do exercício? É a explicação mais comum
  // para "o número está errado" sem que a alocação esteja.
  const { data: encerramento } = useQuery({
    queryKey: ["ecd-encerramento", atual?.id],
    enabled: !!atual?.id,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .rpc("ecd_encerramento", { _importacao_id: atual.id });
      if (error) throw error;
      return data as any;
    },
  });

  // O estado do DIÁRIO desta importação. É o número que decide se o
  // drill-down mostra partida ou só o total do mês — e ele não aparecia
  // em lugar nenhum da tela, então "o drill-down só mostra o mês" não
  // tinha como ser diagnosticado olhando o painel.
  const { data: diario } = useQuery({
    queryKey: ["ecd-diario", atual?.id],
    enabled: !!atual?.id,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .rpc("ecd_estado_diario", { _importacao_id: atual.id });
      if (error) throw error;
      return data as any;
    },
  });

  // A conferência de NATUREZA. O arquivo declara, em cada conta, se ela
  // é ativo, passivo, PL ou resultado (COD_NAT do I050). Se o destino do
  // de-para tem outra natureza, uma das duas está errada — sempre.
  //
  // Foi ela que achou os R$ 13,5 milhões: uma conta de PASSIVO
  // ("LUCROS DISTRIBUIDOS A PAGAR") apontando para uma linha de DRE.
  // O nome casava; a natureza, não.
  const { data: natureza } = useQuery({
    queryKey: ["ecd-natureza", atual?.id],
    enabled: !!atual?.id,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .rpc("ecd_conferir_natureza", { _importacao_id: atual.id });
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  // Contas de destino: uma consulta só, cache compartilhado com o
  // de-para do plano. A busca acontece na memória, a cada tecla.
  const { data: destinos, isLoading: carregandoDestinos } = useContasDestino(tenantId);

  // ---------- ações ----------
  /**
   * Reler SÓ os códigos do plano (I051/I052) de um arquivo já importado.
   *
   * Existe por uma razão específica e por culpa minha: o I051/I052 é lido
   * no NAVEGADOR, no momento do upload. Uma importação feita antes de o
   * parser saber ler esses registros — ou feita com o parser lendo o
   * campo errado, que foi o caso — fica no banco sem código estrutural
   * para sempre, mesmo que o arquivo o traga em toda linha.
   *
   * Reimportar resolveria, mas é caro e mexe em saldo. Isto não toca em
   * saldo nenhum: lê o arquivo, manda os códigos e reclassifica.
   */
  const relerCodigos = async (arquivo: File) => {
    if (!atual?.id) return;
    setBusy("reler");
    try {
      const p = parseSpedContabil(await arquivo.text());
      if (p.planoContas.length === 0) {
        throw new Error("O arquivo não tem plano de contas (registro I050). É mesmo um ECD?");
      }
      const refs = p.planoContas
        .filter((c: any) => c.cod_referencial || c.cod_aglutinacao)
        .map((c: any) => ({
          codigo: c.codigo_conta,
          cod_referencial: c.cod_referencial ?? null,
          cod_aglutinacao: c.cod_aglutinacao ?? null,
        }));
      // ATENÇÃO ao que este `if` já fez de errado: ele tinha um `return`.
      // Arquivo sem I051/I052 saía daqui SEM ler o diário — e é
      // exatamente o arquivo que mais precisa, porque é o que não tem
      // código estrutural nenhum. Quem apertasse o botão via a mensagem
      // "não traz I051", concluiria que não havia nada a fazer, e o
      // drill-down continuaria vazio. O aviso fica; o `return` sai.
      let data: any = { contas_com_referencia: 0, reclassificadas: 0 };
      if (refs.length === 0) {
        toast.warning(
          "Este arquivo não traz I051 nem I052 — não há código estrutural nele para ler. " +
          "O galho por nome continua sendo o caminho. Sigo lendo o diário do arquivo.",
          { duration: 10000 });
      } else {
        const r = await (supabase as any).rpc("ecd_gravar_referencias", {
          _importacao_id: atual.id, _refs: refs,
        });
        if (r.error) throw new Error(r.error.message);
        data = r.data;
      }

      // O mesmo arquivo traz o diário: aproveita a leitura.
      let nLctos = 0;
      let erroDiario: string | null = null;
      try {
        nLctos = await enviarLancamentos(atual.id, p.lancamentos ?? []);
      } catch (e: any) { erroDiario = e?.message ?? String(e); }

      // Gravar o diário não basta: quem o coloca em `lancamentos_diario`
      // — que é de onde o drill-down lê — é a aplicação. Numa importação
      // JÁ APLICADA ninguém ia apertar "Aplicar" de novo, e o diário
      // ficava parado na tabela do ECD sem chegar à tela. Materializa
      // aqui, e só aqui: não toca em saldo nenhum.
      let nMaterializados = 0;
      if (nLctos > 0 && atual.status === "aplicado") {
        const m = await (supabase as any).rpc("ecd_materializar_lancamentos", {
          _importacao_id: atual.id,
        });
        if (m.error) {
          toast.warning(
            "O diário foi lido, mas não chegou ao drill-down: " + m.error.message +
            ". Use \"Aplicar\" para completar.",
            { duration: 12000 });
        } else {
          nMaterializados = Number(m.data?.lancamentos ?? 0);
        }
      }

      if (nLctos === 0) {
        toast.warning(
          erroDiario
            ? "O diário (I200/I250) não entrou: " + erroDiario
            : "Este arquivo não traz o diário (registros I200/I250). O drill-down mostra as " +
              "contas e o total do mês, mas não a partida linha a linha.",
          { duration: 12000 });
      }

      toast.success(
        (refs.length > 0
          ? `${data.contas_com_referencia} conta(s) receberam o código do plano; ` +
            `${data.reclassificadas} reclassificada(s)`
          : "Códigos estruturais: nada a ler neste arquivo") +
        (nLctos > 0 ? `; ${nLctos.toLocaleString("pt-BR")} lançamento(s) do diário lidos` : "") +
        (nMaterializados > 0
          ? `; ${nMaterializados.toLocaleString("pt-BR")} já no drill-down`
          : "") +
        `. Nenhum saldo foi tocado.`,
        { duration: 10000 });
      invalidar();
    } catch (e: any) { toast.error(e.message, { duration: 12000 }); }
    finally { setBusy(null); }
  };

  const importar = async (arquivo: File) => {
    setBusy("importar");
    try {
      const texto = await arquivo.text();
      const p = parseSpedContabil(texto);
      if (p.planoContas.length === 0) {
        throw new Error("O arquivo não tem plano de contas (registro I050). É mesmo um ECD?");
      }
      if (p.saldos.length === 0) {
        throw new Error("O arquivo não tem saldos (registros I150/I155).");
      }
      const { data, error } = await (supabase as any).rpc("ecd_importar", {
        _company_id: companyId,
        _arquivo_nome: arquivo.name,
        _cabecalho: {
          cnpj: p.empresa.cnpj, razaoSocial: p.empresa.razaoSocial,
          periodoInicio: p.empresa.periodoInicio, periodoFim: p.empresa.periodoFim,
        },
        _contas: p.planoContas, _saldos: p.saldos,
      });
      if (error) throw new Error(error.message);
      setSelecionada(data.importacao_id);

      // I051/I052 vão num segundo passo, de propósito: `ecd_importar`
      // já funciona e não precisa mudar por causa de dois campos
      // opcionais. Se o arquivo não trouxer nenhum, isto não faz nada.
      const refs = p.planoContas
        .filter((c: any) => c.cod_referencial || c.cod_aglutinacao)
        .map((c: any) => ({
          codigo: c.codigo_conta,
          cod_referencial: c.cod_referencial ?? null,
          cod_aglutinacao: c.cod_aglutinacao ?? null,
        }));
      if (refs.length > 0) {
        const r = await (supabase as any).rpc("ecd_gravar_referencias", {
          _importacao_id: data.importacao_id, _refs: refs,
        });
        if (r.error) {
          toast.warning(
            "As contas entraram, mas os códigos do plano (I051/I052) não: " + r.error.message,
            { duration: 12000 });
        }
      }
      // O DIÁRIO do ECD. Sem ele o drill-down da DRE e da DFC não abre
      // em período vindo de ECD — a consulta parte das contas que têm
      // lançamento, e não havia nenhum.
      let nLctos = 0;
      try {
        nLctos = await enviarLancamentos(data.importacao_id, p.lancamentos ?? []);
      } catch (e: any) {
        toast.warning(
          "As contas e os saldos entraram, mas o diário (I200/I250) não: " + e.message,
          { duration: 12000 });
      }

      toast.success(
        `${data.contas} conta(s), ${data.meses} mês(es)` +
        (nLctos > 0 ? ` e ${nLctos.toLocaleString("pt-BR")} lançamento(s)` : "") +
        ` em espera. Nada entrou na contabilidade ainda.`,
        { duration: 8000 },
      );
      if (nLctos === 0) {
        toast.warning(
          "Este arquivo não trouxe o diário (registros I200/I250). O drill-down vai " +
          "mostrar as contas e os totais do mês, mas não o lançamento linha a linha.",
          { duration: 12000 });
      }
      if (data.periodos_anuais) {
        toast.warning(
          "Este ECD tem saldos ANUAIS, não mensais — o Balanço do período antigo vai ter degraus.",
          { duration: 12000 },
        );
      }
      invalidar();
    } catch (e: any) {
      toast.error(e.message, { duration: 12000 });
    } finally {
      setBusy(null);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  /**
   * Sugere vínculos. Com `refazer`, joga fora antes as sugestões que o
   * próprio sistema escreveu.
   *
   * Sem isso o "Sugerir" não conseguia corrigir nada: ele só grava onde
   * não há vínculo, e as sugestões antigas — inclusive as erradas —
   * ocupavam a linha. O que você decidiu à mão nunca é descartado; a
   * separação é pela observação que cada gravação carimba.
   */
  /**
   * Alocação automática: a regra EXATA primeiro, a sugestão depois.
   *
   * A exata só existe desde que o I051 passou a ser lido (ajuste 33): a
   * classificação estrutural do ECD comparada com a classificação do
   * plano. Não é semelhança de nome nem coincidência de número — é o
   * mesmo código de plano de contas dos dois lados, e por isso essas
   * entram como VINCULADAS, não como sugestão a conferir.
   */
  const alocarAutomatico = async (refazer = false) => {
    if (refazer && !confirm(
      "Refazer descarta o que o sistema alocou sozinho e calcula de novo.\n\n" +
      "O que você vinculou à mão, ignorou ou já conferiu NÃO é tocado.")) return;
    setBusy("auto");
    try {
      const { data, error } = await (supabase as any)
        .rpc("ecd_alocar_automatico", { _importacao_id: atual.id, _refazer: refazer });
      if (error) throw new Error(error.message);
      const regras = Object.entries(data.por_regra ?? {})
        .map(([k, v]) => `${v} por ${k}`).join(", ");
      toast.success(
        `${data.exatas} conta(s) vinculadas por classificação idêntica ` +
        `(essas não precisam de conferência). ` +
        `${data.por_grupo ?? 0} pelo GRUPO do arquivo` +
        (Number(data.realocadas) > 0
          ? `, ${data.realocadas} realocada(s) para o grupo certo` : "") +
        `. ${data.sugeridas} sugestão(ões)${regras ? ` (${regras})` : ""}. ` +
        (Number(data.zeradas_barradas) > 0
          ? `${data.zeradas_barradas} zerada(s) ficaram de fora. ` : "") +
        `${data.pendentes} conta(s) ainda sem vínculo.`,
        { duration: 14000 },
      );
      invalidar();
    } catch (e: any) { toast.error(e.message, { duration: 12000 }); }
    finally { setBusy(null); }
  };

  /**
   * Realocar por grupo — e conferir antes.
   *
   * "Custo do ECD tem que ir para custo do plano padrão, despesa
   * administrativa para despesa administrativa."
   *
   * A conferência vem primeiro de propósito: a lista diz, conta a conta,
   * onde ela está hoje e para onde vai. Quem decide aperta depois.
   */
  const realocarPorGrupo = async (soConferir: boolean) => {
    setBusy(soConferir ? "conferir-grupo" : "grupo");
    try {
      const { data, error } = await (supabase as any).rpc("ecd_alocar_por_grupo", {
        _importacao_id: atual.id, _so_conferir: soConferir,
      });
      if (error) throw new Error(error.message);
      const fora = (data.fora_do_grupo ?? []) as any[];

      if (soConferir) {
        if (fora.length === 0) {
          toast.success(
            `Nenhuma conta fora do grupo. ${data.ja_no_grupo} já estão certas` +
            (Number(data.sem_grupo) > 0
              ? `; ${data.sem_grupo} sem grupo reconhecido no arquivo` : "") + ".",
            { duration: 10000 });
        } else {
          setForaDoGrupo(fora);
          toast.warning(
            `${fora.length} conta(s) alocadas fora do grupo. Veja a lista abaixo.`,
            { duration: 10000 });
        }
        return;
      }

      setForaDoGrupo([]);
      toast.success(
        `${data.realocadas} conta(s) realocada(s) para o grupo certo; ` +
        `${data.novas} vínculo(s) novo(s); ${data.ja_no_grupo} já estavam certas. ` +
        (Number(data.manuais_preservados) > 0
          ? `${data.manuais_preservados} vínculo(s) seu(s) não foram tocados. ` : "") +
        (Number(data.sem_grupo) > 0
          ? `${data.sem_grupo} conta(s) sem grupo reconhecido no arquivo.` : ""),
        { duration: 14000 });
      invalidar();
    } catch (e: any) { toast.error(e.message, { duration: 12000 }); }
    finally { setBusy(null); }
  };

  const sugerir = async (refazer = false) => {
    if (refazer && !confirm(
      `Descartar ${automaticas ?? 0} sugestão(ões) automática(s) e calcular de novo?\n\n` +
      "O que você vinculou à mão, ignorou ou já conferiu NÃO é tocado.")) return;
    setBusy(refazer ? "refazer" : "sugerir");
    try {
      const { data, error } = await (supabase as any)
        .rpc("ecd_sugerir_depara", { _importacao_id: atual.id, _refazer: refazer });
      if (error) throw new Error(error.message);
      const regras = Object.entries(data.por_regra ?? {})
        .map(([k, v]) => `${v} por ${k}`).join(", ");
      toast.success(
        (Number(data.descartadas) > 0
          ? `${data.descartadas} sugestão(ões) antiga(s) descartada(s). `
          : "") +
        `${data.sugeridas} sugestão(ões)${regras ? ` (${regras})` : ""}. ` +
        // Uma conta barrada por estar zerada não some sem explicação: o
        // silêncio aqui é o mesmo defeito de antes com o sinal trocado.
        (Number(data.zeradas_barradas) > 0
          ? `${data.zeradas_barradas} conta(s) zerada(s) ficaram de fora ` +
            "(sem movimento e sem saldo, o nome sozinho não decide). "
          : "") +
        `${data.pendentes} conta(s) sem sugestão — resolva à mão abaixo.`,
        { duration: 12000 },
      );
      invalidar();
    } catch (e: any) { toast.error(e.message, { duration: 12000 }); }
    finally { setBusy(null); }
  };

  /**
   * Vincula, ignora ou LIMPA uma conta.
   *
   * Limpar não é gravar destino nulo: a tabela proíbe isso
   * (`CHECK (ignorada OR conta_padrao_codigo IS NOT NULL)`), e era por
   * aí que o botão "Limpar vínculo" falhava calado. Conta sem destino e
   * não ignorada é conta PENDENTE, e pendente é a ausência de linha —
   * quem apaga é a própria `aplicar_depara_em_lote`, que agora trata os
   * três casos, para a linha, o lote e o grupo seguirem a mesma regra.
   */
  const vincular = async (ecdCodigo: string, planoCodigo: string | null, ignorar = false) => {
    setBusy(ecdCodigo);
    try {
      const { error } = await (supabase as any).rpc("aplicar_depara_em_lote", {
        _company_id: companyId,
        _itens: [{
          conta_codigo: ecdCodigo,
          conta_padrao_codigo: ignorar ? null : planoCodigo,
          ignorada: ignorar,
          observacao: ignorar ? "ECD: ignorada" : "ECD: definido manualmente",
        }],
      });
      if (error) throw new Error(error.message);
      invalidar();
    } catch (e: any) { toast.error(e.message, { duration: 10000 }); }
    finally { setBusy(null); }
  };

  /**
   * Grava várias de uma vez, numa transação só.
   *
   * `aplicar_depara_em_lote` é a mesma função que o de-para do plano de
   * contas usa — ela não valida a origem contra o plano, então serve
   * igual para os códigos do ECD, que são de outro plano por definição.
   */
  const gravarLote = async (
    codigos: string[],
    destino: string | null,
    ignorar: boolean,
    rotulo: string,
  ) => {
    if (codigos.length === 0) return;
    setBusy("lote");
    try {
      const itens = codigos.map((c) => ({
        conta_codigo: c,
        conta_padrao_codigo: ignorar ? null : destino,
        ignorada: ignorar,
        observacao: `ECD: ${rotulo}`,
      }));
      const { data, error } = await (supabase as any).rpc("aplicar_depara_em_lote", {
        _company_id: companyId, _itens: itens,
      });
      if (error) throw new Error(error.message);
      const limpas = Number(data?.limpas ?? 0);
      toast.success(
        limpas > 0
          ? `${limpas} vínculo(s) removido(s) — essas contas voltaram para pendentes.`
          : `${data?.gravadas ?? codigos.length} conta(s) atualizada(s).`);
      setMarcadas(new Set());
      invalidar();
    } catch (e: any) { toast.error(e.message, { duration: 10000 }); }
    finally { setBusy(null); }
  };

  const aplicar = async (forcar = false) => {
    setBusy("aplicar");
    try {
      const { data, error } = await (supabase as any).rpc("ecd_aplicar", {
        _importacao_id: atual.id, _substituir: false, _forcar: forcar,
      });
      if (error) throw new Error(error.message);
      if (!data.ok) {
        toast.error(
          `${data.contas_sem_vinculo} conta(s) com movimento e sem vínculo. ` +
          "Vincule ou marque como ignorada antes de aplicar.",
          { duration: 12000 },
        );
        return;
      }
      // "0 linhas" com `ok: true` era indistinguível de sucesso. Agora a
      // resposta diz QUANTOS meses o diário já ocupava — que é o motivo
      // legítimo de não gravar nada — e quantas linhas velhas saíram
      // porque o vínculo mudou.
      const pulados = Number(data.meses_do_diario) || 0;
      const removidas = Number(data.linhas_removidas) || 0;
      const nada = Number(data.linhas_saldos) === 0 && removidas === 0;
      const msg =
        `${data.linhas_saldos} linha(s) de saldo e ${data.linhas_abertura} abertura(s) gravadas. ` +
        (removidas > 0 ? `${removidas} linha(s) antiga(s) removida(s). ` : "") +
        (pulados > 0
          ? `${pulados} mês(es) não foram tocados porque o diário já manda neles. `
          : "") +
        (nada && pulados === 0
          ? "Nada mudou — as contas vinculadas já estavam aplicadas com estes valores."
          : "O Balanço já mostra os períodos antigos.");
      if (nada && pulados > 0) toast.warning(msg, { duration: 12000 });
      else toast.success(msg, { duration: 10000 });
      invalidar();
    } catch (e: any) { toast.error(e.message, { duration: 12000 }); }
    finally { setBusy(null); }
  };

  /**
   * Baixa o que está GRAVADO deste ECD — a forma dos códigos, sem nome
   * de conta nenhum. Existe porque eu já deduzi duas vezes o formato do
   * arquivo pelo layout e pelo exemplo, e nas duas a classificação saiu
   * como o código reduzido. Com este JSON o arquivo responde, em vez de
   * eu adivinhar de novo.
   */
  const baixarDiagnostico = async () => {
    setBusy("diagnostico");
    try {
      const { data, error } = await (supabase as any)
        .rpc("ecd_diagnostico", { _importacao_id: atual.id, _limite: 60 });
      if (error) throw new Error(error.message);
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = "diagnostico-ecd.json"; a.click();
      URL.revokeObjectURL(url);
      toast.success("Baixado. Só a forma dos códigos — nenhum nome de conta vai no arquivo.");
    } catch (e: any) { toast.error(e.message); }
    finally { setBusy(null); }
  };

  const desfazer = async () => {
    if (!confirm(
      "Remover do sistema os saldos que vieram deste ECD?\n\n" +
      "O diário não é tocado — só os períodos que o ECD trouxe.")) return;
    setBusy("desfazer");
    try {
      const { data, error } = await (supabase as any)
        .rpc("ecd_desfazer", { _importacao_id: atual.id });
      if (error) throw new Error(error.message);
      toast.success(`${data.saldos_removidos} saldo(s) e ${data.aberturas_removidas} abertura(s) removidos.`);
      invalidar();
    } catch (e: any) { toast.error(e.message); }
    finally { setBusy(null); }
  };

  // ---------- derivados ----------
  interface LinhaEcd extends LinhaDepara {
    fim: number; origem: string; origemClassificacao: string | null;
    pai: string | null; nomePai: string | null;
  }

  const listaContas = useMemo<LinhaEcd[]>(() => {
    return (contas ?? []).map((c: any) => {
      const d = depara?.get(c.codigo);
      const obs = d?.observacao ?? "";
      return {
        codigo: c.codigo,
        descricao: c.descricao ?? "",
        // A classificação estrutural, QUANDO EXISTE. Num ECD que numera
        // as contas em sequência (119, 406, 748) ela é o próprio código
        // e a origem vem 'reduzido' — aí quem diz o galho é o caminho.
        classificacao: c.classificacao ?? null,
        origemClassificacao: c.classificacao_origem ?? null,
        caminho: c.caminho_nomes ?? null,
        caminhoCodigos: c.caminho_codigos ?? null,
        // Uma conta sem débito/crédito mas com saldo final ainda importa:
        // ela carrega abertura. Por isso o "movimento" aqui é o maior
        // dos dois — é o que decide urgência e o filtro "com movimento".
        movimento: Math.max(Math.abs(Number(c.mov) || 0), Math.abs(Number(c.fim) || 0)),
        destino: d?.conta_padrao_codigo ?? null,
        ignorada: !!d?.ignorada,
        // Sugestão automática ainda não revisada — a observação diz.
        sugerido: veioDeSugestaoAutomatica(obs),
        fim: Number(c.fim) || 0,
        origem: obs,
        pai: c.cod_superior ?? null,
        nomePai: c.nome_pai ?? null,
      };
    });
  }, [contas, depara]);

  const contagem = useMemo(() => contarEstados(listaContas), [listaContas]);
  const visiveis = useMemo(
    () => filtrarLinhas(listaContas, { estado: filtro, busca }),
    [listaContas, filtro, busca],
  );
  const naTela = visiveis.slice(0, limite);

  // ---------- o arquivo tem código estrutural? ----------
  // Esta é a pergunta que decide a tela inteira, e ela se responde com o
  // que o banco já carimbou em cada conta:
  //
  //   i052 / i051 / hierarquia → tem estrutural, agrupa por ela
  //   reduzido                 → não tem; o galho é o caminho de NOMES
  //
  // Antes eu deduzia "1.01.01" de uma cadeia de códigos reduzidos e
  // mostrava o resultado como se fosse a conta estrutural do plano. Não
  // era: era um texto que eu montava. Agora a tela diz qual é o caso.
  const forma = useMemo(() => {
    const origens = new Map<string, number>();
    for (const l of listaContas) {
      const o = l.origemClassificacao ?? "(nula)";
      origens.set(o, (origens.get(o) ?? 0) + 1);
    }
    const estruturais =
      (origens.get("i052") ?? 0) + (origens.get("i051") ?? 0) + (origens.get("hierarquia") ?? 0);
    return {
      temEstrutural: estruturais > 0,
      i052: origens.get("i052") ?? 0,
      i051: origens.get("i051") ?? 0,
      hierarquia: origens.get("hierarquia") ?? 0,
      reduzido: origens.get("reduzido") ?? 0,
    };
  }, [listaContas]);

  const niveis = useMemo(() => niveisDisponiveis(listaContas), [listaContas]);
  const niveisGalho = useMemo(() => niveisDoCaminho(listaContas), [listaContas]);
  const temPai = useMemo(() => listaContas.some((l) => !!l.pai), [listaContas]);

  // As opções do "Agrupar:" seguem o que o arquivo tem. Oferecer
  // "classificação · 3 níveis" para um ECD de código reduzido seria
  // oferecer um agrupamento que junta tudo num grupo só.
  const opcoesGrupo = useMemo(() => {
    const out: { valor: number; rotulo: string }[] = [];
    if (forma.temEstrutural && niveis > 1) {
      for (let n = 1; n <= Math.min(niveis, 6); n++) {
        out.push({ valor: n, rotulo: `classificação · ${n} ${n > 1 ? "níveis" : "nível"}` });
      }
    } else if (niveisGalho > 1) {
      for (let n = 1; n <= Math.min(niveisGalho, 6); n++) {
        out.push({ valor: n, rotulo: `galho do ECD · ${n} ${n > 1 ? "níveis" : "nível"}` });
      }
    }
    if (temPai) out.push({ valor: -1, rotulo: "conta superior do ECD" });
    return out;
  }, [forma.temEstrutural, niveis, niveisGalho, temPai]);

  // Agrupado: a janela conta LINHAS, não grupos — um galho de 300 contas
  // não pode entrar inteiro só porque é um grupo só.
  const grupos = useMemo(() => {
    if (nivelGrupo === 0) return null;
    // -1 é o agrupamento pela CONTA SUPERIOR do próprio ECD — o pai
    // direto, um degrau só.
    const todos = nivelGrupo < 0
      ? agruparPorChave(visiveis, (l) => l.pai ?? "",
          (k, l) => (k ? `${l.nomePai ? tituloConta(l.nomePai) + " · " : ""}${k}` : ""),
          (k) => k)
      : forma.temEstrutural
        ? agruparPorClassificacao(visiveis, nivelGrupo)
        : agruparPorCaminho(visiveis, nivelGrupo);
    const out: typeof todos = [];
    let n = 0;
    for (const g of todos) { if (n >= limite) break; out.push(g); n += g.linhas.length; }
    return { mostrando: out, total: todos.length, linhas: n };
  }, [visiveis, nivelGrupo, limite, forma.temEstrutural]);
  const sugestoesVisiveis = visiveis.filter((l) => estadoDe(l) === "sugerido").length;
  const pendentesComMov = contagem.pendenteComMovimento;

  const alternarMarcada = (codigo: string) =>
    setMarcadas((s) => {
      const n = new Set(s);
      if (n.has(codigo)) n.delete(codigo); else n.add(codigo);
      return n;
    });

  // A linha de uma conta do ECD. Vive fora do JSX porque é desenhada em
  // dois lugares: na lista simples e dentro de cada grupo.
  const linhaDaConta = (c: LinhaEcd) => {
    const estado = estadoDe(c);
    const marcada = marcadas.has(c.codigo);
    const galho = galhoDeCaminho(c.caminho);
    const destinoEscolhido = c.destino
      ? (destinos ?? []).find((d) => d.codigo === c.destino) ?? null
      : null;
    return (
      <tr key={c.codigo}
        className={`border-t first:border-t-0 ${
          marcada ? "bg-primary/5" :
          estado === "pendente" && c.movimento > 0 ? "bg-amber-500/5" : ""}`}>
        <td className="pl-3 py-2 w-[34px]">
          <Checkbox
            checked={marcada}
            onCheckedChange={() => alternarMarcada(c.codigo)}
            aria-label={`Selecionar ${c.codigo}`}
          />
        </td>
        <td className="px-3 py-2">
          <div className="font-medium">{tituloConta(c.descricao ?? "")}</div>
          {/* O galho: de onde a conta vem, sem repetir o nome dela. É o
              que a conta estrutural diria, quando o arquivo traz uma —
              e é o que sobra quando não traz. */}
          {galho && (
            <div className="text-[11px] text-muted-foreground/90 truncate max-w-[420px]"
                 title={galho}>
              {galho}
            </div>
          )}
          <div className="text-xs text-muted-foreground font-mono">
            {c.origemClassificacao === "reduzido" || !c.classificacao ? (
              // Sem estrutural no arquivo: mostra o que a conta REALMENTE
              // tem. Um "1.2" inventado aqui só atrapalharia a conferência.
              <span title="O I050 deste arquivo traz só o código reduzido — não há conta estrutural para mostrar">
                {c.codigo}
              </span>
            ) : (
              <>
                <span
                  className="text-foreground/70"
                  title={
                    c.origemClassificacao === "i052"
                      ? "Código de aglutinação do próprio ECD (registro I052)"
                      : c.origemClassificacao === "i051"
                        ? "Conta no plano referencial da Receita (registro I051)"
                        : c.origemClassificacao === "hierarquia"
                          ? "Reconstruído pela cadeia COD_CTA_SUP do I050, que usa código estrutural"
                          : "O próprio código da conta — o arquivo não permitiu deduzir mais"
                  }
                >
                  {c.classificacao}
                </span>
                {c.classificacao !== c.codigo && (
                  <span className="ml-1.5 opacity-60">reduzido {c.codigo}</span>
                )}
              </>
            )}
          </div>
        </td>
        <td className="px-3 py-2 text-right tabular-nums text-xs w-[130px]">
          <div>{brl(c.fim)}</div>
          <div className="text-muted-foreground">saldo final</div>
        </td>
        <td className="px-3 py-2 w-[330px]">
          {c.ignorada ? (
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground italic">
                não usada em demonstrações
              </span>
              <Button size="sm" variant="ghost" className="h-6 text-xs"
                disabled={busy !== null}
                onClick={() => vincular(c.codigo, null, false)}>
                reativar
              </Button>
            </div>
          ) : (
            <div className="space-y-0.5">
              <SeletorConta
                destinos={destinos ?? []}
                carregando={carregandoDestinos}
                valor={c.destino}
                onEscolher={(cod) => vincular(c.codigo, cod)}
                onIgnorar={() => vincular(c.codigo, null, true)}
                permitirIgnorar
                disabled={busy !== null}
                compacto
                className="w-full"
                placeholder="Escolher conta do plano…"
              />
              {/* Para onde ESTA conta vai na demonstração. O seletor
                  mostra o galho na hora de escolher; aqui ele fica à
                  vista depois, que é quando dá para perceber que a
                  alocação ficou no grupo errado. */}
              {destinoEscolhido?.galho && (
                <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground truncate">
                  <span className="truncate" title={destinoEscolhido.galho}>
                    {destinoEscolhido.galho}
                  </span>
                  {destinoEscolhido.dfc && (
                    <span className="shrink-0 rounded bg-sky-500/10 px-1 text-sky-700 dark:text-sky-300"
                          title={`Na DFC entra como ${destinoEscolhido.dfcDescricao ?? destinoEscolhido.dfc}`}>
                      DFC {destinoEscolhido.dfc}
                    </span>
                  )}
                </div>
              )}
              {c.origem && (
                <div className="text-[10px] text-muted-foreground truncate">
                  {estado === "sugerido" ? "⚡ " : ""}{c.origem}
                </div>
              )}
            </div>
          )}
        </td>
      </tr>
    );
  };

  const alternarGrupo = (codigos: string[]) =>
    setMarcadas((s) => {
      const n = new Set(s);
      const todasMarcadas = codigos.every((c) => n.has(c));
      for (const c of codigos) { if (todasMarcadas) n.delete(c); else n.add(c); }
      return n;
    });
  const virada = conferencia?.virada ?? null;
  // "0 diferem" com 0 comparáveis não é sucesso, é ausência de conferência.
  const viradaOk = virada && !virada.sem_referencia &&
    Number(virada.diferem) === 0 && Number(virada.em_ambos) > 0;

  return (
    <div className="space-y-4">
      <Card className="p-4 border-primary/20 bg-primary/5 text-sm">
        <div className="flex items-start gap-3">
          <Upload className="h-4 w-4 text-primary mt-0.5 shrink-0" />
          <div>
            <div className="font-medium">Períodos anteriores ao diário, via ECD</div>
            <p className="text-muted-foreground text-xs mt-0.5 leading-relaxed">
              O arquivo entra em <strong>espera</strong>, você confere o vínculo de cada conta com o
              plano, e só então vira saldo. A conferência que vale é a <strong>virada</strong>: o
              saldo final do ECD tem que bater com a abertura que o diário já deixou no sistema —
              são dois documentos independentes concordando.
            </p>
          </div>
        </div>
      </Card>

      <div className="flex items-center gap-2 flex-wrap">
        <input ref={inputRef} type="file" accept=".txt,.ecd" className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) importar(f); }} />
        <input ref={refRef} type="file" accept=".txt,.ecd" className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) relerCodigos(f);
            // Sem isto, escolher o MESMO arquivo de novo não dispara
            // evento nenhum e o botão parece quebrado.
            e.target.value = "";
          }} />
        <Button size="sm" disabled={busy !== null} onClick={() => inputRef.current?.click()}>
          {busy === "importar" ? <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                               : <Upload className="h-4 w-4 mr-2" />}
          Carregar arquivo ECD
        </Button>
        {(importacoes ?? []).length > 1 && (
          <select className="h-9 rounded-md border bg-background px-2 text-sm"
            value={atual?.id ?? ""} onChange={(e) => setSelecionada(e.target.value)}>
            {(importacoes ?? []).map((i) => (
              <option key={i.id} value={i.id}>
                {i.arquivo_nome} — {i.status}
              </option>
            ))}
          </select>
        )}
      </div>

      {isLoading && <div className="text-sm text-muted-foreground">Carregando…</div>}

      {!isLoading && !atual && (
        <Card className="p-8 text-center text-sm text-muted-foreground">
          Nenhum ECD carregado ainda para esta empresa.
        </Card>
      )}

      {atual && (
        <>
          <Card className="p-4 text-sm">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div>
                <div className="font-medium">{atual.arquivo_nome}</div>
                <div className="text-xs text-muted-foreground mt-0.5">
                  {atual.razao_social ?? "—"} · {mes(atual.periodo_inicio)} a {mes(atual.periodo_fim)} ·{" "}
                  {atual.resumo?.contas ?? 0} contas · {atual.resumo?.meses ?? 0} mês(es)
                </div>
              </div>
              <Badge variant="outline"
                className={atual.status === "aplicado"
                  ? "text-emerald-600 border-emerald-600/40"
                  : "text-amber-600 border-amber-600/40"}>
                {atual.status === "aplicado" ? "aplicado" : "em espera"}
              </Badge>
            </div>
          </Card>

          {/* ---------- conferência ---------- */}
          {virada && (
            <Card className={`p-4 text-sm ${viradaOk ? "border-emerald-600/30 bg-emerald-600/5"
                                                     : "border-amber-500/40 bg-amber-500/5"}`}>
              <div className="flex items-start gap-3">
                {viradaOk ? <CheckCircle2 className="h-4 w-4 text-emerald-600 mt-0.5 shrink-0" />
                          : <AlertTriangle className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" />}
                <div className="min-w-0">
                  <div className="font-medium">
                    {virada.sem_referencia
                      ? "Não há abertura no sistema para comparar"
                      : viradaOk
                        ? "A virada bate com o saldo que já estava no sistema"
                        : "A virada ainda não fecha"}
                  </div>
                  {/* Sem dizer QUAIS datas estão sendo comparadas, "não
                      fecha" não ajuda ninguém — pode ser de-para errado
                      ou simplesmente a data errada. */}
                  <div className="text-[11px] text-muted-foreground mt-0.5">
                    Fechamento do ECD em{" "}
                    <strong>{dia(virada.data_virada)}</strong>
                    {virada.sem_referencia ? (
                      <> · nenhuma abertura no sistema nessa data ou depois dela.
                        O ECD cobre um período à frente do que o diário já tem —
                        não é erro de vínculo.</>
                    ) : (
                      <> × abertura do sistema em <strong>{dia(virada.data_abertura)}</strong></>
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground mt-1">
                    {virada.em_ambos} conta(s) comparáveis · {virada.batem} batem ·{" "}
                    {virada.diferem} diferem · diferença {brl(virada.diferenca_total)}
                    {Number(virada.so_no_ecd) > 0 && ` · ${virada.so_no_ecd} só no ECD`}
                    {Number(virada.so_no_sistema) > 0 && ` · ${virada.so_no_sistema} só no sistema`}
                  </div>
                  {(virada.exemplos ?? []).length > 0 && (
                    <div className="mt-2 text-xs font-mono space-y-0.5">
                      {(virada.exemplos ?? []).slice(0, 5).map((x: any, i: number) => (
                        <div key={i}>
                          {x.conta}: ECD {brl(x.ecd)} × sistema {brl(x.sistema)}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </Card>
          )}

          {/* ---------- natureza trocada: o alarme que faltava ---------- */}
          {(natureza?.length ?? 0) > 0 && (
            <Card className="p-3 text-sm border-red-500/50 bg-red-500/5">
              <div className="flex items-start gap-3">
                <XCircle className="h-4 w-4 text-red-600 mt-0.5 shrink-0" />
                <div className="min-w-0 w-full">
                  <div className="font-medium">
                    {natureza!.length} conta(s) apontam para um grupo de
                    NATUREZA diferente da que o arquivo declara
                  </div>
                  <div className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
                    O registro I050 obriga cada conta a dizer o que ela é: ativo, passivo,
                    patrimônio líquido ou resultado. Quando o destino tem outra natureza, uma
                    das duas está errada — sempre. É o único erro de alocação que dá para
                    afirmar sem julgar: passivo virando despesa muda o lucro.
                  </div>
                  <div className="mt-2 max-h-64 overflow-auto text-xs font-mono space-y-1">
                    {natureza!.map((n: any, i: number) => (
                      <div key={i} className="grid grid-cols-[1fr_auto] gap-3 border-b border-border/40 pb-1">
                        <div className="min-w-0">
                          <div className="truncate">
                            {n.conta_codigo} · {n.conta_nome}
                            <span className="text-muted-foreground"> ({n.natureza_nome})</span>
                          </div>
                          <div className="text-muted-foreground truncate">
                            → {n.destino_cls} {n.destino_nome} ({n.destino_tipo})
                            {n.observacao ? ` · ${n.observacao}` : ""}
                          </div>
                        </div>
                        <div className={`text-right whitespace-nowrap ${
                          Math.abs(Number(n.movimento) || 0) > 0 ? "text-red-600 font-medium" : ""}`}>
                          {brl(Number(n.movimento) || 0)}
                        </div>
                      </div>
                    ))}
                  </div>
                  <div className="text-xs text-muted-foreground mt-2">
                    O valor é o movimento do ano no arquivo. Corrija o destino na fila abaixo —
                    a busca já traz o galho de cada conta.
                  </div>
                </div>
              </div>
            </Card>
          )}

          {/* ---------- o diário deste ECD ---------- */}
          {/* Sem este cartão, "o drill-down só mostra o total do mês" não
              tinha como ser diagnosticado: o painel dizia contas e meses,
              e o número que decide é este. */}
          {diario && (
            <Card className={`p-3 text-sm ${
              Number(diario.lidos) > 0
                ? "border-emerald-500/40 bg-emerald-500/5"
                : "border-amber-500/40 bg-amber-500/5"}`}>
              <div className="flex items-start gap-3">
                {Number(diario.lidos) > 0
                  ? <CheckCircle2 className="h-4 w-4 text-emerald-600 mt-0.5 shrink-0" />
                  : <AlertTriangle className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" />}
                <div className="min-w-0">
                  <div className="font-medium">
                    {Number(diario.lidos) > 0
                      ? `Diário lido: ${Number(diario.lidos).toLocaleString("pt-BR")} partida(s) ` +
                        `em ${Number(diario.contas_com_partida).toLocaleString("pt-BR")} conta(s)`
                      : "O diário deste ECD não foi lido"}
                  </div>
                  <div className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
                    {Number(diario.lidos) > 0 ? (
                      Number(diario.materializados) > 0
                        ? <>{Number(diario.materializados).toLocaleString("pt-BR")} já no
                            drill-down. Abrindo uma linha da DRE ou da DFC você vê o
                            lançamento, com data e histórico.</>
                        : <>As partidas estão lidas mas ainda não chegaram ao drill-down —
                            aperte <strong>Aplicar</strong> (ou <strong>Reler o arquivo</strong>,
                            que faz os dois).</>
                    ) : (
                      <>É por isso que o drill-down mostra só
                        &quot;Movimento do mês&quot;: sem partida gravada não há o que abrir.
                        Aperte <strong>Reler o arquivo (códigos e diário)</strong> e escolha o
                        mesmo .txt — não toca em saldo nenhum. Se depois disso continuar em
                        zero, o arquivo realmente não traz os registros I200/I250.</>
                    )}
                  </div>
                </div>
              </div>
            </Card>
          )}

          {/* ---------- contas fora do grupo ---------- */}
          {foraDoGrupo.length > 0 && (
            <Card className="p-3 text-sm border-amber-500/40 bg-amber-500/5">
              <div className="flex items-start justify-between gap-3">
                <div className="font-medium">
                  {foraDoGrupo.length} conta(s) alocadas fora do grupo delas
                </div>
                <Button size="sm" variant="ghost" className="text-xs h-6"
                  onClick={() => setForaDoGrupo([])}>fechar</Button>
              </div>
              <div className="text-xs text-muted-foreground mt-1">
                O grupo sai do próprio arquivo: a natureza da conta no I050 e o galho em
                que ela está. &quot;Realocar por grupo&quot; move as que o sistema alocou;
                o que você vinculou à mão fica como está.
              </div>
              <div className="mt-2 max-h-72 overflow-auto text-xs font-mono space-y-1">
                {foraDoGrupo.slice(0, 200).map((f: any, i: number) => (
                  <div key={i} className="grid grid-cols-[1fr_auto] gap-2 border-b border-border/40 pb-1">
                    <div className="min-w-0">
                      <div className="truncate">{f.conta} · {f.nome}</div>
                      <div className="text-muted-foreground truncate">
                        hoje em {f.hoje_em ?? "?"} → grupo {f.grupo} ({f.grupo_nome})
                      </div>
                    </div>
                    <div className="text-right whitespace-nowrap">
                      {f.passa_a_ser
                        ? <span className="text-emerald-600">→ {f.passa_a_ser}</span>
                        : <span className="text-muted-foreground">sem folha no grupo</span>}
                    </div>
                  </div>
                ))}
                {foraDoGrupo.length > 200 && (
                  <div className="text-muted-foreground pt-1">
                    …e mais {foraDoGrupo.length - 200}.
                  </div>
                )}
              </div>
            </Card>
          )}

          {/* ---------- ações ---------- */}
          <div className="flex items-center gap-2 flex-wrap">
            {/* O botão principal. "Sugerir" continua existindo para quem
                quiser só a parte que precisa de conferência. */}
            <Button size="sm" disabled={busy !== null}
              onClick={() => alocarAutomatico(false)}
              title="Vincula por classificação idêntica (exato) e sugere o resto">
              {busy === "auto" ? <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                               : <Wand2 className="h-4 w-4 mr-2" />}
              Alocar automaticamente
            </Button>
            <Button size="sm" variant="outline" disabled={busy !== null}
              onClick={() => realocarPorGrupo(true)}
              title="Lista as contas que estão alocadas fora do grupo delas (custo em despesa, por exemplo). Não grava nada.">
              {busy === "conferir-grupo" ? <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                                         : <Search className="h-4 w-4 mr-2" />}
              Conferir grupos
            </Button>
            <Button size="sm" variant="outline" disabled={busy !== null}
              onClick={() => realocarPorGrupo(false)}
              title="Move cada conta para o grupo correspondente do plano padrão: custo para custo, despesa administrativa para despesa administrativa. O que você vinculou à mão não é tocado.">
              {busy === "grupo" ? <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                                : <FolderTree className="h-4 w-4 mr-2" />}
              Realocar por grupo
            </Button>
            <Button size="sm" variant="outline" disabled={busy !== null}
              onClick={() => sugerir(false)}>
              {busy === "sugerir" ? <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                                  : <Wand2 className="h-4 w-4 mr-2" />}
              Só sugerir
            </Button>
            {(automaticas ?? 0) > 0 && (
              <Button size="sm" variant="outline" disabled={busy !== null}
                onClick={() => alocarAutomatico(true)}
                title="Joga fora o que o sistema alocou sozinho e calcula de novo. O que você decidiu à mão fica.">
                {busy === "refazer" ? <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                                    : <Undo2 className="h-4 w-4 mr-2" />}
                Refazer as {automaticas} sugestão(ões)
              </Button>
            )}
            {atual.status !== "aplicado" ? (
              <Button size="sm" disabled={busy !== null || pendentesComMov > 0}
                title={pendentesComMov > 0
                  ? `${pendentesComMov} conta(s) com movimento ainda sem vínculo`
                  : "Materializa os saldos no sistema"}
                onClick={() => aplicar(false)}>
                {busy === "aplicar" && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Aplicar ao sistema
              </Button>
            ) : (
              <Button size="sm" variant="outline" disabled={busy !== null} onClick={desfazer}>
                {busy === "desfazer" ? <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                                     : <Undo2 className="h-4 w-4 mr-2" />}
                Desfazer
              </Button>
            )}
            <Button size="sm" variant="ghost" className="text-xs"
              disabled={busy !== null} onClick={baixarDiagnostico}
              title="Baixa a forma dos códigos deste ECD (sem nomes de conta) para diagnóstico">
              {busy === "diagnostico" && <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />}
              Baixar diagnóstico
            </Button>
            <Button size="sm" variant="ghost" className="text-xs"
              disabled={busy !== null} onClick={() => refRef.current?.click()}
              title="Lê de novo o arquivo: os códigos estruturais (I051/I052) e o DIÁRIO (I200/I250), que é o que faz o drill-down abrir. Não toca em saldo.">
              {busy === "reler" ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                                : <RefreshCw className="h-3.5 w-3.5 mr-1.5" />}
              Reler o arquivo (códigos e diário)
            </Button>
            {pendentesComMov > 0 && (
              <span className="text-xs text-amber-600">
                {pendentesComMov} conta(s) com movimento sem vínculo
              </span>
            )}
          </div>

          {/* ---------- de-para editável ---------- */}
          <div>
            <div className="flex items-center justify-between mb-2 gap-2 flex-wrap">
              <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Vínculo das contas ({listaContas.length})
              </h3>
              {marcadas.size === 0 && contagem.pendenteComMovimento > 0 && (
                <span className="text-[11px] text-muted-foreground">
                  Comece pelas pendentes com movimento — são as que travam o "aplicar".
                </span>
              )}
            </div>

            {/* O que ESTE arquivo traz, dito antes de você procurar. A
                conta estrutural aparece quando existe; quando não existe,
                a tela diz que não existe em vez de inventar uma. */}
            {/* O caso em que o número sai estranho e NÃO é alocação
                errada: o ECD traz o encerramento do exercício. */}
            {encerramento?.tem_encerramento && (
              <Card className="p-3 mb-2 border-amber-500/40 bg-amber-500/5 text-[11px] leading-relaxed">
                <div className="flex gap-2">
                  <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
                  <div>
                    <strong>Este ECD traz o encerramento do exercício.</strong>{" "}
                    Em{" "}
                    {(encerramento.meses ?? []).map((m: any) => mes(m.competencia)).join(", ")}
                    {" "}o sistema contábil zerou{" "}
                    {(encerramento.meses ?? [])[0]?.contas_zeradas} conta(s) de resultado,
                    transferindo o acumulado para o PL. Esse lançamento está no I155 como
                    movimento, então <strong>a DRE desse mês sai com o negativo do acumulado</strong>{" "}
                    e a DRE do ano soma perto de zero. Não é a sua alocação — é o encerramento.
                    <div className="mt-1 text-muted-foreground">
                      {encerramento.corrigido_automaticamente ? (
                        <>
                          <strong className="text-emerald-700 dark:text-emerald-400">
                            Isto já está corrigido.
                          </strong>{" "}
                          O diário do arquivo (I200/I250) foi lido e o lançamento de
                          encerramento está identificado pelo histórico — o motor o desconta
                          antes de montar a DRE. O número que você vê já é o do exercício.
                        </>
                      ) : encerramento.tem_lancamentos ? (
                        <>
                          O diário foi lido, mas nenhum lançamento tem o histórico de
                          transferência para resultado. Se a DRE do mês parecer o negativo do
                          acumulado, é isto — me diga qual é o histórico que o seu sistema usa.
                        </>
                      ) : (
                        <>
                          Este arquivo não trouxe o diário (I200/I250), então não dá para
                          separar o encerramento do movimento genuíno do mês — só com saldos as
                          duas incógnitas satisfazem a mesma equação. Use{" "}
                          <strong>Reler o arquivo (códigos e diário)</strong> para trazer o diário: com
                          ele, a correção passa a ser automática.
                        </>
                      )}
                    </div>
                  </div>
                </div>
              </Card>
            )}

            {listaContas.length > 0 && (
              <div className="text-[11px] text-muted-foreground mb-2 leading-relaxed">
                {forma.temEstrutural ? (
                  <>
                    Conta estrutural disponível
                    {forma.i052 > 0 && ` — ${forma.i052} do registro I052 (aglutinação)`}
                    {forma.i051 > 0 && ` — ${forma.i051} do registro I051 (referencial da Receita)`}
                    {forma.hierarquia > 0 && ` — ${forma.hierarquia} pela cadeia do I050`}.
                  </>
                ) : (
                  <>
                    {/* Cuidado com a redação: o que o sistema sabe é que
                        ESTA IMPORTAÇÃO não tem os códigos — não que o
                        ARQUIVO não os tenha. Os dois são coisas
                        diferentes, e confundi-los foi o erro que me fez
                        dizer três vezes que o ECD do Georg não trazia
                        I051 quando ele traz em toda linha. */}
                    <span className="text-amber-600">
                      Esta importação está sem os códigos do plano (I051/I052).
                    </span>{" "}
                    O I050 traz só o código reduzido ({listaContas[0]?.codigo},{" "}
                    {listaContas[1]?.codigo ?? "…"}), então por enquanto o que identifica a conta
                    é o galho por nome. Se o arquivo tiver I051 ou I052 — a maioria tem —{" "}
                    <button type="button" className="underline hover:text-foreground"
                      disabled={busy !== null}
                      onClick={() => refRef.current?.click()}>
                      releia os códigos do arquivo
                    </button>{" "}
                    e a conta estrutural aparece. Nenhum saldo é tocado.
                  </>
                )}
              </div>
            )}

            <BarraDepara
              contagem={contagem}
              estado={filtro}
              onEstado={(e) => { setFiltro(e); setLimite(150); }}
              busca={busca}
              onBusca={(b) => { setBusca(b); setLimite(150); }}
              visiveis={visiveis.length}
              selecionadas={marcadas}
              onSelecionarVisiveis={() => setMarcadas(new Set(visiveis.map((l) => l.codigo)))}
              onLimparSelecao={() => setMarcadas(new Set())}
              destinos={destinos ?? []}
              onVincularLote={(codigo) =>
                gravarLote([...marcadas], codigo, false, "vínculo em lote")}
              onIgnorarLote={() =>
                gravarLote([...marcadas], null, true, "ignorada em lote")}
              onLimparLote={() =>
                gravarLote([...marcadas], null, false, "vínculo removido")}
              nivelGrupo={nivelGrupo}
              onNivelGrupo={(n) => { setNivelGrupo(n); setLimite(150); }}
              opcoesGrupo={opcoesGrupo}
              sugestoesVisiveis={sugestoesVisiveis}
              onAceitarSugestoes={() => {
                // Confirmar é reescrever a MESMA conta trocando a
                // observação: o vínculo não muda, o estado sim — sai de
                // "sugerida" e passa a valer como revisada por você.
                const sug = visiveis.filter((l) => estadoDe(l) === "sugerido");
                if (sug.length === 0) return;
                setBusy("lote");
                (async () => {
                  try {
                    const itens = sug.map((l) => ({
                      conta_codigo: l.codigo,
                      conta_padrao_codigo: l.destino,
                      ignorada: false,
                      observacao: "ECD: sugestão conferida",
                    }));
                    const { error } = await (supabase as any).rpc("aplicar_depara_em_lote", {
                      _company_id: companyId, _itens: itens,
                    });
                    if (error) throw new Error(error.message);
                    toast.success(`${sug.length} sugestão(ões) conferida(s).`);
                    invalidar();
                  } catch (e: any) { toast.error(e.message); }
                  finally { setBusy(null); }
                })();
              }}
              disabled={busy !== null}
            />

            <Card className="overflow-hidden mt-2">
              <table className="w-full text-sm">
                <tbody>
                  {grupos
                    ? grupos.mostrando.map((g) => (
                        <Fragment key={g.prefixo || "(sem)"}>
                          <CabecalhoGrupo
                            prefixo={g.prefixo}
                            quantidade={g.linhas.length}
                            pendentes={g.pendentes}
                            movimento={g.movimento}
                            marcado={g.linhas.every((l) => marcadas.has(l.codigo))}
                            onAlternar={() => alternarGrupo(g.linhas.map((l) => l.codigo))}
                            destinos={destinos ?? []}
                            carregandoDestinos={carregandoDestinos}
                            onVincularGrupo={(cod) =>
                              gravarLote(g.linhas.map((l) => l.codigo), cod, false,
                                `grupo ${g.prefixo}`)}
                            onIgnorarGrupo={() =>
                              gravarLote(g.linhas.map((l) => l.codigo), null, true,
                                `grupo ${g.prefixo} ignorado`)}
                            disabled={busy !== null}
                            colSpan={3}
                          />
                          {g.linhas.map(linhaDaConta)}
                        </Fragment>
                      ))
                    : naTela.map(linhaDaConta)}
                  {naTela.length === 0 && (
                    <tr>
                      <td colSpan={4} className="px-3 py-8 text-center text-sm text-muted-foreground">
                        Nenhuma conta neste filtro.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
              {visiveis.length > naTela.length && (
                <button type="button"
                  className="w-full border-t py-2 text-xs text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
                  onClick={() => setLimite((l) => l + 300)}>
                  Mostrar mais {Math.min(300, visiveis.length - naTela.length)} de{" "}
                  {visiveis.length - naTela.length} restantes
                </button>
              )}
            </Card>
          </div>

          {/* ---------- períodos ---------- */}
          {(conferencia?.periodos ?? []).length > 0 && (
            <div>
              <h3 className="text-xs font-medium mb-2 text-muted-foreground uppercase tracking-wider">
                Períodos no arquivo
              </h3>
              <Card className="overflow-hidden">
                <table className="w-full text-sm">
                  <tbody>
                    {(conferencia.periodos ?? []).map((p: any) => (
                      <tr key={p.competencia} className="border-t first:border-t-0">
                        <td className="px-3 py-1.5">{mes(p.competencia)}</td>
                        <td className="px-3 py-1.5 text-xs text-muted-foreground">
                          {p.vinculadas} de {p.contas} contas vinculadas
                          {p.ignoradas > 0 && ` · ${p.ignoradas} ignoradas`}
                        </td>
                        <td className="px-3 py-1.5 text-right tabular-nums text-xs">
                          D {brl(p.debitos)} · C {brl(p.creditos)}
                        </td>
                        <td className="px-3 py-1.5 text-right w-[170px]">
                          {Number(p.movimento_sem_vinculo) > 0 ? (
                            <span className="text-xs text-amber-600 flex items-center justify-end gap-1">
                              <XCircle className="h-3 w-3" /> {brl(p.movimento_sem_vinculo)} sem vínculo
                            </span>
                          ) : (
                            <span className="text-xs text-emerald-600 flex items-center justify-end gap-1">
                              <CheckCircle2 className="h-3 w-3" /> tudo vinculado
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Card>
            </div>
          )}
        </>
      )}
    </div>
  );
}
