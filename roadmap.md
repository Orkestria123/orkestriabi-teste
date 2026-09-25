# Roadmap — ajustes BI (25/09/2026)

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
