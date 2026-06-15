
# DFC, DLPA e DVA — implementação completa baseada nos CPCs

Hoje as três páginas (`/dashboard/fluxo-de-caixa`, `/dashboard/dlpa`, `/dashboard/dva`) já existem mas reutilizam o mesmo motor da DRE e exibem só um gráfico cada uma. A proposta é construir cada demonstração com a estrutura normativa correta, mantendo o motor único (`saldos_mensais` + `plano_contas` + `mapeamento_demonstracao`) e padronizando a UX.

## 1. Motor de cálculo (`src/lib/diario/build-statements.ts`)

Adicionar três funções específicas — DFC, DLPA, DVA — que devolvem o mesmo `FlatRow[]` já consumido pelas páginas, e expor cada uma via `buildStatement(...)` (switch por tipo).

### 1.1 DFC — método indireto (CPC 03 R2)
- `PREFIXO_CAIXA = "1.01.01"` (caixa + bancos + aplicações de liquidez imediata).
- Carregar: DRE do período (para LL, depreciação, amortização, equivalência), saldos do BP no início e no fim de cada período, e saldos de caixa em t-1 / t.
- Calcular blocos:
  - **Operacional** = LL + depreciação/amortização + provisões + equivalência (revertida) ± variação capital de giro (CR, estoques, outros ativos CP → sinal invertido; fornecedores, obrig. trabalhistas e tributárias → sinal direto).
  - **Investimento** = -Δ imobilizado bruto, -Δ investimentos, -Δ aplicações LP, + baixas identificadas.
  - **Financiamento** = +captação - amortização (empréstimos CP+LP), + aumento de capital, - dividendos pagos, - JCP pagos.
- Emitir `FlatRow` com subtotais por bloco + total "Variação líquida" + linhas "Caixa no início" e "Caixa no final".
- **Validação CPC 03**: `Σ blocos ≈ Δ caixa real no BP`; flag `_validado` na última linha (descrição "Validação CPC 03") para a UI ler.

### 1.2 DLPA (Lei 6.404 art. 186 / CPC 26)
- Conta âncora `2.05.01.09` (lucros/prejuízos acumulados) — buscar saldo em t-1 e em t.
- Linhas: saldo inicial, ajustes exercícios anteriores, saldo inicial ajustado, lucro líquido (vem da DRE), destinações (reserva legal, estatutária, contingências, retenção, incentivos), dividendos, JCP, saldo final.
- **Reserva legal automática**: helper `calcularReservaLegal(LL, capital_social, reserva_atual)` = `min(LL * 5%, capital * 20% - reserva_atual)`. Exibida como "sugestão" se a contabilização real estiver zerada.
- **Validação**: saldo final calculado ≈ saldo contábil em `2.05.01.09` no fim do exercício.

### 1.3 DVA (CPC 09)
- Geração: receitas - insumos = VA bruto; - depreciação = VA líquido; + transferências (receitas financeiras + equivalência) = VA total.
- Distribuição: pessoal, impostos, capital de terceiros (juros/aluguéis), capital próprio (dividendos + JCP + lucro retido).
- **Validação CPC 09**: `VA total ≈ Σ distribuição` (tolerância R$ 0,01).
- Para classificar as contas de distribuição usar o mapeamento — adicionar tipos `DVA_PESSOAL`, `DVA_IMPOSTOS`, `DVA_CAP_TERCEIROS`, `DVA_CAP_PROPRIO` em `mapeamento_demonstracao`.

### 1.4 Migration de mapeamento
- Adicionar prefixos default no seed (admin pode editar por empresa):
  - DFC: `CAIXA_EQUIVALENTES` (1.01.01), `IMOBILIZADO`, `EMPRESTIMOS_CP`, `EMPRESTIMOS_LP`, `CAPITAL_SOCIAL`, `DIVIDENDOS_A_PAGAR`, `JCP_A_PAGAR`.
  - DLPA: `LUCROS_ACUMULADOS` (2.05.01.09), `RESERVA_LEGAL`, `RESERVA_ESTATUTARIA`, `CAPITAL_SOCIAL`.
  - DVA: prefixos de pessoal (3.06.01.01), impostos (3.01.02), juros/aluguéis, etc.

## 2. Design system de gráficos (`src/lib/chart-config.ts`)
Já existe parcial — completar/expor:
- `CHART_COLORS` (paleta com 8 entradas), `SEMANTIC` (positivo/negativo/neutro/destaque), `TOOLTIP_STYLE`, `AXIS_PROPS`, `GRID_PROPS`, `ANIMATION` (`isAnimationActive`, `animationDuration=600`, `animationEasing="ease-out"`).
- Componente reutilizável `<ValidationBadge ok={…} label={…} />` em `src/components/validation-badge.tsx`.
- Helper `useInsights(data)` para mostrar 3-4 frases de leitura automática abaixo dos gráficos.

## 3. Páginas

