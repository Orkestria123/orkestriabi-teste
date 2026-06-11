## Orkestria BI — Análise Comparativa + Redesign de Gráficos

Vou implementar em 3 sprints. Posso entregar tudo de uma vez, mas recomendo confirmar a ordem antes para evitar retrabalho.

---

### Sprint 1 — Página `/dashboard/analise` (reimplementação completa)

Substituir `src/routes/dashboard.analise.tsx` por uma ferramenta autônoma (independente do FilterBar global):

- **Estado local**: `granularidade` (`ano` | `mes`), `periodoA`, `periodoB`, `tipo` (`DRE` | `BP_ATIVO` | `BP_PASSIVO` | `DFC` | `INDICADORES`).
- **Seletor de granularidade** (toggle/tabs) + dois dropdowns de período.
  - Ano: lista anos únicos derivados de `useAvailablePeriods`.
  - Mês: lista `Mmm/AAAA` derivados de `useAvailablePeriods`.
- **Resolução de períodos** via helper `resolverPeriodos`: mês → `[valor]`; ano → todos os meses do exercício existentes.
- **Agregação** via `agregarPeriodos`: BP usa o último mês; DRE/DFC somam linha a linha (por `linha_ordem`).
- **Fonte de dados**: `useMonthlyStatement(companyId, tipo, [...periodosA, ...periodosB])` em uma única chamada; depois separar/agregar em memória.
- **Tabs de demonstração** (horizontais): DRE / BP-Ativo / BP-Passivo / DFC / Indicadores.
- **3 Cards de destaque** acima da tabela: Lucro Líquido, Receita Líquida, Margem Líquida (variação em p.p. para %).
- **Gráfico de barras agrupadas** dos 6 maiores subtotais (período A vs B).
- **Tabela comparativa**: Descrição | A | B | Var R$ | Var % com:
  - Cor invertida para linhas de custo/despesa/dedução.
  - Badge ⚡ pulsante para |Δ%| > 50.
- **Aba Indicadores**: reaproveita `src/lib/indicators.ts`; exibe cards lado-a-lado (sem tabela) para A e B com variação.
- **Modo Apresentação**: toggle no canto superior direito. Adiciona classe no `body`, esconde sidebar via CSS global (`src/styles.css`), aumenta fonte da tabela e oculta colunas de valores absolutos (mostra só Var R$ compacto + Var %). Botão "Sair" fixo bottom-right.

Novos arquivos:
- `src/components/analise/highlight-card.tsx`
- `src/components/analise/period-picker.tsx`
- `src/components/analise/comparativo-table.tsx`
- `src/components/analise/comparativo-bar-chart.tsx`
- `src/lib/analise-helpers.ts` (resolverPeriodos, agregarPeriodos)

---

### Sprint 2 — Redesign dos Gráficos

**Novo arquivo central** `src/lib/chart-config.ts`:
- `CHART_COLORS`, `TOOLTIP_STYLE`, `AXIS_PROPS`, `GRID_PROPS`, `chartTooltipFormatter`.

**Refatorações** (varrer todos os gráficos em `src/routes/dashboard.*.tsx` e em `src/components/*`):
1. AreaChart Receita vs Custos → Receita: linha sólida 2.5px + área sutil (gradiente 0.18→0); Custos: tracejada 1.8px sem área; dots visíveis.
2. LineChart Lucro → AreaChart com `LucroPos`/`LucroNeg` em verde/vermelho + `ReferenceLine y={0}` + dot dinâmico por sinal.
3. BarChart empilhado → barras agrupadas, top 3 categorias, `LabelList` no topo.
4. PieChart → `innerRadius=70/outerRadius=105`, `paddingAngle=3`, label externo `%`, legend horizontal abaixo, stroke `var(--card)` 3px.
5. Waterfall DFC → cores via `var(--chart-1)` / `var(--success)` / `var(--destructive)`; `LabelList` com valor.
6. Ativar `isAnimationActive` + `animationDuration` em todos.

---

### Sprint 3 — Cards e detalhes finais

- **Página Indicadores** (`dashboard.indicadores.tsx`): substituir tabela por grade `grid-cols-2 md:grid-cols-3 xl:grid-cols-4` de `IndicatorCard` (valor, semáforo verde/amarelo/vermelho, variação vs período anterior, mini sparkline, descrição).
- **`src/components/kpi-card.tsx`**: Sparkline com path bezier suave + ponto final destacado + `gradId` único por instância (via `useId`).
- **LabelList** nos gráficos de barras principais do dashboard.

---

### Pontos de atenção

- **`useMonthlyStatement` para `DFC`**: hoje só DRE e BP são tratados (linha "DRE/DFC: c-d, BP: sf"). Vou estender a lógica do hook para tratar DFC como fluxo (igual DRE) — sem isso a comparação de DFC não funciona corretamente em modo Ano.
- **Indicadores em modo Ano**: precisamos recalcular indicadores a partir dos valores agregados (não dá para pegar do banco direto). Vou reusar `src/lib/indicators.ts` passando os rows já agregados.
- **`var(--warning)` e `var(--success)`**: confirmar que existem em `src/styles.css`; se não, adiciono os tokens.
- **Modo Apresentação**: usa CSS global (`body.presentation-mode aside { display: none }`); não mexe na lógica do `SidebarProvider`.

---

### Pergunta antes de começar

Confirma que posso **seguir a ordem inteira (Sprint 1 → 2 → 3) em uma única entrega**, ou prefere que eu pare ao final do Sprint 1 para você validar a Análise Comparativa antes de mexer nos gráficos?
