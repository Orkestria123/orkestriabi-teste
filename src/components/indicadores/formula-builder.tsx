// Construtor visual de expressão para indicadores.
// Cada TERMO pode ter uma das origens:
//   • "conta"        → 1..N contas do plano (com sinais internos +/−)
//   • "demonstracao" → uma linha de demonstração pronta (Receita Líquida, Ativo Total, …)
// Ambos os tipos convivem na mesma expressão.

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { X, Plus, ChevronDown } from "lucide-react";
import { ContaPicker, idConta, type ContaPlanoItem } from "./conta-picker";
import { type Token, validarExpressao } from "@/lib/indicadores/engine";
import { LINHAS_CATALOGO, labelLinha } from "@/lib/indicadores/linhas";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

interface Props {
  plano: ContaPlanoItem[];
  tokens: Token[];
  onChange: (next: Token[]) => void;
  allowAnaliticas?: boolean;
  ocultarLinhas?: string[];
}

const OP_LABEL: Record<string, string> = { "+": "+", "-": "−", "*": "×", "/": "÷" };

export function FormulaBuilder({ plano, tokens, onChange, allowAnaliticas = false, ocultarLinhas = [] }: Props) {
  const labelPorClass = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of plano) {
      const rotulo = p.descricao;
      m.set(idConta(p), rotulo);
      if (p.codigo) m.set(p.codigo, rotulo);
    }
    return m;
  }, [plano]);

  const contaPorId = useMemo(() => {
    const m = new Map<string, ContaPlanoItem>();
    for (const p of plano) {
      m.set(idConta(p), p);
      if (p.codigo) m.set(p.codigo, p);
      if (!m.has(p.classificacao)) m.set(p.classificacao, p);
    }
    return m;
  }, [plano]);

  const erros = useMemo(() => validarExpressao(tokens), [tokens]);

  const patch = (i: number, next: Token) => {
    const copy = tokens.slice();
    copy[i] = next;
    onChange(copy);
  };
  const remover = (i: number) => onChange(tokens.filter((_, idx) => idx !== i));
  const inserir = (t: Token) => onChange([...tokens, t]);

  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-border p-3 bg-muted/20 min-h-[80px]">
        {tokens.length === 0 && (
          <div className="text-xs text-muted-foreground italic">
            Nenhum token ainda. Use os botões abaixo para adicionar termos, operadores e parênteses.
          </div>
        )}
        <div className="flex flex-wrap gap-2 items-center">
          {tokens.map((t, i) => (
            <TokenChip
              key={i}
              token={t}
              plano={plano}
              labelPorClass={labelPorClass}
              contaPorId={contaPorId}
              allowAnaliticas={allowAnaliticas}
              ocultarLinhas={ocultarLinhas}
              onChange={(nx) => patch(i, nx)}
              onRemove={() => remover(i)}
            />
          ))}
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          variant="outline"
          onClick={() =>
            inserir({ tipo: "termo", origem: "demonstracao", linha: "" })
          }
          title="Adiciona uma linha pronta da DRE/Balanço (ex.: Receita Líquida, Ativo Total)"
        >
          <Plus className="h-3 w-3 mr-1" /> Linha da Demonstração
        </Button>
        {!ocultarLinhas.includes("EBIT") && (
        <Button
          size="sm"
          variant="outline"
          onClick={() =>
            inserir({ tipo: "termo", origem: "demonstracao", linha: "EBIT" })
          }
          title="Mesmo valor do indicador Ebit, exibido na DRE"
        >
          <Plus className="h-3 w-3 mr-1" /> EBIT (DRE)
        </Button>
        )}
        {!ocultarLinhas.includes("EBITDA") && (
        <Button
          size="sm"
          variant="outline"
          onClick={() =>
            inserir({ tipo: "termo", origem: "demonstracao", linha: "EBITDA" })
          }
          title="Mesmo valor do indicador Ebitda, exibido na DRE"
        >
          <Plus className="h-3 w-3 mr-1" /> EBITDA (DRE)
        </Button>
        )}
        <Button
          size="sm"
          variant="outline"
          onClick={() =>
            inserir({ tipo: "termo", origem: "conta", contas: [], sinais: [] })
          }
          title="Adiciona uma ou mais contas específicas do plano"
        >
          <Plus className="h-3 w-3 mr-1" /> Conta do Plano
        </Button>
        {(["+", "-", "*", "/"] as const).map((op) => (
          <Button
            key={op}
            size="sm"
            variant="outline"
            onClick={() => inserir({ tipo: "operador", valor: op })}
            className="w-9 font-mono"
          >
            {OP_LABEL[op]}
          </Button>
        ))}
        <Button
          size="sm"
          variant="outline"
          onClick={() => inserir({ tipo: "parentese", valor: "(" })}
        >
          (
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => inserir({ tipo: "parentese", valor: ")" })}
        >
          )
        </Button>
      </div>

      {erros.length > 0 && (
        <ul className="text-xs text-destructive space-y-0.5">
          {erros.map((e, i) => (
            <li key={i}>• {e}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ------------------------------------------------------------
// Renderização de um token individual
// ------------------------------------------------------------

function TokenChip({
  token,
  plano,
  labelPorClass,
  contaPorId,
  allowAnaliticas,
  ocultarLinhas,
  onChange,
  onRemove,
}: {
  token: Token;
  plano: ContaPlanoItem[];
  labelPorClass: Map<string, string>;
  contaPorId: Map<string, ContaPlanoItem>;
  allowAnaliticas: boolean;
  ocultarLinhas: string[];
  onChange: (t: Token) => void;
  onRemove: () => void;
}) {
  if (token.tipo === "parentese") {
    return (
      <div className="inline-flex items-center gap-1 border border-border rounded-md bg-background px-2 py-1 text-sm font-mono">
        <span>{token.valor}</span>
        <button onClick={onRemove} className="text-muted-foreground hover:text-destructive">
          <X className="h-3 w-3" />
        </button>
      </div>
    );
  }

  if (token.tipo === "operador") {
    return (
      <div className="inline-flex items-center gap-1 border border-border rounded-md bg-background px-2 py-1 text-sm font-mono">
        <span>{OP_LABEL[token.valor] ?? token.valor}</span>
        <button onClick={onRemove} className="text-muted-foreground hover:text-destructive">
          <X className="h-3 w-3" />
        </button>
      </div>
    );
  }

  if (token.tipo === "constante") {
    return (
      <div className="inline-flex items-center gap-1 border border-border rounded-md bg-background px-2 py-1 text-sm">
        <span>{token.valor}</span>
        <button onClick={onRemove} className="text-muted-foreground hover:text-destructive">
          <X className="h-3 w-3" />
        </button>
      </div>
    );
  }

  // termo
  const origem = token.origem ?? "conta";

  if (origem === "demonstracao") {
    return (
      <div
        className={cn(
          "inline-flex flex-col gap-1 border rounded-md bg-blue-500/5 border-blue-500/40 px-2 py-1.5",
          !token.linha && "border-destructive/50 bg-destructive/5",
        )}
      >
        <div className="flex items-center gap-1">
          <Badge variant="outline" className="text-[9px] border-blue-500/40 text-blue-700 dark:text-blue-400">
            LINHA
          </Badge>
          <LinhaPicker
            valor={token.linha ?? ""}
            onChange={(k) => onChange({ ...token, linha: k })}
            ocultar={ocultarLinhas}
          />
          <button onClick={onRemove} className="text-muted-foreground hover:text-destructive ml-auto">
            <X className="h-3 w-3" />
          </button>
        </div>
        {token.linha ? (
          <span className="text-[11px] text-muted-foreground">{labelLinha(token.linha)}</span>
        ) : (
          <span className="text-[11px] text-destructive">Escolha a linha</span>
        )}
      </div>
    );
  }

  // origem "conta"
  const contas = token.contas ?? [];
  const sinais = token.sinais ?? [];
  const toggleSinal = (i: number) => {
    const arr = contas.map((_, idx) => (idx === i ? (sinais[idx] === "-" ? "+" : "-") : sinais[idx] ?? "+")) as ("+" | "-")[];
    onChange({ ...token, sinais: arr });
  };
  const removeConta = (i: number) => {
    onChange({
      ...token,
      contas: contas.filter((_, idx) => idx !== i),
      sinais: sinais.filter((_, idx) => idx !== i),
    });
  };
  const adicionarContas = (novas: string[]) => {
    const setAtual = new Set(contas);
    const setNovas = new Set(novas);
    const contasFinal = [...contas];
    const sinaisFinal = [...sinais];
    for (const c of novas) {
      if (!setAtual.has(c)) {
        contasFinal.push(c);
        sinaisFinal.push("+");
      }
    }
    const removidas = new Set<string>();
    for (const c of contas) if (!setNovas.has(c)) removidas.add(c);
    const finalContas: string[] = [];
    const finalSinais: ("+" | "-")[] = [];
    for (let i = 0; i < contasFinal.length; i++) {
      if (removidas.has(contasFinal[i])) continue;
      finalContas.push(contasFinal[i]);
      finalSinais.push(sinaisFinal[i] ?? "+");
    }
    onChange({ ...token, contas: finalContas, sinais: finalSinais });
  };

  return (
    <div className={cn(
      "inline-flex flex-col gap-1 border rounded-md bg-primary/5 border-primary/30 px-2 py-1.5 max-w-full",
      contas.length === 0 && "border-destructive/50 bg-destructive/5",
    )}>
      <div className="flex items-center gap-1">
        <Badge variant="outline" className="text-[9px]">CONTA</Badge>
        <ContaPicker
          plano={plano}
          selecionadas={contas}
          onChange={adicionarContas}
          buttonLabel={contas.length === 0 ? "Escolher contas" : "Editar contas"}
          allowAnaliticas={allowAnaliticas}
        />
        <button onClick={onRemove} className="text-muted-foreground hover:text-destructive ml-auto">
          <X className="h-3 w-3" />
        </button>
      </div>
      {contas.length === 0 ? (
        <span className="text-[11px] text-destructive">Selecione ao menos uma conta</span>
      ) : (
        <div className="flex flex-wrap gap-1 max-w-[520px]">
          {contas.map((c, i) => {
            const info = contaPorId.get(c);
            const nComMesmaClass = info
              ? plano.filter((p) => p.classificacao === info.classificacao).length
              : plano.filter((p) => p.classificacao === c).length;
            return (
            <div key={`${c}|${i}`} className="inline-flex items-center gap-1 bg-background border border-border rounded px-1.5 py-0.5 text-[11px]">
              <button
                onClick={() => toggleSinal(i)}
                className="font-mono font-bold w-4 text-center hover:bg-muted rounded"
                title="Alternar sinal do termo interno"
              >
                {sinais[i] === "-" ? "−" : "+"}
              </button>
              <span className="font-mono font-medium">{info?.classificacao ?? c}</span>
              <span className="truncate max-w-[180px]">{info?.descricao ?? labelPorClass.get(c) ?? ""}</span>
              {info && nComMesmaClass > 1 && info.codigo && (
                <span className="font-mono text-[10px] text-muted-foreground">{info.codigo}</span>
              )}
              <button onClick={() => removeConta(i)} className="hover:text-destructive">
                <X className="h-2.5 w-2.5" />
              </button>
            </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------
// Popover para escolher uma LINHA da demonstração
// ------------------------------------------------------------

function LinhaPicker({
  valor,
  onChange,
  ocultar = [],
}: {
  valor: string;
  onChange: (key: string) => void;
  ocultar?: string[];
}) {
  const [open, setOpen] = useState(false);
  const [busca, setBusca] = useState("");
  const filtradas = useMemo(() => {
    const b = busca
      .trim()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase();
    return LINHAS_CATALOGO.filter((l) => {
      if (ocultar.includes(l.key)) return false;
      if (!b) return true;
      const lab = l.label.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
      return lab.includes(b) || l.key.toLowerCase().includes(b);
    });
  }, [busca, ocultar]);

  const grupos = useMemo(() => {
    const dre = filtradas.filter((l) => l.origem === "DRE");
    const bp = filtradas.filter((l) => l.origem === "BP");
    return { dre, bp };
  }, [filtradas]);

  return (
    <Popover modal open={open} onOpenChange={(o) => { setOpen(o); if (!o) setBusca(""); }}>
      <PopoverTrigger asChild>
        <Button size="sm" variant="outline" className="h-7 text-xs">
          <ChevronDown className="h-3 w-3 mr-1" />
          {valor ? labelLinha(valor) : "Escolher linha"}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[340px] p-0" align="start">
        <div className="p-2 border-b border-border">
          <input
            className="w-full h-8 rounded border border-input bg-background px-2 text-xs"
            placeholder="Buscar linha…"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            onKeyDown={(e) => e.stopPropagation()}
            autoFocus
          />
          <p className="text-[10px] text-muted-foreground mt-1">
            Linhas resolvidas pelo mesmo motor da DRE/Balanço, com o mapeamento da empresa.
          </p>
        </div>
        <div className="max-h-[320px] overflow-y-auto">
          {grupos.dre.length > 0 && (
            <>
              <div className="px-3 py-1 text-[10px] uppercase tracking-wider text-muted-foreground bg-muted/40">DRE</div>
              {grupos.dre.map((l) => (
                <button
                  key={l.key}
                  type="button"
                  onClick={() => { onChange(l.key); setOpen(false); }}
                  className={cn(
                    "w-full text-left px-3 py-1.5 text-xs hover:bg-accent",
                    valor === l.key && "bg-primary/5",
                  )}
                >
                  {l.label}
                </button>
              ))}
            </>
          )}
          {grupos.bp.length > 0 && (
            <>
              <div className="px-3 py-1 text-[10px] uppercase tracking-wider text-muted-foreground bg-muted/40">Balanço</div>
              {grupos.bp.map((l) => (
                <button
                  key={l.key}
                  type="button"
                  onClick={() => { onChange(l.key); setOpen(false); }}
                  className={cn(
                    "w-full text-left px-3 py-1.5 text-xs hover:bg-accent",
                    valor === l.key && "bg-primary/5",
                  )}
                >
                  {l.label}
                </button>
              ))}
            </>
          )}
          {filtradas.length === 0 && (
            <div className="p-3 text-xs text-muted-foreground text-center">Nenhuma linha.</div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
