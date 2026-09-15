# Unificar o cálculo de EBIT e EBITDA

## Objetivo
Garantir que, em todas as empresas, a DRE, os cartões de indicadores e os indicadores dependentes usem exatamente as fórmulas globais cadastradas em **Admin → Indicadores**.

## Implementação
- Remover o atalho dos cartões de EBIT/EBITDA que reaproveita um valor antigo da DRE em vez de avaliar a fórmula cadastrada.
- Manter a hierarquia explícita: a fórmula de EBITDA pode referenciar EBIT, e essa referência recebe o resultado da fórmula global de EBIT da mesma empresa e período.
- Fazer o cache das demonstrações considerar a última alteração das fórmulas globais, invalidando automaticamente todas as empresas quando EBIT ou EBITDA forem editados.
- Preservar o cálculo por conta específica, sem expandir uma conta analítica para todas as contas da mesma classificação.
- Corrigir as fórmulas globais atuais do escritório Open para refletirem o que estiver efetivamente salvo na página administrativa, sem criar fórmulas locais por empresa.

## Validação
- Conferir Tecnosweb em janeiro/2026 e comparar o detalhamento dos termos com a fórmula exibida no admin.
- Verificar uma segunda empresa com plano diferente para confirmar consistência.
- Confirmar que DRE, cartão Ebit, cartão Ebitda, Margem Ebitda e Dívida Líquida/EBITDA recebem os mesmos valores-base.
- Validar compilação e erros da prévia.
