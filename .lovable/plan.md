
# Sistema de Indicadores Customizáveis por Empresa

Substitui o painel atual (que só permitia vincular contas a indicadores padrão fixos) por um construtor completo de indicadores por empresa. A visão do cliente permanece somente leitura.

## 1. Schema (migration)

Nova tabela `indicadores_empresa`:

- `id uuid PK`, `tenant_id`, `company_id`, `created_at`, `updated_at`
- `nome text`, `categoria text` (livre; sugestões: Liquidez, Rentabilidade, Endividamento, Atividade, Personalizado)
- `formula jsonb` — expressão tokenizada (ver formato abaixo)
- `modo_analise text` — `numero | reais | percentual | ah_percent | ah_valor`
- `faixas jsonb` — `{ otimo, bom, atencao, critico, direcao: 'maior_melhor'|'menor_melhor' }` (opcional)
- `descricao text`
- `visibilidade text DEFAULT 'indicadores'` — `invisivel | indicadores | dashboard | ambos`
- `is_padrao boolean`, `revisar_contas boolean`, `ordem int`
- RLS: tenant/company scoping via `get_my_tenant_id` / `has_role('orkestria_admin'|'tenant_admin')`
- GRANTs padrão para `authenticated` e `service_role`

Formato de `formula.expressao` (array de tokens):

```
{ tipo: "parentese", valor: "(" | ")" }
{ tipo: "operador",  valor: "+" | "-" | "*" | "/" }
{ tipo: "termo",     contas: ["3.06.01.01", "..."], sinais: ["+","-", ...] }
{ tipo: "constante", valor: 100 }   // opcional, para futuras fórmulas com literais
```

Cada `conta` é o `classificacao` (código estruturado) — se for sintética, o cálculo expande para a soma de todas as analíticas descendentes.

`indicador_config_empresa` (tabela antiga) será mantida em coexistência mas o app deixa de lê-la. Não drop na mesma migration.

## 2. Motor de cálculo (`src/lib/indicadores/engine.ts`)

- `expandirContas(codigos, plano)` → resolve sintéticas em analíticas descendentes (via `mascara/interpretar`).
- `valorConta(codigo, periodo, saldos, natureza)` → sinal correto por natureza/grupo (mesma lógica do build-statements).
- `avaliarExpressao(tokens, resolverConta, periodo)` → shunting-yard → RPN → resultado.
- `calcularIndicador(ind, periodos, plano, saldos)` → série `{ periodo, valor }[]`.
- Modo AH% / AH$: compara primeiro vs último período da seleção.
- Validação de expressão: parênteses balanceados, sem operador duplo, termos com ≥1 conta.

## 3. Componentes de UI (admin)

`src/components/indicadores/formula-builder.tsx`
- Lista visual de tokens; botões: "Adicionar termo", "+", "−", "×", "÷", "(", ")", "Remover".
- Cada `termo` renderiza chips de contas com sinal individual (+/−) e um botão "Escolher contas" que abre popover da árvore do plano (reaproveita `TermoSelector` já existente, adaptado).
- Preview textual da fórmula: `( [Desp Adm] − [INSS] ) ÷ [Receita]`.
- Validação inline (erros em vermelho abaixo).

`src/components/indicadores/indicador-editor-dialog.tsx`
- Dialog com: nome, categoria, descrição, `FormulaBuilder`, modo de análise, faixas opcionais.
- Botão Salvar (insert/update).

`src/components/indicadores/duplicar-dialog.tsx`
- Passo 1: select de empresa de origem (do mesmo tenant).
- Passo 2: lista de indicadores dessa empresa com checkboxes.
- Ao confirmar: insert de cópias com `company_id` atual; valida se contas existem no plano-alvo → marca `revisar_contas=true` quando faltar.

`src/components/indicadores/indicadores-empresa-panel.tsx` (substitui o atual `indicadores-config-panel.tsx`)
- Header: botões `[+ Criar Indicador]` e `[Duplicar de outra empresa]`.
- Lista de indicadores (card por linha) com: nome, categoria, fórmula renderizada, modo, prévia (últimos 3 períodos calculados via engine), select de visibilidade, badge "Revisar contas" quando aplicável, ações Editar/Duplicar/Excluir.

`src/routes/admin.empresas.$id.dados.tsx`: troca import do panel antigo pelo novo.

## 4. Seed dos padrões

Ao abrir a aba com zero indicadores E com plano já importado, disparar seed client-side inserindo indicadores padrão de `INDICADOR_DEFS` traduzidos para o novo formato (`formula.expressao`), com contas sugeridas quando encontradas por match de descrição no plano; caso contrário, contas vazias + `revisar_contas=true`. `is_padrao=true`.

## 5. Visão do cliente

`src/routes/dashboard.indicadores.tsx`
- Passa a ler `indicadores_empresa` (visibilidade ∈ {indicadores, ambos}) da empresa atual.
- Calcula com o novo engine usando `plano_contas` + `saldos_mensais` dos períodos selecionados.
- Sem botões de configuração. Faixas do próprio indicador determinam a cor.

`src/routes/dashboard.index.tsx` (Dashboard)
- Se já mostra indicadores, filtrar por visibilidade ∈ {dashboard, ambos}. Se não mostrar, adicionar seção "Indicadores em destaque" simples (grid compacto).

## 6. Fora do escopo desta entrega

- Remoção da tabela `indicador_config_empresa` (mantém por compatibilidade; podemos limpar depois).
- Editor visual de faixas com sliders (usaremos inputs numéricos simples).
- Fórmulas com funções (ABS, IF, MÉDIA) — apenas +, −, ×, ÷ e parênteses nesta versão.

## Detalhes técnicos

- Todo cruzamento usa `classificacao` (código estruturado) do `plano_contas`, não `descricao`.
- Sintética = `is_sintetica=true`; expansão via `descendeDe` da máscara.
- Saldo do período de conta de resultado = movimento do mês; conta patrimonial = saldo acumulado (mesma regra de `build-statements`).
- RLS: `orkestria_admin` vê tudo; `tenant_admin` só do próprio tenant; cliente só leitura das visíveis da própria empresa.
