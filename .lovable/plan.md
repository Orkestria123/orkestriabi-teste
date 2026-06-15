Diagnóstico encontrado:

- O arquivo foi importado corretamente: 97.245 lançamentos, 4.779 saldos mensais, 974 contas, jan-dez/2025.
- O mapeamento existe: 17 linhas DRE, 10 BP Ativo, 10 BP Passivo.
- Teste direto no banco aplicando o mapeamento trouxe valores reais na DRE, por exemplo jan-jun/2025:
  - Receita Bruta: R$ 22,6 mi
  - Custos dos Serviços: R$ 13,2 mi
  - Deduções: R$ 8,25 mi
- Porém a tela continua zerada porque o cálculo no frontend está lendo tabelas grandes sem paginação suficiente. O limite padrão corta `saldos_mensais`/`plano_contas`, então o BI monta as linhas pelo mapeamento, mas não encontra os saldos correspondentes e exibe R$ 0,00.

Plano de correção:

1. Corrigir a leitura dos saldos do diário
   - Atualizar `src/lib/diario/build-statements.ts` para buscar `saldos_mensais` com paginação/chunks, não apenas a primeira página.
   - Aplicar isso tanto para DRE/DFC quanto para BP acumulado.

2. Corrigir a leitura do plano usado no cálculo
   - Evitar carregar o plano inteiro de 135 mil linhas.
   - Buscar somente as contas necessárias para os saldos encontrados, em lotes por `codigo`.
   - Manter o filtro por empresa/tenant e `ativo=true`.

3. Ajustar o cálculo para não zerar silenciosamente
   - Se houver saldos e mapeamento, mas nenhuma conta casar com o plano/mapeamento, retornar um aviso técnico no console ou estrutura de diagnóstico para facilitar depuração.
   - Preservar o formato atual esperado pela tabela do BI.

4. Revisar mapeamentos salvos
   - Manter os mapeamentos atuais, pois o teste direto mostra que eles geram valores.
   - Só ajustar se, após a correção de leitura, ainda aparecer alguma linha contábil relevante sem cobertura.

5. Validar no preview
   - Abrir `/dashboard/dre?company=13215792-617c-4334-be1c-e65e2442e178`.
   - Confirmar que Receita Bruta, Deduções, Custos e Resultado deixam de aparecer zerados.
   - Conferir também BP Ativo/Passivo, pois sofrem do mesmo problema de leitura parcial.