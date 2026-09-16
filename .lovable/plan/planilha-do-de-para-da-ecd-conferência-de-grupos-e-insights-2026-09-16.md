# Planilha do de-para da ECD, conferência de grupos e Insights

Quatro entregas na aba **3. ECD (períodos anteriores)** da configuração da empresa e no cartão de análise do painel.

## 1. Exportar o de-para em Excel

Novo botão **Baixar planilha do de-para** na barra de ações da aba ECD. O arquivo sai com duas abas:

**Aba "De-para"** — todas as contas do plano trazido pela ECD, na mesma ordem/hierarquia do arquivo (caminho da conta, nível, tipo, natureza), inclusive as que ainda não têm destino:

| Coluna | Conteúdo |
| --- | --- |
| Conta (ECD) | código da conta no arquivo |
| Classificação | classificação estrutural quando o arquivo traz |
| Descrição | nome da conta |
| Caminho | galho ("Ativo › Imobilizado") |
| Nível / Tipo / Natureza | como vem da ECD |
| Movimento / Saldo final | para priorizar o que importa |
| Conta destino | código no plano padrão (vazio = não alocada) — **coluna editável** |
| Descrição destino | nome da conta de destino, só leitura |
| Ignorar | "sim" quando a conta foi marcada como ignorada — **coluna editável** |
| Situação | alocada / pendente / ignorada |
| Origem | como o vínculo foi criado (manual, automático, grupo) |

**Aba "Plano padrão"** — o plano de destino sem contas de clientes/fornecedores (exclui participantes), com código, classificação, descrição, tipo, natureza e nível, para consulta ao preencher.

## 2. Importar a planilha preenchida

Botão **Importar planilha do de-para** ao lado. Lê a primeira aba (ou a que tiver as colunas "Conta (ECD)" e "Conta destino"), aceita .xlsx e .csv, e antes de gravar mostra um resumo: quantos vínculos novos, alterados, removidos e ignorados, além de erros por linha (conta que não existe na ECD, destino que não existe no plano, destino que é conta sintética ou de cliente/fornecedor). Linhas com erro não são gravadas; o resto grava em lotes pela mesma rotina já usada pela tela (`aplicar_depara_em_lote`), então o resultado é idêntico a ter editado na tela.

## 3. "Conferir grupos" sem estourar o tempo

Hoje a conferência calcula, antes de qualquer coisa, a melhor conta de destino para **todas** as contas da ECD, comparando palavra por palavra com todo o plano — é esse cálculo que estoura o tempo limite. Como a conferência só precisa listar as contas que estão fora do grupo (no máximo 500), a ordem passa a ser: primeiro achar as contas fora do grupo, depois calcular a sugestão apenas para essas. O botão "Realocar por grupo" continua calculando tudo, como hoje.

## 4. Lentidão do Orkestria Insights

A análise lê hoje todas as linhas de demonstração da empresa do ano inteiro, monta o texto completo da DRE e só então chama a IA. Passa a ler apenas os períodos selecionados e apenas as linhas de totais, e o resultado fica guardado por empresa + período, de forma que reabrir o painel não recalcula.

## Detalhes técnicos

- Nova migration com `ecd_alocar_por_grupo` reescrita: no modo `_so_conferir`, `_fora` é apurado antes e `_cand`/`_alvo` são restritos aos códigos dessa lista; modo de gravação inalterado. Índice em `_grp(grupo_classificacao)`.
- Novo `src/lib/ecd/planilha-depara.ts`: `carregarLinhasDepara`, `montarWorkbookDepara`, `gerarPlanilhaDepara`, `lerPlanilhaDepara` (tolerante a acento/maiúscula nos cabeçalhos), `validarLinhas` e `importarDeparaEcd` — mesmo padrão de `src/lib/dfc/planilha.ts` (xlsx + `baixarArquivo`/`textoDoArquivo`).
- Novo `src/components/ecd/planilha-depara-botoes.tsx` com os dois botões e o diálogo de resumo/erros; montado na barra de ações de `ecd-panel.tsx`, invalidando `["ecd-depara", companyId]` ao fim.
- `insights.functions.ts`: filtro `.in("periodo", periodos)` + `is_subtotal`/`linha_ordem`, limite de linhas no prompt; `insights-card.tsx` passa a usar `useQuery` com chave `["insights", companyId, periodos]`, `staleTime` longo e botão Atualizar forçando refetch.
