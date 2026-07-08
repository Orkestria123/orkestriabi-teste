## Diagnóstico da divergência de R$ 167.921,52

Rastreei o cálculo dos dois números:

**"Resultado do Exercício" no PL do BP** (`build-statements.ts:740-755`)
- Fórmula: `resultado = -(Σ movimento de todas as contas do grupo 3, do início do exercício até o mês de referência)`
- `movimento` = `total_debitos − total_creditos` (líquido, campo direto de `saldos_mensais`)
- Para Jan/2025: Σ movimento = 206.573,96 → resultado exibido = **−206.573,96** ✅

**"Lucro Líquido do Exercício" na DRE** (`buildDRE` → `addDRECalculatedTotals`, linhas 478-686)
- Cada linha mapeada é montada a partir dos saldos das contas, mas o VALOR por conta é calculado assim (linha 558):
  ```ts
  const valor = ehReceita ? -c : d;   // c = total_creditos, d = total_debitos
  ```
  → receitas usam **apenas créditos**; despesas usam **apenas débitos**.
- Depois soma pela fórmula: `Rec Bruta − Deduções − Custos − Despesas Op − IRPJ − CSLL`
- Para Jan/2025 dá **−374.495,48**

**A diferença exata: 167.921,52**
- Rodei a query: `Σ créditos em contas de despesa/deduções (grupo 3.01.02, 3.05, 3.06, etc) = 167.921,52`.
- `Σ débitos em contas de receita bruta (3.01.01) = 0,00`.
- Ou seja: existem R$ 167.921,52 de créditos lançados em contas de despesa (estornos, reversões, ajustes contábeis normais) que a DRE está **ignorando** ao usar só `d`. O BP usa o movimento líquido `d − c` e absorve esses créditos naturalmente.

**Consequência**: a DRE está superestimando as despesas em 167.921,52 → prejuízo aparente maior do que a realidade. O BP está correto. Não é IRPJ/CSLL, não é distribuição de lucros, não é conta órfã — é o cálculo do valor por conta no motor da DRE que descarta um lado do movimento.

## Correção

**Uma linha muda em `src/lib/diario/build-statements.ts` (~558):**

```ts
// antes
const valor = ehReceita ? -c : d;

// depois — usa movimento líquido, igual ao BP
const valor = d - c;
```

Semanticamente: `d − c` é positivo para despesas e negativo para receitas. O restante do pipeline (`aplicarMapaESinal` com `inverter_sinal`) já trata o sinal — receitas com `inverter_sinal=true` viram positivas na exibição, despesas permanecem positivas. Estornos ficam compensados no próprio movimento da conta.

## Validação após a correção

Rodar de novo o script de validação (Jan/2025) e conferir:

1. **DRE "(=) Lucro Líquido do Exercício" = BP "Resultado do Exercício"** — mesmo número exato, nos dois modos (contábil e gerencial).
2. Valores esperados após a correção (com base no total líquido do grupo 3):
   - Lucro Líquido contábil: **−206.573,96** (era −374.495,48)
   - Lucro Líquido gerencial: **−216.573,96** (era −384.495,48; mantém a diferença de −10.000 do ajuste)
3. Balanço continua fechando (Ativo = Passivo + PL) em ambos os modos.
4. Diferença gerencial vs contábil continua sendo exatamente ±10.000,00 em Despesas Op, Lucro Líq, Passivo Circulante e Resultado do Exercício.

## Observações

- Não é preciso "unificar" a montagem chamando `buildDRE` de dentro do BP: a identidade `Lucro Líquido DRE = Resultado do Exercício BP` é garantida matematicamente quando ambos usam `d − c` sobre o mesmo conjunto de contas (grupo 3 com tipo `3-DRE`, sem participantes — que já é o caso hoje).
- Não vou tocar em nenhum outro lugar do motor — o resto do fluxo (mapeamento, `inverter_sinal`, subtotais calculados, filtro de apuração, modo gerencial) já está correto e será beneficiado automaticamente.
- Impacto colateral esperado (positivo): linhas individuais da DRE que hoje ignoram créditos em contas de despesa passarão a mostrar o valor líquido, corrigindo também os totais intermediários (Lucro Bruto, EBIT, Resultado antes de IR/CSLL).
