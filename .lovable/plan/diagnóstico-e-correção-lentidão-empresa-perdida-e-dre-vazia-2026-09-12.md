# Diagnóstico e correção: lentidão, empresa perdida e DRE vazia

## O que eu encontrei (testado no app real, sem alterar nenhum dado)

**1. A DRE está funcionando — o problema é a empresa.**
Abri o BI autenticado. Ao entrar em DRE sem indicar a empresa, o sistema
selecionou automaticamente a **primeira empresa da lista (Aquafast)**, que
não tem dados — daí a tela vazia com "Nenhum dado encontrado". Abrindo a
mesma tela apontando para **Casa do Vidro**, a DRE carregou completa: 134
linhas, Janeiro a Julho/2026, Receita Bruta de R$ 39,1 milhões.

Ou seja: a empresa escolhida não é lembrada quando a página é atualizada ou
quando se troca de tela; ela volta para a primeira da lista.

**2. Lentidão: 11 segundos para a DRE aparecer.** Os três maiores gargalos:

- Duas consultas de ~7 segundos cada aos lançamentos do diário, feitas por
  causa da correção de encerramento de exercício (dezembro). Ela é buscada
  sempre, mesmo quando o período selecionado não tem encerramento.
- O plano de contas é lido inteiro **seis vezes** na mesma tela (1 a 5
  segundos cada). O plano do escritório está grande: 348 mil linhas no
  total, sendo 187 mil de clientes/fornecedores.
- Dados do usuário (perfil e permissões) são buscados 3 vezes repetidas a
  cada carregamento.

**3. Não existe reaproveitamento entre telas.** Sair da DRE e voltar refaz
tudo do zero, e atualizar a página perde toda a memória do que já havia
sido calculado.

## O que eu vou fazer

### A. Lembrar a empresa selecionada
Guardar a empresa escolhida no navegador e mantê-la na URL, para que
atualizar a página, trocar de tela ou reabrir o BI mais tarde volte sempre
para a mesma empresa. Só cai para a primeira da lista quando não houver
escolha anterior válida.

### B. Deixar de refazer trabalho já feito
- Ler o plano de contas **uma vez** por empresa/visão e reaproveitar nas
  demonstrações da mesma sessão.
- Buscar perfil e permissões do usuário uma única vez.
- Buscar a correção de encerramento apenas quando o período selecionado
  puder conter encerramento, e resolvê-la de forma agregada no banco em vez
  de trazer os lançamentos linha a linha.

### C. Cache que sobrevive à atualização da página
Guardar o resultado pronto de DRE, Balanço, Fluxo e Indicadores no
navegador, marcado com a data da última atualização dos dados da empresa.
Ao reabrir, se nada foi importado desde então, a tela aparece na hora; se
houve importação nova, o cálculo é refeito automaticamente. Também haverá
um botão para forçar a atualização.

### D. Rede de segurança na tela
Quando a empresa selecionada não tiver dados no período, a tela dirá isso
com clareza e oferecerá o período disponível mais próximo, em vez de
apenas "nenhum dado encontrado".

## Detalhes técnicos

- `src/routes/dashboard.tsx`: persistir `selectedCompany` em
  `localStorage` (chave por usuário) + sincronizar sempre com `?company=`.
- `src/lib/diario/build-statements.ts`: cache em memória por
  `(tenant, company, modoGlobal, tipos)` para `getPlanoPorTipo`; pular
  `getCorrecoesEncerramento` quando nenhum período for de encerramento;
  substituir a leitura paginada de `lancamentos_diario` por RPC agregadora.
- `src/hooks/use-auth.tsx`: unificar as leituras de `profiles`/`user_roles`
  em uma query única compartilhada.
- `src/hooks/use-financial-data.ts`: persistência do resultado por
  `carimbo de versão` da empresa (max updated_at de `saldos_mensais` /
  importações) via RPC leve; `staleTime` longo e invalidação por carimbo.
- Nenhuma migração destrutiva; apenas funções SQL de leitura/agregação.

Nada de dados, cadastros ou configurações será alterado.
