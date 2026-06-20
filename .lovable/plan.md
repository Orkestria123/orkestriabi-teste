Plano para corrigir o bug de Fornecedores no Passivo Circulante:

1. Ajustar a consolidação de participantes no Balanço
- No `buildBP`, participantes de fornecedores/clientes não devem virar linhas individuais nem depender da descrição de cada CNPJ.
- Vou consolidar contas `is_participante=true` no prefixo estrutural existente mais próximo do plano, por exemplo:
  - `2.01.01.01.01.01` → `2.01.01.01.01` ou `2.01.01.01`, conforme o nível estrutural existente.
- Isso mantém os 103 fornecedores somados, mas exibidos apenas na conta-pai consolidada.

2. Preservar valor e sinal corretos
- Manter a soma do saldo inicial + movimentos do diário.
- Manter inversão do Passivo via mapeamento (`inverter_sinal=true`), para o valor aparecer positivo no Balanço.
- Garantir que Fornecedores apareça dentro de `Passivo Circulante`.

3. Evitar duplicidade e linhas escondidas
- Consolidar por classificação-pai antes de emitir a árvore do BP.
- Evitar que múltiplos fornecedores com a mesma classificação gerem várias linhas com o mesmo código/descrição ou sejam colapsados de forma incorreta.

4. Validar com os dados reais
- Conferir que o saldo inicial de fornecedores continua somando R$ 7.491.455,42.
- Conferir que a árvore do Passivo contém `FORNECEDORES`/`FORNECEDORES NACIONAIS` com esse saldo consolidado no período inicial.
- Conferir que o Balanço fecha com Ativo = Passivo + PL quando os filtros apontam para o período com dados.