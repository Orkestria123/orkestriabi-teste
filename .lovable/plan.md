## Aba Análise v2 — Plano de Implementação

A aba atual (`/dashboard/analise`) hoje é uma tabela comparativa A vs B. Vou transformá-la em uma ferramenta de decisão organizada em 7 blocos, mantendo a base existente (`montarDRE/BP/DFC`, `saldos_mensais`, `plano_contas`, `mapeamento_demonstracao`) como fonte única.

A entrega é grande (8–10 arquivos novos). Para reduzir risco e dar valor cedo, vou entregar em **3 fases**, validando com você ao final de cada uma.

---

### Fase 1 — Núcleo (Blocos 1 e 7)

O coração da spec. Entrega o motor desagregado + a aba "Receita × Despesa" completa + o Resumo Executivo.

**Motor — `src/lib/analise-receita-despesa.ts` (novo)**
- `montarReceitaDespesaDetalhado(companyId, competencias)` retorna árvore hierárquica (grupo → centro → conta analítica) com `valor`, `pct_receita`, `pct_pai`, `filhos[]`.
- Identifica receitas por prefixo de classificação `3.01`/`3.10` e despesas por `3.06`/`3.15` (mesma lógica já em uso no `build-statements`).
- Acumula em todos os níveis da classificação para permitir drill-down.
- Helpers: `rankingDespesas(arvore, profundidade)`, `paretoDespesas(ranking)`, `despesaPorCentro(arvore)`, `composicaoReceita(arvore)`, `evolucaoReceitaDespesa(arvores_por_periodo)`.

**Componentes — `src/components/analise/` (novos)**
- `cascata-resultado.tsx` — waterfall Receita → Deduções → Custos → Despesas (por grupo) → Lucro.
- `ranking-despesas.tsx` — barras horizontais com drill-down clicável (grupo abre contas analíticas), `LabelList` mostrando `% da receita`.
- `pareto-despesas.tsx` — `ComposedChart` (barras + linha acumulada) com `ReferenceLine` em 80%.
- `despesa-por-centro.tsx` — donut por centro de atividade + tabela de resultado por centro quando há receita atribuível.
- `evolucao-receita-despesa.tsx` — duas linhas (Receita verde, Despesa vermelha) + área de margem, com insight de "efeito tesoura".
- `composicao-receita.tsx` — donut por origem + indicador de concentração.
- `resumo-executivo.tsx` — 4 cards grandes + narrativa automática em pt-BR.

**Página — `src/routes/dashboard.analise.tsx` (refatorada)**
- Adicionar `<Tabs>` com 7 abas: Resumo, Receita × Despesa, Comparativo (existente), Tendência, Equilíbrio, Capital de Giro, Projeção.
- Cada bloco abre com a pergunta de decisão e fecha com insights automáticos.
- Toggle Empresário/Contador (estado local) muda o nível de detalhe, não o dado.
- Manter o `PeriodPicker` global e o modo apresentação que já existem.

Ao final da Fase 1 a aba já é utilizável: Resumo + Receita × Despesa + Comparativo (preservado) funcionando.

---

### Fase 2 — Diagnóstico (Blocos 3, 5)

- **Bloco 3 — Tendência e Sazonalidade**: `evolucao-mensal.tsx` com média móvel 3M, `detectarSazonalidade()` e heatmap ano × mês (modo contador).
- **Bloco 5 — Capital de Giro**: `ciclo-financeiro.tsx` (PMR + PME − PMP, timeline), `ncg.tsx` (evolução) e projeção de caixa simples (linear sobre a queima recente).

---

### Fase 3 — Decisão (Blocos 4, 6) + Admin

- **Bloco 4 — Ponto de Equilíbrio**: requer marcação Fixo/Variável.
  - Coluna nova `tipo_custo` (`'fixo'|'variavel'|null`) em `mapeamento_demonstracao` via migração.
  - Tela no Admin (`admin.classificacao-custos.tsx`) para o contador classificar.
  - `ponto-equilibrio.tsx` com gráfico clássico e KPIs de margem de segurança e GAO.
- **Bloco 6 — Projeção e Cenários**:
  - `projecao-tendencia.tsx` (regressão linear + banda de confiança, sempre tracejado).
  - `simulador-cenarios.tsx` com sliders e o `SimuladorCorteDespesa` conectado ao ranking do Bloco 1.
- **Admin — vínculo receita ↔ centro** (opcional): tela para o contador vincular receitas a centros, habilitando o "Resultado por Centro" do Bloco 1.4.

---

### Pontos a confirmar antes de começar

1. **Posso começar pela Fase 1 agora** (Resumo + Receita × Despesa + manter o Comparativo atual numa aba)? Esta fase já entrega o núcleo prometido.
2. **Identificação de receita/despesa**: vou usar os prefixos de classificação contábil padrão (`3.01`/`3.10` para receita; `3.06`/`3.15` para despesa). Se a sua base usa outros prefixos, me confirma para eu ajustar.
3. **Centros de atividade**: o Bloco 1.4 detecta o centro pela descrição da classificação intermediária (ex.: "3.06.01 – Despesas Administrativas"). Se o seu plano usa outra convenção, eu adapto.

Se estiver tudo bem, começo a Fase 1 imediatamente após sua confirmação.