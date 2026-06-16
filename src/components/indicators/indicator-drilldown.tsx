import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  formatIndicador,
  corFaixa,
  type IndicadorCompleto,
} from "@/lib/indicators";
import { MiniTrend } from "./mini-trend";

interface Props {
  ind: IndicadorCompleto | null;
  onClose: () => void;
}

function fmtBRL(v: number): string {
  return v.toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
    minimumFractionDigits: 2,
  });
}

export function IndicatorDrilldown({ ind, onClose }: Props) {
  const open = ind != null;
  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
        {ind && (
          <>
            <SheetHeader>
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
                {ind.categoria}
              </p>
              <SheetTitle className="text-2xl">{ind.label}</SheetTitle>
            </SheetHeader>

            {/* Valor em destaque */}
            <div
              className="mt-4 rounded-lg border p-4"
              style={{
                borderColor: corFaixa(ind.faixa),
                background: `color-mix(in oklab, ${corFaixa(ind.faixa)} 8%, transparent)`,
              }}
            >
              <p
                className="text-4xl font-semibold tabular-nums"
                style={{ color: corFaixa(ind.faixa) }}
              >
                {formatIndicador(ind.valor_atual, ind.formato)}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {ind.referencia}
              </p>
            </div>

            {/* Fórmula com números reais */}
            <section className="mt-6">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Como foi calculado
              </h3>
              <div className="mt-2 rounded-lg border bg-card p-4">
                <div className="flex flex-wrap items-center gap-3 text-sm">
                  <div className="min-w-[180px] flex-1">
                    <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
                      {ind.numeradorLabel}
                    </p>
                    <p className="text-lg font-semibold tabular-nums">
                      {fmtBRL(ind.numerador.valor)}
                    </p>
                  </div>
                  {ind.denominadorLabel && (
                    <>
                      <span className="text-2xl text-muted-foreground">÷</span>
                      <div className="min-w-[180px] flex-1">
                        <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
                          {ind.denominadorLabel}
                        </p>
                        <p className="text-lg font-semibold tabular-nums">
                          {fmtBRL(ind.denominador.valor)}
                        </p>
                      </div>
                    </>
                  )}
                  <span className="text-2xl text-muted-foreground">=</span>
                  <div className="text-lg font-bold tabular-nums">
                    {formatIndicador(ind.valor_atual, ind.formato)}
                  </div>
                </div>
                <p className="mt-3 font-mono text-[11px] text-muted-foreground">
                  {ind.formulaTexto}
                </p>
              </div>
            </section>

            {/* Contas que formam o numerador */}
            {ind.numerador.contas.length > 0 && (
              <section className="mt-6">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Contas que formam &quot;{ind.numeradorLabel}&quot;
                </h3>
                <div className="mt-2 divide-y rounded-lg border bg-card">
                  {ind.numerador.contas.map((c, i) => (
                    <div
                      key={`${c.codigo}-${i}`}
                      className="flex items-center justify-between gap-3 px-3 py-2 text-sm"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="font-mono text-[10px] text-muted-foreground">
                          {c.classificacao}
                        </p>
                        <p className="truncate">{c.descricao}</p>
                      </div>
                      <span className="tabular-nums">{fmtBRL(c.valor)}</span>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* Contas que formam o denominador */}
            {ind.denominador.contas.length > 0 && ind.denominadorLabel && (
              <section className="mt-4">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Contas que formam &quot;{ind.denominadorLabel}&quot;
                </h3>
                <div className="mt-2 divide-y rounded-lg border bg-card">
                  {ind.denominador.contas.map((c, i) => (
                    <div
                      key={`${c.codigo}-${i}`}
                      className="flex items-center justify-between gap-3 px-3 py-2 text-sm"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="font-mono text-[10px] text-muted-foreground">
                          {c.classificacao}
                        </p>
                        <p className="truncate">{c.descricao}</p>
                      </div>
                      <span className="tabular-nums">{fmtBRL(c.valor)}</span>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* Evolução histórica */}
            <section className="mt-6">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Evolução histórica
              </h3>
              <div className="mt-2 rounded-lg border bg-card p-3">
                <MiniTrend
                  values={ind.serie.map((s) => s.valor)}
                  color={corFaixa(ind.faixa)}
                  height={120}
                />
                <div className="mt-2 grid grid-cols-2 gap-1 text-[10px] text-muted-foreground sm:grid-cols-4">
                  {ind.serie.map((s) => (
                    <div key={s.periodo} className="flex justify-between gap-2">
                      <span>{s.periodo.slice(0, 7)}</span>
                      <span className="tabular-nums text-foreground/80">
                        {formatIndicador(s.valor, ind.formato)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </section>

            {/* O que isso significa */}
            <section className="mt-6 mb-4 rounded-lg border border-primary/30 bg-primary/5 p-4">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-primary">
                💡 O que isso significa
              </h3>
              <p className="mt-2 text-sm leading-relaxed">
                {ind.leitura_empresario}
              </p>
            </section>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
