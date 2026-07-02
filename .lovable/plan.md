## Problema

O drill-down atual (`useAccountDrilldown` em `src/hooks/use-drilldown.ts`) consulta `chart_of_accounts` + `account_balances` filtrando por prefixo de `codigo_conta`. Como as demonstrações são construídas a partir de `plano_contas` + `lancamentos_diario`/`saldos_abertura`/`saldos_mensais`, essas tabelas ficam vazias — daí a mensagem "Nenhuma conta analítica encontrada".

Além disso, no `build-statements.ts`, o `row.codigo_conta` das linhas da árvore recebe a **classificação** (ex.: `2.1.3.05.02`), não o **código da conta** (`plano_contas.codigo`, ex.: `4903`). O drill-down precisa mapear classificação → contas (`plano_contas.codigo`) para então buscar lançamentos.

## Objetivo

Ao clicar em uma linha da DRE/Balanço, exibir os **lançamentos do diário** (`lancamentos_diario`) que compõem o valor daquela linha, no(s) período(s) selecionado(s), somando exatamente ao valor mostrado. No Balanço, incluir uma linha "Saldo inicial" quando houver.

## Escopo

### 1. Novo hook `useLancamentosDrilldown` (`src/hooks/use-drilldown.ts`)

Assinatura:
```ts
useLancamentosDrilldown(companyId, classificacao, periodos, {
  incluirSaldoInicial: boolean   // true no Balanço, false na DRE
}, enabled)
```

Fluxo:
1. Consulta `plano_contas` do company: `select codigo, descricao, classificacao, is_sintetica where classificacao = :classif OR classificacao like :classif + separador + '%'` — retorna todas as contas descendentes.
2. Filtra apenas contas **analíticas** (`is_sintetica = false`) → lista de `conta_codigo`s.
3. Se vazio: retorna `{ entries: [], saldoInicial: null, contasEncontradas: 0 }` com mensagem específica ("Sem contas analíticas mapeadas para esta linha").
4. Determina range de competência a partir de `periodos` (min/max mês).
5. Consulta em batch:
   ```sql
   select data, historico, debito, credito, conta_codigo, competencia
   from lancamentos_diario
   where company_id = :c
     and conta_codigo in (:contas)
     and competencia between :min and :max
   order by data, id
   ```
6. Se `incluirSaldoInicial`: consulta `saldos_abertura` (mesma lista de `conta_codigo`, `data_referencia` ≤ início do range).
7. Retorna `{ entries, saldoInicial, contasMap }` onde `contasMap[conta_codigo] = { codigo, descricao }` para enriquecer a exibição.

Batch de `in()` deve ser dividido em lotes de ≤ 500 caso a lista fique grande (contas participantes).

### 2. Reescrever `src/components/inline-drilldown.tsx`

Nova UI (tabela substituindo a atual):

| Data | Conta | Histórico | Débito | Crédito | Valor |
|---|---|---|---|---|---|

- Coluna "Conta" só aparece se >1 conta analítica no drill (senão redundante).
- "Valor" = `débito - crédito` (com sinal, formatação pt-BR, respeitando `emMilhares` do pai — passar via prop).
- Débito/Crédito em cinza quando zero.
- Linha inicial "Saldo inicial em dd/mm/aaaa" (quando `incluirSaldoInicial` e houver).
- Linha final "Total (N lançamentos)" com soma.
- Empty states específicos:
  - Nenhuma conta analítica no plano de contas para essa classificação.
  - Contas encontradas, mas sem lançamentos no período.
- Loading com spinner (padrão atual).

Nova prop `variante: "dre" | "bp"` para decidir `incluirSaldoInicial`.

### 3. Ajustes em `src/components/statement-table.tsx`

- Aceitar prop `variante: "dre" | "bp"` (default `"dre"`) e repassar ao `<InlineDrilldown>`.
- Passar `emMilhares` como prop para o drill-down formatar coerente.
- `canDrill` continua sendo `!!row.codigo_conta`. Sintéticos internos continuam clicáveis: o hook agregará lançamentos de todas as analíticas filhas — comportamento coerente com o pedido do usuário ("no sintético expande a árvore", que já existe via chevron, e ao clicar no nome mostra o detalhe consolidado).

### 4. Chamadas nas rotas

- `src/routes/dashboard.dre.tsx`: `<StatementTable variante="dre" ... />`
- `src/routes/dashboard.balanco.tsx`: `<StatementTable variante="bp" ... />`

### 5. Depreciar (não remover) `useAccountDrilldown`

Mantém o export atual para não quebrar `account-drilldown-sheet.tsx`. Marcar com JSDoc `@deprecated` explicando que a nova fonte é `lancamentos_diario`. Sheet fica para trabalho futuro, não é acessado no fluxo relatado.

## Observações técnicas

- Períodos no filtro chegam como `YYYY-MM`; competência é `date` (primeiro dia do mês). Converter: min → `${minAno}-${minMes}-01`, max → último dia do mês do maior período (basta usar `${maxAno}-${maxMes}-01` no BETWEEN se a coluna sempre for dia 1; senão, próximo mês menos 1).
- Ordenação secundária por `id` para estabilidade quando há vários lançamentos na mesma data.
- Nenhuma mudança em `build-statements.ts` — o `codigo_conta = classificação` continua correto; o mapeamento é feito no hook.
- Nenhuma mudança de schema/RLS.

## Fora de escopo

- Refatoração do `account-drilldown-sheet.tsx` (não usado no ponto de clique atual).
- Paginação da lista de lançamentos (assumindo volumes controláveis; se necessário, adicionar depois).
