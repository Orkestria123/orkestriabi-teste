// Painel de validação de fechamento da DFC (Etapa 4).
// Mostra as três igualdades do CPC 03 com semáforo, o diagnóstico das
// divergências e a cobertura da configuração de contas.

import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Loader2,
  ShieldCheck,
} from "lucide-react";
import { formatBRL, formatPct } from "@/lib/format";
import type { DfcValidacaoResultado } from "@/lib/dfc/validacao";

interface Props {
  data?: DfcValidacaoResultado;
  isLoading?: boolean;
}

export function DfcValidacaoPanel({ data, isLoading }: Props) {
  const [aberto, setAberto] = useState(true);
  const [verContas, setVerContas] = useState(false);

  if (isLoading || !data) {
    return (
      <Card className="p-4 flex items-center gap-2 text-xs text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Validando o fechamento da DFC…
      </Card>
    );
  }

  const { checks, tudoOk, cobertura } = data;
  const falhas = checks.filter((c) => !c.ok);

  return (
    <Card
      className={cn(
        "border",
        tudoOk ? "border-emerald-500/40 bg-emerald-500/5" : "border-amber-500/50 bg-amber-500/5",
      )}
    >
      <button
        type="button"
        onClick={() => setAberto((v) => !v)}
        className="w-full flex items-center gap-2 px-4 py-3 text-left"
      >
        {tudoOk ? (
          <ShieldCheck className="h-4 w-4 text-emerald-600 shrink-0" />
        ) : (
          <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0" />
        )}
        <span className="text-sm font-semibold">
          {tudoOk ? "DFC validada" : "DFC com divergências"}
        </span>
        <span className="text-[11px] text-muted-foreground">
          {tudoOk
            ? "as três validações fecham"
            : `${falhas.length} de ${checks.length} validações não fecham`}
        </span>
        <span className="ml-auto flex items-center gap-2">
          <Badge
            variant="outline"
            className={cn(
              "text-[10px] py-0",
              cobertura.percentual >= 99.9
                ? "border-emerald-500/60 text-emerald-700 dark:text-emerald-400"
                : "border-amber-500/60 text-amber-700 dark:text-amber-400",
            )}
          >
            Cobertura {formatPct(cobertura.percentual, 0)}
          </Badge>
          {aberto ? (
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
          )}
        </span>
      </button>

      {aberto && (
        <div className="px-4 pb-4 space-y-3">
          <div className="grid gap-2 md:grid-cols-3">
            {checks.map((c) => (
              <div
                key={c.key}
                className={cn(
                  "rounded-md border p-3 bg-background/60",
                  c.ok ? "border-emerald-500/30" : "border-amber-500/40",
                )}
              >
                <div className="flex items-start gap-2">
                  {c.ok ? (
                    <CheckCircle2 className="h-3.5 w-3.5 mt-0.5 text-emerald-600 shrink-0" />
                  ) : (
                    <AlertTriangle className="h-3.5 w-3.5 mt-0.5 text-amber-600 shrink-0" />
                  )}
                  <span className="text-[11px] font-medium leading-tight">{c.titulo}</span>
                </div>
                <dl className="mt-2 space-y-1 text-[11px] tabular-nums">
                  <div className="flex justify-between gap-2">
                    <dt className="text-muted-foreground truncate">{c.esquerdaLabel}</dt>
                    <dd className="whitespace-nowrap">{formatBRL(c.esquerda)}</dd>
                  </div>
                  <div className="flex justify-between gap-2">
                    <dt className="text-muted-foreground truncate">{c.direitaLabel}</dt>
                    <dd className="whitespace-nowrap">{formatBRL(c.direita)}</dd>
                  </div>
                  <div className="flex justify-between gap-2 pt-1 border-t border-border/60">
                    <dt className="font-medium">Diferença</dt>
                    <dd
                      className={cn(
                        "whitespace-nowrap font-semibold",
                        c.ok ? "text-emerald-600" : "text-amber-700 dark:text-amber-400",
                      )}
                    >
                      {formatBRL(c.diferenca)}
                    </dd>
                  </div>
                </dl>
                {!c.ok && c.diagnostico && (
                  <p className="mt-2 text-[10px] leading-snug text-muted-foreground">
                    {c.diagnostico}
                  </p>
                )}
              </div>
            ))}
          </div>

          {/* Cobertura da configuração */}
          <div className="rounded-md border border-border/60 bg-background/60 p-3">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <p className="text-[11px]">
                <span className="font-semibold">{formatPct(cobertura.percentual, 0)}</span> das
                contas patrimoniais com movimento no período estão mapeadas na DFC
                {cobertura.naoMapeadas.length > 0 && (
                  <>
                    {" — "}
                    <span className="text-amber-700 dark:text-amber-400 font-medium">
                      {cobertura.naoMapeadas.length} conta
                      {cobertura.naoMapeadas.length > 1 ? "s" : ""} sem mapear
                    </span>{" "}
                    podem causar divergência ({formatBRL(cobertura.movimentoNaoMapeado)} de
                    movimento).
                  </>
                )}
              </p>
              {cobertura.naoMapeadas.length > 0 && (
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 px-2 text-[11px]"
                  onClick={() => setVerContas((v) => !v)}
                >
                  {verContas ? "Ocultar contas" : "Ver contas sem mapear"}
                </Button>
              )}
            </div>
            <div className="mt-2 h-1.5 rounded-full bg-muted overflow-hidden">
              <div
                className={cn(
                  "h-full rounded-full",
                  cobertura.percentual >= 99.9 ? "bg-emerald-500" : "bg-amber-500",
                )}
                style={{ width: `${Math.min(100, Math.max(2, cobertura.percentual))}%` }}
              />
            </div>

            {verContas && cobertura.naoMapeadas.length > 0 && (
              <div className="mt-3 max-h-64 overflow-auto rounded border border-border/60">
                <table className="w-full text-[11px] tabular-nums">
                  <thead className="bg-muted/40 sticky top-0">
                    <tr>
                      <th className="text-left font-medium px-2 py-1.5">Código</th>
                      <th className="text-left font-medium px-2 py-1.5">Classificação</th>
                      <th className="text-left font-medium px-2 py-1.5">Conta</th>
                      <th className="text-left font-medium px-2 py-1.5">Grupo</th>
                      <th className="text-right font-medium px-2 py-1.5">Movimento</th>
                    </tr>
                  </thead>
                  <tbody>
                    {cobertura.naoMapeadas.slice(0, 200).map((c) => (
                      <tr key={c.codigo} className="border-t border-border/40">
                        <td className="px-2 py-1 whitespace-nowrap">{c.codigo}</td>
                        <td className="px-2 py-1 whitespace-nowrap text-muted-foreground">
                          {c.classificacao}
                        </td>
                        <td className="px-2 py-1">{c.descricao}</td>
                        <td className="px-2 py-1 whitespace-nowrap text-muted-foreground">
                          {c.grupo}
                        </td>
                        <td
                          className={cn(
                            "px-2 py-1 text-right whitespace-nowrap",
                            c.movimento < 0 && "text-destructive",
                          )}
                        >
                          {formatBRL(c.movimento)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {cobertura.naoMapeadas.length > 200 && (
                  <p className="px-2 py-1 text-[10px] text-muted-foreground">
                    Mostrando as 200 maiores de {cobertura.naoMapeadas.length} contas.
                  </p>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </Card>
  );
}
