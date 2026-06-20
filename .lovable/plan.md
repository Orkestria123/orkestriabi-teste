## Objetivo

Hoje "Ativo Não Circulante" mostra o total correto (R$ 15.984.736,54), mas seus filhos (Realizável a Longo Prazo, Investimentos, Imobilizado, Intangível) aparecem como linhas irmãs no mesmo nível de indentação. Precisamos que fiquem recuados e expansíveis abaixo do pai, igual ao comportamento do "Ativo Circulante".

## Mudança (arquivo: `src/lib/diario/build-statements.ts`, função `buildBP`)

No loop que monta as linhas por período (linhas ~651-670):

1. Para cada `linha` que é filho estrutural (`childSet.has(linha)`), reordenar para que suas rows fiquem imediatamente depois do header do pai e antes da próxima linha-mãe:
   - Calcular `base` do filho como `parentOrdem * 1000 + (10 + indexDoFilho) * 10`, onde `parentOrdem` é o `ordem` da linha "Ativo Não Circulante" e `indexDoFilho` é a posição do filho na lista `STRUCT_GROUPS[parent]`.
   - Isso garante que `linha_ordem` dos filhos caia entre o header do pai e a próxima linha de topo.

2. Para cada row emitida de um filho estrutural, somar `+1` ao `nivel` (recuo visual) — o header do filho vira nível 1, suas sub-rows nível 2, etc.

3. Marcar o header do pai estrutural como `is_subtotal: true` (já é, mas garantir) para manter o visual de pai expansível. O componente de árvore já usa `nivel` para indentar e detectar filhos pela diferença de nível subsequente — não requer mudança no componente.

4. Manter a agregação atual de `parentValor` (que já está somando corretamente) e a soma de `totalLado`.

## Resultado esperado

```
> Ativo Circulante                       R$ 2.462.497,34
v Ativo Não Circulante                  R$ 15.984.736,54
    Realizável a Longo Prazo                   R$ 0,00
  > Imobilizado                        R$ 15.955.184,83
  > Investimentos                          R$ 29.551,71
    Intangível                                 R$ 0,00
  Total do Ativo                       R$ 18.447.233,88
```

## Fora de escopo

- Não alterar Passivo nesta rodada (usuário escolheu apenas Ativo).
- Não mexer em DRE/DFC/DLPA/DVA.
- Não alterar componentes de UI da árvore.
