## Diagnóstico

Após a correção do bug anterior (incluir contas participantes 4/5/6/7 no plano para o BP), a função `getPlanoPorTipo` agora baixa o plano inteiro, incluindo **TODOS os clientes e fornecedores cadastrados**:

```
1-Ativo         322
4-Cli. Nac.     113.099   ← todos os clientes (a maioria SEM saldo)
6-Cli. Ex.         264
2-Passivo       223
5-For. Nac.     21.191
7-For. Ex.          52
```

Total: ~113k linhas para o lado Ativo e ~21k para o Passivo, paginadas de 1000 em 1000 (113+ requisições sequenciais por lado). Isso estoura o tempo de resposta antes do `useMonthlyStatement` resolver, e o Balanço renderiza vazio ("Nenhum dado encontrado").

A própria função já comenta que precisa dos participantes "que tem saldo real" — mas o filtro de tipo traz todos cadastrados, não só os com movimento.

## Correção

Em `src/lib/diario/build-statements.ts`, função `getPlanoPorTipo` (linhas 110-144):

1. Quando `incluirParticipantes` for `true`, **NÃO** fazer um único `.in("tipo", ...)` aberto.
2. Em vez disso:
   - Buscar normalmente as contas estruturais (`tipo IN ('1-Ativo')` ou `('2-Passivo')`, `is_participante=false`).
   - Buscar os participantes **apenas pelos `codigo`s que aparecem em `saldos_abertura` ou `saldos_mensais` da empresa** (até a data de referência), em `.in("codigo", codigos)` paginado.
3. Mesclar os dois conjuntos no mesmo array `Plano[]`.

Para isso, `getPlanoPorTipo` passa a aceitar um parâmetro opcional com a lista de `conta_codigo` que efetivamente têm saldo. Em `buildBP`:

- Primeiro buscar `abertura` e `saldosAcum` (já são buscados).
- Extrair o set de `conta_codigo` distintos.
- Chamar `getPlanoPorTipo(..., { incluirParticipantes: true, codigosComSaldo: [...] })`.
- A função filtra `4/5/6/7` por `.in("codigo", codigos)`, mas mantém `1/2` (estruturais) intactos.

## Impacto

- Apenas escopo do BP (Ativo / Passivo). DRE / DFC / DLPA / DVA continuam usando `incluirParticipantes:false` (não afetados).
- Não muda agregação, sinais, nem hierarquia visual já corrigida.
- Resultado esperado: Balanço volta a carregar; Clientes/Fornecedores continuam somando corretamente, pois só são úteis os que têm saldo.

## Validação

1. Abrir `/dashboard/balanco`, Jan 2025 — deve mostrar Ativo e Passivo com valores.
2. Verificar que `Clientes ≈ R$ 1.539.255,93` (Ativo Circulante) e `Fornecedores ≈ R$ 7.491.455,42` (Passivo Circulante) seguem presentes.
3. Diferença Ativo vs Passivo+PL = R$ 0,00.
