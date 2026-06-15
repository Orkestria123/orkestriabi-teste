# Plano: Salvar conhecimento sobre alertas de validação CPC

## Objetivo
Persistir em `mem://features/alertas-validacao-cpc` a explicação dos três alertas que aparecem nas demonstrações, para que em futuras conversas eu possa orientar o cliente sem precisar reexplicar.

## O que será salvo

**Arquivo:** `mem://features/alertas-validacao-cpc`
**Tipo:** `feature`
**Conteúdo:**

### 1. DVA — "Geração diferente da distribuição (CPC 09)"
- **Regra CPC 09:** total de Geração de Valor Adicionado = total de Distribuição.
- **Componentes Geração:** Receitas − Insumos adquiridos de terceiros − Depreciação + VA recebido em transferência.
- **Componentes Distribuição:** Pessoal + Impostos/Taxas + Remuneração de Capitais de Terceiros + Remuneração de Capitais Próprios.
- **Quando dispara:** soma das duas seções diverge (tolerância 0,01).
- **Causas comuns:** conta não mapeada em `DVA_*`, prefixo padrão não bate com plano da empresa, lucro líquido do exercício não fechando com DRE.

### 2. DLPA — "Saldo final divergente"
- **Regra:** saldo final de Lucros/Prejuízos Acumulados calculado pela movimentação (saldo inicial + lucro − reservas − dividendos) deve igualar o saldo da conta `2.05.01.09` no Balanço Patrimonial do período.
- **Quando dispara:** divergência > 0,01 entre saldo movimentado e saldo contábil.
- **Causas comuns:** saldo de abertura ausente, dividendos/reservas lançados em contas fora do padrão, conta de lucros acumulados com prefixo diferente.

### 3. DFC — "Divergência na variação de caixa (CPC 03)"
- **Regra (método indireto):** Caixa Operacional + Caixa de Investimento + Caixa de Financiamento = Caixa Final − Caixa Inicial (variação real das contas com prefixo `1.01.01`).
- **Quando dispara:** soma das 3 atividades ≠ variação efetiva do caixa.
- **Causas comuns:** lançamento de caixa classificado incorretamente, depreciação/amortização não identificada por palavra-chave, ausência de saldo inicial de caixa.

### Orientação ao cliente (resumo amigável)
> Esses alertas não são erros do sistema — são checagens automáticas exigidas pelos CPCs. Eles indicam que as demonstrações ainda não estão "fechando" contra o Balanço Patrimonial. Geralmente significa:
> 1. Falta saldo de abertura do período anterior;
> 2. Alguma conta do plano não está mapeada nos tipos da demonstração;
> 3. O prefixo padrão (ex.: caixa `1.01.01`, lucros acumulados `2.05.01.09`) não corresponde ao plano específico da empresa.
>
> Para resolver: revisar o mapeamento da empresa em **Configurações > Mapeamento de Demonstrações** e garantir que o período anterior foi importado.

## Atualização do índice
Acrescentar em `mem://index.md`, seção **Memories**:
- `[Alertas de validação CPC](mem://features/alertas-validacao-cpc)` — Significado dos alertas DVA/DLPA/DFC, regras CPC, causas comuns e orientação ao cliente

## Arquivos afetados
- `mem://features/alertas-validacao-cpc` (novo)
- `mem://index.md` (atualizar lista de Memories)

Nenhuma alteração em código.
