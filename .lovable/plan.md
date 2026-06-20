## Diagnóstico

- A conta Fornecedores existe no backend e tem saldo:
  - Saldo inicial de fornecedores: **R$ 7.491.455,42** no passivo.
  - Em jan/2025, após movimentos, fica aproximadamente **R$ 6.726.755,62**.
- O Balanço aparece vazio na tela porque o filtro está selecionado em **2026**, enquanto os períodos disponíveis da empresa são apenas **2025-01 a 2025-12**.
- Há também um risco na montagem da árvore: os fornecedores participantes estão em `2.01.01.01.01.01`, mas não existe conta estrutural exatamente nesse último nível; por isso a descrição pode cair para classificação em vez de consolidar claramente sob a conta-pai `FORNECEDORES NACIONAIS` / `FORNECEDORES`.

## Plano de correção

1. **Corrigir sincronização do filtro de períodos**
   - Ajustar o `PeriodSync` para, ao carregar os períodos disponíveis da empresa, selecionar automaticamente o ano mais recente com dados quando o ano atual não possui dados.
   - Garantir que a página não permaneça em 2026 quando só existe 2025.

2. **Melhorar consolidação visual de participantes no BP**
   - Ajustar a montagem da árvore do Balanço para não criar/rotular o nível analítico dos participantes individualmente.
   - Consolidar participantes no prefixo estrutural existente mais próximo, mantendo o saldo somado em Fornecedores, sem listar os 103 fornecedores.

3. **Validar com os dados reais**
   - Conferir que, em 2025, o Passivo Circulante carrega valores.
   - Conferir que Fornecedores aparece consolidado no Passivo Circulante.
   - Conferir que o Balanço deixa de ficar vazio por seleção indevida de 2026.

## Arquivos previstos

- `src/routes/dashboard.tsx`
- `src/lib/diario/build-statements.ts`