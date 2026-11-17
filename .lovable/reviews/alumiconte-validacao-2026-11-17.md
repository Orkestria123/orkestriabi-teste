# Alumiconte — conferência ECD e BI

## Correção
Os saldos da ECD já são gravados com os códigos de destino. O motor aplicava novamente o de-para do Diário, confundindo códigos iguais de planos diferentes. Exemplo: as vendas aplicadas na conta 1009 eram desviadas para 5204 (despesa financeira), porque 1009 também é código de origem de outra conta da ECD. A mesma falha afetava saldos acumulados e abertura.

Correção por proveniência (`origem_ecd`), sem modificar arquivos, valores ou vínculos. Cache das demonstrações atualizado. Oito testes aprovados. DRE 2025 consultada na tela autenticada com os 12 meses.

## Fechamento anual
Valores em reais; diferenças BP inferiores a um centavo.

| Ano | Resultado DRE = ECD | Ativo = Passivo + PL em dezembro |
|---|---:|---:|
| 2020 | 1.695.149,61 | 71.809.661,80 |
| 2021 | 8.176.428,55 | 90.087.282,56 |
| 2022 | 15.908.461,03 | 118.832.859,66 |
| 2023 | 10.379.356,52 | 105.793.872,58 |
| 2024 | 6.602.240,88 | 123.792.348,45 |
| 2025 | 7.032.027,94 | 123.625.030,78 |

Em 2025, a conciliação por conta de destino e mês entre I250 sem encerramento e saldos aplicados retorna zero diferenças nos débitos e créditos. Isso confirma a aplicação, não a adequação de cada classificação.

## DRE 2025 recalculada — principais totais
Receita Bruta: 235.452.711,27; devoluções: (3.280.459,77); deduções: (49.822.328,26); Receita Líquida: 182.349.923,24; CPV: (147.605.241,38); CMV: (40.132,80); Lucro Bruto: 34.704.549,06; despesas operacionais: (24.747.547,10); resultado financeiro: (3.125.342,84); EBIT: 10.449.044,80; EBITDA: 14.043.811,58; resultado antes de IR/CSLL: 7.342.977,50; CSLL: (106.621,17); IRPJ: (204.328,39); lucro líquido: 7.032.027,94.

Somar as linhas de lucro e prejuízo dos meses, e não apenas meses positivos, para conferir o resultado anual.

## Grupos: diferenças de alocação encontradas
Não afirmar que os grupos estão iguais à ECD: resultado total igual não implica igualdade de classificação.

| Grupo de origem ECD | Valor fora do grupo equivalente no BI | Destino atual |
|---|---:|---|
| 30008 — impostos sobre vendas | (26.794,14) | Despesas operacionais, ICMS s/remessas |
| 30012 — deduções de compras | (10.110,45) | Despesas operacionais, ICMS s/remessas |
| 30017 — gastos gerais de fabricação | (134.906,12) | Despesas administrativas (bens pequenos, conservação de móveis e informática) |
| 30018 — despesas administrativas | (36.630,01) | Custos de fabricação (análises químicas, fretes e manutenção de máquinas) |
| 30019 — despesas de vendas | (10.053,68) | Custos de fabricação (manutenção de máquinas) |
| 30023 — receitas financeiras | 396.138,26 | Conta origem 920, AMORTIZACAO E DESAGIO, destino 4959 AMORTIZAÇÕES, 3.06.01.02.15 |
| 30033 — outras receitas | (540,24) | Resultado financeiro (PIS/COFINS) |
| 30033 — outras receitas | 19.275,54 | Outros resultados (venda de imobilizado) |

ECD Resultado Financeiro: (2.728.664,34), versus BI (3.125.342,84): diferença (396.678,50), composta por 396.138,26 de amortização/deságio fora do financeiro e 540,24 de PIS/COFINS vindo de outras receitas.

A organização Open separa devoluções de deduções; para comparar com a ECD, considerar os dois blocos conjuntamente. Há diferenças adicionais de subclasses dentro do CPV e entre CMV/CPV por uso do plano padronizado. Vínculos mantidos: revisão da classificação é uma decisão contábil distinta da correção do motor.

## Limites
Conferência contra registros ECD persistidos (I050/I155/I250), sem novo TXT/J150 anexado nesta solicitação. Aplicação 2025 conferida conta/mês; fechamento anual conferido para todos os anos importados. Alteração ainda não publicada no endereço de produção.