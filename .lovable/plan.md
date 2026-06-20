## Diagnóstico

Em `emitirArvoreBP` (src/lib/diario/build-statements.ts:296), a profundidade inicial da árvore é:

```ts
const profMin = Math.min(...pontos.map((p) => nivelDe(p.classificacao, mascara)));
```

Como `pontos` contém apenas **contas analíticas** (folhas), `profMin` acaba sendo o nível das próprias folhas (5 ou 6 no plano da Transpio). O loop:

```ts
for (let level = profMin; level <= parts.length; level++) {
```

começa em `profMin = 5`, então **não emite os níveis 2, 3 e 4** (CIRCULANTE, DISPONIVEL, BANCOS CONTA MOVIMENTO, CLIENTES, etc.). Resultado: a "árvore" aparece como lista plana de folhas sob a linha mapeada — sem chevrons, sem hierarquia visível. É exatamente o que o usuário vê no Balanço.

Confirmação com o CSV anexado (`Transpio Balanço.csv`):
- Folhas como `1.01.01.01.01 CAIXA` (nível 5) e `1.01.02.01.01.01 CLIENTES` (nível 6) coexistem
- `profMin = 5` → níveis 1–4 ("ATIVO", "CIRCULANTE", "DISPONIVEL", "CAIXA GERAL", "CLIENTES") são pulados
- A árvore esperada exibiria, por baixo da linha mapeada, os agrupamentos estruturais (DISPONIVEL → CAIXA GERAL → CAIXA, etc.)

## Correção

### 1. `src/lib/diario/build-statements.ts` — `emitirArvoreBP`

Começar a árvore no **nível do prefixo comum** do bucket (Longest Common Prefix), não no nível mínimo das folhas:

```ts
function commonPrefixLen(classifs: string[], mascara: MascaraConfig): number {
  if (classifs.length === 0) return 1;
  const split = classifs.map((c) => dividir(c, mascara));
  const min = Math.min(...split.map((s) => s.length));
  let n = 0;
  outer: for (let i = 0; i < min; i++) {
    const seg = split[0][i];
    for (const s of split) if (s[i] !== seg) break outer;
    n++;
  }
  return Math.max(1, n);
}
```

Substituir `profMin` por `commonPrefixLen(pontos.map(p => p.classificacao), mascara)`. Isso garante que **todos os níveis intermediários** entre o ancestral comum e cada folha sejam emitidos como nós com chevron.

### 2. Opcional — colapsar nó intermediário redundante

Quando um nó tem exatamente 1 filho com o mesmo valor, evitar o ruído visual (ex.: "CAIXA GERAL → CAIXA" quando só existe CAIXA). Implementar no `walk()` pulando esses intermediários.

### 3. Validação

- Carregar o CSV de teste como saldo inicial (já existe parser)
- Após o build do BP, verificar que a árvore exibe: ATIVO > CIRCULANTE > DISPONIVEL > CAIXA GERAL > CAIXA / BANCOS CONTA MOVIMENTO > [bancos]
- Confirmar somas: `CREDITOS` = 2.583.417,87; `CLIENTES` = 1.539.255,93; Total Ativo = 18.991.489,71

### 4. Não alterar

- `emitirHierarquia` já delega para `emitirArvoreBP` (DRE/DFC/DLPA/DVA) — recebem o mesmo benefício automaticamente.
- `StatementTable` já calcula `childrenMap` por `nivel` — basta termos níveis intermediários presentes.
- `initialExpandLevel={3}` já está em todos.

## Arquivos editados
- `src/lib/diario/build-statements.ts` (função `emitirArvoreBP` e novo helper `commonPrefixLen`)
