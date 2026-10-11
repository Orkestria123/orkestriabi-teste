# Relatório Executivo no app

## O que o escritório verá
1. **Configurações (engrenagem) > Relatório Executivo — Padrão**
   - Cadastro do modelo padrão do escritório: lista de seções (capa, sumário, escritório, perfil da empresa, resumo, BP, DRE, custos, DFC, conciliação, PL, indicadores com fórmulas, faturamento 12 meses, notas explicativas, conclusões, glossário) com chave mostrar/esconder e ordem.
   - Textos fixos editáveis (apresentação do escritório, encerramento, glossário) e imagens (logo do escritório, capa).
2. **Relatórios por empresa** (mesma área + botão destacado "Relatório Executivo" no BI da empresa, só para o escritório)
   - "Gerar relatório": escolhe a empresa e o mês; copia o padrão, busca os números do BI e a IA escreve os textos (linguagem formal de controller).
   - Editor: mostrar/esconder seções e campos, editar qualquer texto gerado, trocar imagens (logo/foto da empresa), pré-visualizar e baixar o PDF.
   - Status: Rascunho / Disponibilizado.
3. **Botão "Disponibilizar relatório"**
   - Abre tela de confirmação com a lista de e-mails que receberão (todos os usuários com acesso à empresa), com opção de enviar ou não o e-mail.
   - Ao confirmar: o relatório aparece no BI do cliente (aba "Relatórios", somente leitura, com download do PDF) e os e-mails são enviados com o link.

## Pré-requisito de e-mail
O envio exige um domínio próprio verificado (ex.: avisos@opengestao.com.br). Ainda não há domínio configurado; até lá, tudo funciona exceto o envio, e a tela de confirmação avisa isso.

## Detalhes técnicos
- Tabelas: `relatorio_modelos` (tenant, seções jsonb, textos, imagens), `relatorios_executivos` (company, competência, conteúdo jsonb, status, pdf_path, disponibilizado_em/por), `relatorio_envios` (log por destinatário). RLS: escritório escreve no próprio tenant; cliente lê só disponibilizados das empresas em `usuario_empresas`.
- Bucket privado `relatorios` para PDFs/imagens; URL assinada para o cliente.
- Geração: server function com IA (Lovable AI) + dados via build-statements; PDF renderizado no navegador (@react-pdf/renderer) seguindo o visual v4 aprovado.
- E-mail: template "relatorio-disponivel" (um envio por destinatário, idempotente por relatório+usuário).
