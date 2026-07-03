// Construtor visual de expressão para indicadores.
// Cada token é editável in-place. Termos suportam múltiplas contas com
// sinais +/− internos.

import { useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { X, Plus } from "lucide-react";
import { ContaPicker, type ContaPlanoItem } from "./conta-picker";
import { type Token, validarExpressao } from "@/lib/indicadores/engine";
import { cn } from "@/lib/utils";

interface Props {
  plano: ContaPlanoItem[];
  tokens: Token[];
  onChange: (next: Token[]) => void;
}

const OP_LABEL: Record<string, string> = { "+": "+", "-": "−", "*": "×", "/": "÷" };

export function FormulaBuilder({ plano, tokens, onChange }: Props) {
  const labelPorClass = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of plano) m.set(p.classificacao, p.descricao);
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
          onClick={() => inserir({ tipo: "termo", contas: [], sinais: [] })}
        >
          <Plus className="h-3 w-3 mr-1" /> Termo
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
  onChange,
  onRemove,
}: {
  token: Token;
  plano: ContaPlanoItem[];
  labelPorClass: Map<string, string>;
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
  const sinais = token.sinais ?? [];
  const toggleSinal = (i: number) => {
    const arr = token.contas.map((_, idx) => (idx === i ? (sinais[idx] === "-" ? "+" : "-") : sinais[idx] ?? "+")) as ("+" | "-")[];
    onChange({ ...token, sinais: arr });
  };
  const removeConta = (i: number) => {
    onChange({
      ...token,
      contas: token.contas.filter((_, idx) => idx !== i),
      sinais: sinais.filter((_, idx) => idx !== i),
    });
  };
  const adicionarContas = (novas: string[]) => {
    // Diff: se `novas` contém uma que não estava, adiciona; se removeu, remove.
    const setAtual = new Set(token.contas);
    const setNovas = new Set(novas);
    // Adiciona as que faltam
    const contasFinal = [...token.contas];
    const sinaisFinal = [...sinais];
    for (const c of novas) {
      if (!setAtual.has(c)) {
        contasFinal.push(c);
        sinaisFinal.push("+");
      }
    }
    // Remove as que sumiram
    const removidas = new Set<string>();
    for (const c of token.contas) if (!setNovas.has(c)) removidas.add(c);
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
      token.contas.length === 0 && "border-destructive/50 bg-destructive/5",
    )}>
      <div className="flex items-center gap-1">
        <Badge variant="outline" className="text-[9px]">TERMO</Badge>
        <ContaPicker
          plano={plano}
          selecionadas={token.contas}
          onChange={adicionarContas}
          buttonLabel={token.contas.length === 0 ? "Escolher contas" : "Editar contas"}
        />
        <button onClick={onRemove} className="text-muted-foreground hover:text-destructive ml-auto">
          <X className="h-3 w-3" />
        </button>
      </div>
      {token.contas.length === 0 ? (
        <span className="text-[11px] text-destructive">Selecione ao menos uma conta</span>
      ) : (
        <div className="flex flex-wrap gap-1 max-w-[520px]">
          {token.contas.map((c, i) => (
            <div key={c} className="inline-flex items-center gap-1 bg-background border border-border rounded px-1.5 py-0.5 text-[11px]">
              <button
                onClick={() => toggleSinal(i)}
                className="font-mono font-bold w-4 text-center hover:bg-muted rounded"
                title="Alternar sinal do termo interno"
              >
                {sinais[i] === "-" ? "−" : "+"}
              </button>
              <span className="font-mono text-muted-foreground">{c}</span>
              <span className="truncate max-w-[160px]">{labelPorClass.get(c) ?? ""}</span>
              <button onClick={() => removeConta(i)} className="hover:text-destructive">
                <X className="h-2.5 w-2.5" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
