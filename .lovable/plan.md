# Plano de implementação

## 1. Alternar tema claro/escuro (rápido)

- Adicionar tokens do tema claro em `src/styles.css` (`:root` claro + `.dark` para o tema atual).
- `ThemeProvider` em `src/hooks/use-theme.tsx` (persiste em `localStorage`, default = dark, respeita `prefers-color-scheme` na primeira visita).
- Botão sol/lua no header (`PortalShell`) com transição suave.
- Os tokens da identidade do tenant (cor primária) continuam funcionando em ambos os temas.

## 2. Análise de Fornecedores / Notas Fiscais (SPED Fiscal — EFD ICMS/IPI)

### Modelo de dados (nova migração)

Tabelas novas, todas multi-tenant (`company_id` + RLS por `get_my_tenant_id`):

```text
fiscal_participants        — cadastro de fornecedores/clientes (Bloco 0150)
  id, company_id, cnpj_cpf, nome, uf, municipio, tipo (F/C/A),
  primeira_operacao, ultima_operacao, total_entradas, total_saidas

fiscal_invoices            — notas fiscais (Registro C100)
  id, company_id, sped_file_id, participant_id, tipo (E=entrada/S=saída),
  modelo, serie, numero, chave_nfe, data_emissao, data_entrada_saida,
  valor_total, valor_produtos, valor_icms, valor_ipi, valor_pis, valor_cofins,
  cancelada

fiscal_invoice_items       — itens (Registro C170, opcional, carga limitada)
  id, invoice_id, num_item, codigo_produto, descricao,
  quantidade, unidade, valor_total, cfop, ncm
```

Reaproveita o bucket `sped-files` e a tabela `sped_files` (já tem coluna `tipo_arquivo`).

### Parser

- Novo `src/lib/sped-fiscal-parser.ts` lendo blocos: `0000` (período/CNPJ), `0150` (participantes), `C100` (NF) e opcionalmente `C170` (itens).
- Detecção automática: se o arquivo começa com `|0000|` e contém `EFD ICMS IPI` → fiscal; senão segue como contábil.

### Upload

- Tela `/admin/upload` ganha seleção/auto-detecção do tipo de SPED.
- Server function `processSpedFiscal` faz upsert em `fiscal_participants` e bulk insert em `fiscal_invoices`.

### Telas (sidebar do cliente)

Dois novos itens de menu:

- `/dashboard/fornecedores` — Análise de fornecedores
  - KPIs: total de fornecedores, total de entradas no período, ticket médio, concentração (top 5 = X%).
  - Ranking top 20 com volume, nº de notas, ticket médio, participação.
  - Gráfico de pizza/donut com concentração (top 10 + Outros).
  - Filtro por período (reaproveita `FilterBar`).
  - Clique → drawer com últimas notas do fornecedor.

- `/dashboard/notas-fiscais` — Notas fiscais
  - Tabela paginada com busca por nº/CNPJ/fornecedor, filtro entrada/saída e período.
  - Indicador de cancelada, valores destacados.
  - Export CSV das notas filtradas (reutiliza `exports.ts`).

### Detalhes técnicos

- RLS: `company_id` precisa pertencer a uma empresa do tenant do usuário (mesmo padrão de `financial_statements`).
- Grants completos em todas as tabelas novas (authenticated + service_role).
- Parser roda em server function (igual ao contábil), com inserts em lotes de 500.
- Sem alterações no parser contábil existente.

## Ordem de execução

1. Tema claro/escuro (entrega rápida, sem dependências).
2. Migração das tabelas fiscais + grants/RLS.
3. Parser SPED Fiscal + integração no upload.
4. Tela de Fornecedores.
5. Tela de Notas Fiscais.

Posso seguir nessa ordem?
