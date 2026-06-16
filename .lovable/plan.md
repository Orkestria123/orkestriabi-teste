## Problema

Ao abrir o BI de uma empresa, a página quebra com:

> Cannot read properties of undefined (reading 'ativo_circulante')

Causa: em `src/lib/indicators.ts`, `computeIndicadoresCompletos` assume que sempre existe pelo menos um período com base extraída. Quando a empresa selecionada ainda não tem DRE/BP montados (ou os períodos do filtro não batem com nenhum dado), acontece:

- `periodosOrd` fica vazio → `periodosOrd[periodosOrd.length - 1]` é `undefined`
- `baseMap.get(undefined)` retorna `undefined`
- `def.numeradorOf(baseUlt)` tenta ler `b.ativo_circulante` em `undefined` → crash

Esse crash sobe pela home do dashboard (`dashboard.index.tsx`) que chama `computeIndicators` → `computeIndicadoresCompletos`.

## Correção

Apenas em `src/lib/indicators.ts`, dentro de `computeIndicadoresCompletos`:

1. Se `periodosOrd.length === 0` → retornar `[]` (sem indicadores; UI já lida com lista vazia).
2. No mapeamento da série, usar fallback seguro quando `baseMap.get(p)` for `undefined` (devolver `{ periodo: p, valor: null }` em vez de tentar calcular).
3. Para `baseUlt`, se o `get(...)` voltar `undefined`, construir um `BasePeriodo` vazio (todos os campos como `{ valor: 0, contas: [] }`) e marcar `valor_atual = null`, `faixa = "atencao"`, leitura padrão "Sem dados suficientes…".

Adicionar um helper local `baseVazia(): BasePeriodo` para reutilizar.

## Validação

- Abrir `/dashboard?company=<id sem dados>` → página renderiza com KPIs zerados e cards de indicador exibindo "Sem dados suficientes" no lugar do erro.
- Empresa com dados completos continua funcionando normalmente (regressão).

## Arquivo afetado

- `src/lib/indicators.ts` (somente `computeIndicadoresCompletos` e novo helper `baseVazia`).