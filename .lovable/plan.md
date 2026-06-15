Diagnóstico rápido: não parece ser falta de carregamento dos saldos. A empresa tem saldos mensais importados e o Balanço já está trazendo valores. O problema principal é que o montador atual agrupa tudo por linha de mapeamento, então a DRE/BP ficam “fechadas” em poucas linhas e não exibem a árvore do plano de contas.

Plano de correção:

1. Abrir a estrutura da DRE
   - Manter as linhas principais do mapeamento, como Receita Bruta, Deduções, Custos e Despesas.
   - Abaixo de cada linha, exibir as contas/grupos do plano de contas que compõem aquele valor.
   - Usar níveis reais do plano para permitir expandir/recolher na tabela.
   - Evitar mostrar clientes/fornecedores participantes para não poluir a DRE com milhares de linhas.

2. Abrir a estrutura do Balanço Patrimonial
   - Fazer o mesmo para Ativo, Passivo e Patrimônio Líquido.
   - Exibir grupos e subgrupos do plano abaixo de Ativo Circulante, Ativo Não Circulante, Passivo Circulante, Passivo Não Circulante e PL.
   - Manter os totais de Ativo e Passivo + PL no fim de cada lado.

3. Corrigir os subtotais da DRE
   - Ajustar Receita Líquida para subtrair deduções, não somar como receita.
   - Ajustar Lucro Bruto, Resultado Operacional e Lucro Líquido para respeitarem corretamente sinais de receitas, custos, despesas, IRPJ/CSLL e deduções.
   - Evitar duplicidade entre linha mapeada “Receita Líquida” e linha calculada “(=) Receita Líquida”.

4. Melhorar a montagem técnica dos dados
   - Continuar buscando saldos paginados, pois isso já resolveu a leitura incompleta.
   - Reaproveitar os saldos carregados para montar todos os períodos sem fazer excesso de chamadas ao backend.
   - Incluir somente contas com valor ou contas necessárias para manter a hierarquia.

5. Validar no preview
   - Conferir DRE com estrutura aberta e valores em Receita Bruta, Deduções, Custos e Despesas.
   - Conferir Balanço com Ativo/Passivo carregando em níveis detalhados.
   - Conferir se expandir/recolher funciona e se os totais batem com as linhas-filhas.