Layout comum (substituir o atual em DFC/DLPA/DVA):

```text
┌──────────────────────────────────────────────────┐
│ Título            [Período]   [Empresário|Contador]│
├──────────────────────────────────────────────────┤
│ KPIs (3-4 cards)                                  │
├──────────────────────────────────────────────────┤
│ Gráfico principal                                 │
├───────────────────────┬──────────────────────────┤
│ Gráfico secundário     │  Gráfico terciário        │
├──────────────────────────────────────────────────┤
│ 💡 Insights automáticos                           │
├──────────────────────────────────────────────────┤
│ Tabela (collapsada no modo Empresário)            │
│ [Exportar PDF] [Exportar Excel] [Validação CPC]   │
└──────────────────────────────────────────────────┘
```

Toggle "Visão Empresário / Visão Contador" controlado por estado local (default Empresário).

### 3.1 DFC — `src/routes/dashboard.fluxo-de-caixa.tsx`
- **KPIs**: Fluxo Operacional, Fluxo Livre (Op+Inv), Conversão de Caixa (FCO/EBITDA), Margem de Caixa (FCO/Receita).
- **Gráficos**:
  1. Waterfall Caixa Inicial → Operacional → Investimento → Financiamento → Caixa Final (já existe, refinar com paleta unificada).
  2. Área com gradiente do FCO mês a mês (`ReferenceLine y=0`).
  3. Barras agrupadas Operacional/Investimento/Financiamento por mês.
- Insights automáticos sobre saúde operacional, qualidade do lucro, padrão de investimento, dependência de financiamento.
- Badge de validação "Variação de caixa conferida com o Balanço".

### 3.2 DLPA — `src/routes/dashboard.dlpa.tsx`
- **KPIs**: Payout, Taxa de Retenção, Saldo Final de Lucros Acumulados, Dividend Yield Contábil.
- **Gráficos**:
  1. Waterfall Lucro Líquido → -Reserva Legal → -Dividendos → -JCP → Lucro Retido.
  2. Evolução do saldo de lucros acumulados (linha, multi-período).
  3. Pizza de destinação (Retido / Distribuído / Reservas).
- Insights sobre payout, prejuízos acumulados (vedação de distribuição), limite da reserva legal.
- Badge "Saldo final reconciliado".

### 3.3 DVA — `src/routes/dashboard.dva.tsx`
- **KPIs**: Valor Adicionado Total, Carga Tributária sobre VA, Taxa de VA (VA/Receita), Retenção dos Sócios.
- **Gráficos**:
  1. Donut da distribuição (Pessoal / Governo / Financiadores / Sócios) com VA total no centro — gráfico-assinatura.
  2. Barras horizontais empilhadas da geração do VA (Receitas, -Insumos, -Depreciação, +Transferências).
  3. Barras empilhadas 100% da evolução da distribuição ao longo dos períodos.
- Insights sobre carga tributária, riqueza por colaborador (quando houver), maior fatia.
- Badge "Valor gerado = valor distribuído (CPC 09)".

## 4. Exportação
- Botão "Exportar PDF" e "Exportar Excel" em cada página, reutilizando os helpers já existentes (se ainda não existirem, criar `src/lib/export/pdf.ts` e `xlsx.ts` baseados na tabela atual).

## 5. Validações inquebráveis (lembretes)
- Sinais: entradas positivas; saídas em parênteses (já temos `formatBRL`).
- Sem dados de abertura → exibir aviso ("DFC parcial — sem saldos de abertura") em vez de quebrar.
- DVA bloqueia se `|geração - distribuição| > R$ 0,01` (badge vermelho + tooltip explicando qual lado divergiu).

## Ordem de execução
1. Migration de mapeamento (DFC/DLPA/DVA prefixos).
2. `chart-config.ts` completo + `<ValidationBadge>` + `useInsights`.
3. `build-statements.ts` — `buildDFC`, `buildDLPA`, `buildDVA` + helpers de saldo pontual / abertura / variação.
4. Página DFC (KPIs + 3 gráficos + insights + badge).
5. Página DLPA (idem).
6. Página DVA (idem).
7. Toggle Empresário/Contador nas 3 páginas.
8. Exportação PDF/Excel.

## Perguntas antes de implementar
1. **Reserva legal**: lançada pelo contador no diário, ou o sistema deve apenas *sugerir* e nunca persistir? (Vou implementar como sugestão visual.)
2. **Método da DFC**: confirma método **indireto** como padrão (e direto fica como toggle futuro)?
3. **Capital social** para o limite da reserva legal: leio do BP (`2.05.01.01`) automaticamente — ok?
4. **Mapeamento DVA**: vou criar 4 novos `tipo_demonstracao` (`DVA_PESSOAL`, `DVA_IMPOSTOS`, `DVA_CAP_TERCEIROS`, `DVA_CAP_PROPRIO`) com prefixos default que o admin pode editar por empresa — ok?
