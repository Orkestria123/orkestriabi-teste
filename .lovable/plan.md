# Plano — Estrutura Hierárquica, Saldo Inicial e Máscara Configurável

Vou executar em **4 fases** para entregar valor incrementalmente. Cada fase é independente e testável.

---

## Fase 1 — Correção crítica do bug de participantes + Saldo Inicial

**Por que primeiro:** é a causa do balanço não fechar (R$ 1,54 mi de clientes + R$ 7,49 mi de fornecedores sumindo). Resolve o problema de negócio mais urgente.

**Mudanças de schema (migration):**
- `saldos_iniciais` (company_id, conta_codigo, classificacao, data_referencia, saldo, valor_origem, is_participante, upload_id)
- `saldo_inicial_uploads` (filename, data_referencia, total_contas, total_ativo, total_passivo_pl, equilibrado, status)
- `ALTER plano_contas ADD is_sintetica boolean, conta_pai_classificacao text`

**Código:**
- `src/lib/saldo-inicial/parse-balancete.ts` — parser do CSV (UTF-8 BOM, `;`, detecção de colunas por alias, processa SÓ analíticas `Cta. título=2-Não` incluindo participantes tipos 4-7)
- `src/lib/saldo-inicial/sinal.ts` — `saldoPadronizado(valor, classif)`: Ativo (grupo 1) mantém, Passivo/PL (grupo 2) inverte
- `src/routes/admin.empresas.$id.saldo-inicial.tsx` — upload + preview + validação de equilíbrio + gravação
- Patch no parser do plano de contas: setar `is_sintetica` (`Cta. título=1-Sim`) e `conta_pai_classificacao` (derivado da classificação)
- Patch em `src/lib/diario/build-statements.ts` `buildBP`: saldo final = saldo_inicial + Σ movimentos do diário (DRE não muda)

**Validação:** subir o arquivo `Transpio_Balanço.csv` (198 linhas, Ativo = Passivo = R$ 18.991.489,71), conferir badge "Balanço fecha".

---

## Fase 2 — Hierarquia e árvore expansível no Balanço

**Mudanças:**
- `src/lib/hierarquia/montar-arvore.ts` — `montarArvore(contas)`: vincula filhos via `conta_pai_classificacao`, sintética soma analíticas descendentes
- `src/components/demonstracoes/arvore-contas.tsx` — componente recursivo com chevron, indentação 16px/nível, sintéticas em negrito
- Refatorar `BalancoPanel` para renderizar a árvore (nível inicial expandido configurável, padrão = 3)
- Consolidação: participantes (tipos 4-7) somam na conta-pai analítica imediata e a exibição mostra só até a conta estrutural (não lista 113 mil clientes individualmente)

---

## Fase 3 — Máscara de Classificação Configurável

**Schema:**
- `mascara_classificacao` (tenant_id, company_id NULL=global, separador, mascara, niveis jsonb, larguras int[])

**Código:**
- `src/lib/mascara/interpretar.ts` — `interpretarClassificacao(classif, mascara)`: parsing com separador OU larguras fixas, retorna `{nivel, grupo, prefixo_ate_nivel, pai}`
- Refatorar TODO uso de `.split('.')` e `classificacao.charAt(0)` para usar `interpretarClassificacao()` (parsers, hierarquia, montagem das demonstrações)
- `src/routes/admin.empresas.$id.mapeamento.tsx` — nova aba "Máscara de Contas" com preview ao vivo usando uma classificação real do arquivo

---

## Fase 4 — Aba unificada "Dados Contábeis"

`/admin/empresas/:id/dados-contabeis` — agrega os 5 passos (Plano, Máscara, Saldo Inicial, Mapeamento, Diários) com status visual e badge "Balanço fecha".

---

## Início imediato

Começo pela **Fase 1** agora (é a que destrava o BI e usa o arquivo que você acabou de enviar). As fases 2-4 ficam para os próximos turnos — me confirme depois de validar a Fase 1 com o balanço fechando.

## Regras inquebráveis aplicadas em todas as fases

- Só analíticas (`Cta. título=2-Não`) carregam saldo
- Participantes SOMAM no saldo inicial e diário — filtro só na exibição
- Saldo = Σ débitos − Σ créditos (já corrigido em turnos anteriores)
- Encoding dinâmico (saldo inicial = UTF-8 BOM; plano = Latin-1)
- BP = inicial + Σ movimentos; DRE não usa inicial
- Badge "Balanço fecha" sempre visível
