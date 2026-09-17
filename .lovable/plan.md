# Correções para empresas que usam a ECD como fonte

Investiguei os três pontos na Mackerduz (ECD out–dez/2025) e encontrei a causa de cada um.

## 1. Histórico do lançamento não aparece

O histórico existe no arquivo, mas está sendo lido da coluna errada da partida: hoje o sistema pega o campo do participante em vez do texto do histórico. Resultado: **todos os 174.748 lançamentos da Mackerduz ficaram com histórico vazio**.

Correção:
- Ler o campo correto do histórico da partida e, quando ele vier em branco, usar a descrição do histórico padronizado do próprio arquivo (tabela de históricos que a ECD traz).
- Depois da correção é preciso usar o botão "Reler arquivo" da aba ECD para as importações já feitas — só a releitura preenche o histórico do que já está gravado (não mexe em saldo).

## 2. Contas invertidas em dezembro (ex.: IRPJ da Mackerduz)

Em dezembro a ECD zera as contas de resultado com um lançamento de encerramento. Como o sistema não separava esse lançamento do movimento verdadeiro, ele usava uma regra de adivinhação pelo saldo inicial. Na conta "Imposto de Renda Pessoa Jurídica" o saldo inicial era zero (a despesa nasceu em dezembro), a regra escolheu o lado errado e a despesa de **R$ 229.429,70 entrou como receita** — daí o resultado distorcido.

Correção: quando a importação traz o diário (é o caso), usar o próprio lançamento para separar o movimento do encerramento, em vez de adivinhar pelo saldo. O arquivo já marca o encerramento, então a leitura passa a ser exata. Sem diário, mantém-se a regra por saldo, mas decidindo o lado pela natureza da conta de destino (receita/despesa) e não pelo sinal do saldo inicial.

## 3. Balanço somando o resultado do exercício duas vezes

Hoje o Balanço soma ao Patrimônio Líquido o resultado acumulado de janeiro até o mês exibido. Em quem vem da ECD isso duplica: no mês do encerramento a própria ECD já transferiu o resultado para a conta patrimonial, e o Balanço soma de novo — Ativo deixa de fechar com Passivo.

Correção: o resultado do exercício passa a ser acumulado **a partir do último zeramento da ECD**, não do início do ano. Assim:
- meses antes do encerramento: continua acumulando o ano (como hoje);
- mês do encerramento em diante: o valor já está no Patrimônio Líquido e a linha não soma de novo.

Validação: conferir Ativo = Passivo na Mackerduz em out, nov e dez/2025 e em uma empresa sem ECD, para garantir que nada mudou onde já estava certo.

## Detalhes técnicos

- `src/lib/sped-parser.ts` (`case "I250"`): histórico está em `fields[8]` (HIST); hoje lê `fields[9]` (COD_PART). Adicionar leitura de `I075` (COD_HIST/DESCR_HIST) e usar `fields[7]` como fallback.
- Migration alterando `ecd_aplicar`: no CTE `bruto`, quando existir `ecd_lancamento` da importação, obter débito/crédito por conta+competência somando `ecd_lancamento` com `NOT encerramento`; usar `ecd_debito_credito_dre` só como fallback, com o lado decidido pela `natureza` da conta de destino em `plano_contas`.
- Nova RPC `encerramentos_da_empresa(_company_id)` → competências com encerramento (a partir de `ecd_lancamento.encerramento` / contas de resultado zeradas nas importações aplicadas).
- `src/lib/diario/build-statements.ts` (`buildBP`, ~1632–1646): `inicioExerc` passa a ser o mês seguinte ao último encerramento ≤ ref, caindo para janeiro do ano quando não houver encerramento.
- Subir `VERSAO_CALCULO` em `src/lib/cache-demonstracoes.ts` para descartar demonstrações antigas em cache.
