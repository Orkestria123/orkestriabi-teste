# Roadmap — ajustes BI (25/09/2026)

## Dal Mobile e fórmulas de custos — 22/10
- [ ] Validar e corrigir diferenças gerenciais de janeiro/fevereiro (R$ 310.300,00) e botão Atualizar Demonstrações
- [ ] Fórmulas editáveis de linhas calculadas, categoria própria e exceções por empresa com visibilidade; incluir CPV específico da Dal Mobile

## Percentuais — 19/10
- [x] Padronizar indicadores percentuais com duas casas em todas as telas, Dashboard e exportações; sete testes e Dashboard/Indicadores reais conferidos sem erros

## Capital de Giro — 19/10
- [x] Fórmula da Open inclui Adiantamento Diversos e Créditos Diversos sem duplicidade; agosto conferido no BI: R$ 26.510.294,05; três testes aprovados

## Comparativo no relatório executivo — 19/10
- [x] Gerar relatório em Comparativo quando houver Contábil e Gerencial, com diferenças destacadas; 32 testes e PDF real Dal Mobile/demo conferidos sem salvar ou enviar relatórios

## Rentabilidade mensal — 18/10
- [x] Revisar relatório executivo: contas BP/DRE, destaques independentes, DFC sem fornecedores duplicados, caixa nominal, EBIT e retirada das notas; testes e PDF real Casa do Vidro conferidos
- [x] Corrigir ROA/ROE mensais para lucro da DRE do próprio mês sobre Ativo/PL do mesmo mês e validar com testes e consulta real

## Demonstração pública — 18/10
- [x] Criar base estática descaracterizada da empresa de referência, sem identificação ou acesso às bases privadas
- [x] Demo aberta com visão do cliente, demonstrações, análise, indicadores e Consolidado Empresas compartilhados
- [x] Relatório executivo Modelo Ltda. e exportações; verificar navegação anônima e privacidade

## Comparativo e exportações — 18/10
- [x] Acrescentar e conferir a visão Sintéticas nos links do PDF
- [x] Comparativo Contábil/Gerencial lado a lado e diferença em vermelho
- [x] PDF e Excel da visão consultada, incluindo análises e totalizadores
- [x] PDF com todas as colunas e navegação entre detalhamentos; consulta real e downloads conferidos na Beltrami

- [x] ECD: DRE em meses com encerramento (causa: diário da ECD gravado pela metade → mês caía no saldo I155)
- [x] ECD: histórico (drill-down agora acha contas específicas da empresa; envio do diário com repetição)
- [x] Renomear aba para "ECD"
- [x] PE: valores líquidos com sinal + fixo/variável inferido quando não marcado
- [ ] Reaplicar ECD jan–set/2025 da Mackerduz ("Reler arquivo" + "Aplicar") — depende do usuário
- [x] Alocação de contas do diário (quadro volta, só da empresa, sem ECD)
- [x] Upload .xlsx grande de diário (lotes com repetição, prazos maiores, índice)

## Contas específicas / de-para (set/2026)
- [x] Conta específica só via sintética do Padrão, código automático PREFIXO-NNNN, DFC e custo/despesa
- [x] Excluir conta criada (zera vínculos do de-para)
- [x] Contas criadas aparecem como destino no de-para
- [x] Revinculação atualiza demonstrações (cache + botão "Atualizar demonstrações" na ECD)
- [x] Aviso de encerramento removido da ECD
- [x] Mais tempo para cargas grandes (120s geral, 300s nas etapas da ECD/diário)

## Rodada 29/09
- [x] Atualizar demonstrações após revincular (só refaz diário das contas tocadas)
- [x] DFC com contas criadas por empresa (Mackerduz MAC-0001 a partir de 06/2026)
- [x] Duplicar ajuste gerencial
- [x] Conta transitória "Ajustes Gerenciais" (AJG) fora de BP/DRE, só na visão gerencial
- [x] Lançamentos gerenciais: contas criadas da empresa no seletor (lista + busca RPC)
- [x] Editar contas criadas (Pencil em Contas específicas de empresa)
- [x] DFC Casa do Vidro: fechamento conferido no banco (Σ movimento = 0 em todos os meses)
- [x] DRE: "Custo de Materiais dos Produtos" logo abaixo de "Custo dos Produtos Vendidos" (e equivalente p/ mercadorias)

## Rodada 02/10
- [x] Capital de Giro: fornecedores/clientes próprios da empresa entram no cálculo (e cliente com várias empresas lê os dados)
- [x] DRE: Deduções exibidas dentro da Receita Bruta (só visual)
- [x] DRE: Custo de Materiais logo após o bloco do CPV/CMV também quando o bloco tem uma linha só
- [x] DFC Casa do Vidro: depreciação contada duas vezes (DRE + Balanço) — agora fecha

## Rodada 10/10
- [x] Replicar estrutura Open → Beltrami conferida (1.250 contas, 74 vínculos DFC, 19 indicadores); publicado
- [x] PDF de exemplo Casa do Vidro (ago/26) entregue para validação
- [x] Relatório executivo no app: configuração geral (engrenagem) + escolha por empresa, botão no BI, capa/tenant/empresa/demonstrações/indicadores/comparativo, cores Open, texto por IA

## Revisão do modelo executivo — 11/10
- [x] PDF v4: recuperar visual v2, ampliar notas explicativas e validar todos os destinos do sumário
- [x] PDF v4: usar logo cadastrado da Open e imagem do cadastro/perfil da Casa do Vidro
- [x] PDF v3 Casa do Vidro: DFC conciliada, detalhamento inspirado na IBE, fórmulas, prazos, notas, sumário clicável, glossário de uma página e texto formal justificado; 18 páginas inspecionadas
- [ ] Completar faturamento de 12 meses — depende da importação de setembro a dezembro/2025 da Casa do Vidro; versão v3 identifica esses meses como N/D

- [x] Relatório Executivo no app (padrão na engrenagem, gerar/editar por empresa, disponibilizar no BI + e-mail com confirmação) — textos pela Perplexity
- [ ] Envio dos e-mails do relatório — aguarda o domínio de e-mail do escritório

## Fidelidade ao relatório V4 — 12/10
- [x] Reproduzir apresentação V4: BP lado a lado, DRE sintética com acumulado, custos, caixa, PL, indicadores agrupados e notas ampliadas
- [x] Faturamento V4: tabela RB/RL de 12 meses, cobertura, totais e gráfico compacto; ausências como N/D
- [x] Conferir PDF real da Casa do Vidro e links internos sem disponibilizar ou enviar e-mails

## Caixa das linhas do relatório — 19/10
- [x] Linhas em CAIXA ALTA do plano (Gastos…) apresentadas em título como as demais; siglas preservadas; testes e PDF real conferidos

- [x] DRE: linha calculada de Custo de Materiais/Mercadorias logo após a sintética de custos, antes das analíticas
- [x] Aquafast 2025: encerramento da ECD sem diário (contrapartida em Lucros Acumulados) e reclassificações mensais
- [x] Lançamentos gerenciais: botão "Atualizar Demonstrações" e marcação "Movimenta a DFC" (desmarcado = fora só da DFC); testes e painel conferidos na tela
