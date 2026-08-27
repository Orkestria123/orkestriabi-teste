# Orkestria BI — rodando localmente com um usuário de teste (sem e-mail)

Este guia parte do zip `orkestriabi-teste-main.zip` que você enviou. Testei os passos abaixo
rodando `npm install` e `npx vite dev` de verdade contra esse projeto antes de escrever este
documento, então eles refletem o comportamento real do código, não uma suposição.

## 0. Entenda o que "rodar localmente" significa aqui

Este é um app **TanStack Start** (React + Vite + SSR) gerado pelo Lovable, que fala com um
projeto **Supabase hospedado na nuvem** (Lovable Cloud) — não um Supabase local. O `.env` já
aponta para esse projeto hospedado:

```
SUPABASE_URL="https://uaebzngcblnxxbkygxft.supabase.co"
SUPABASE_PROJECT_ID="uaebzngcblnxxbkygxft"
SUPABASE_PUBLISHABLE_KEY="sb_publishable_..."
```

Ou seja: "rodar localmente" = rodar o **servidor de dev do frontend/SSR na sua máquina**,
conversando com esse banco Supabase que já existe na nuvem. Isso é o normal para projetos
Lovable — não há um `docker compose up` de banco local aqui. Se um dia vocês quiserem trocar
para um Supabase 100% local (CLI + Docker), me avise que documento esse caminho à parte; ele é
mais trabalhoso porque exige rodar as 22 migrations locais e reproduzir buckets de storage.

## 1. Pré-requisitos

- Node.js 20+ (o projeto foi testado aqui com Node 22).
- `npm`
- Acesso ao painel do projeto Supabase em https://supabase.com/dashboard

## 2. Instalar e subir o servidor

```bash
cd orkestriabi-teste-main
npm install
npm run dev
```

Isso sobe em `http://localhost:8080` (a porta é decidida pelo `@lovable.dev/vite-tanstack-config`,
que também detecta automaticamente se está rodando dentro de um sandbox/container).

> **Nota de ambiente:** em containers sem suporte a IPv6 (não é o caso normal de um notebook),
> `npm run dev` pode falhar com `EAFNOSUPPORT: address family not supported :::8080`. Se isso
> acontecer na sua máquina, rode `npx vite dev --host 127.0.0.1` como alternativa — foi assim que
> validei que o app sobe e responde 200 em `/`.

Nesse ponto o app já carrega, mas ainda não dá pra fazer login de verdade sem um usuário no
Supabase — é o que o próximo passo resolve.

## 3. Pegar a Service Role Key (só uma vez)

Várias operações administrativas do app (criar tenant, criar usuário, apagar usuário, e o script
de teste deste guia) rodam no servidor com a **service role key** do Supabase, que dá bypass total
de RLS. Ela não vem no `.env` do zip por segurança — pegue em:

**Supabase Dashboard → projeto `uaebzngcblnxxbkygxft` → Project Settings → API → seção "Project API keys" → `service_role`** (clique em "Reveal").

Adicione ao `.env` local:

```
SUPABASE_SERVICE_ROLE_KEY="cole_aqui_a_chave_service_role"
```

⚠️ **Nunca** prefixe essa variável com `VITE_` (isso a exporia no bundle do navegador) e nunca a
comite/compartilhe — quem tiver essa chave tem acesso irrestrito ao banco todo, de todos os
tenants. Ela já está no `.gitignore` por estar dentro de `.env`.

## 4. Criar um usuário de teste que não precisa de e-mail real

O formulário de cadastro em `/auth` (`src/routes/auth.tsx`) usa `supabase.auth.signUp`, que por
padrão exige confirmar o e-mail antes de liberar o login — chato para testar localmente. Duas
formas de pular isso, sem precisar de uma caixa de e-mail de verdade:

### Opção A — painel do Supabase (mais rápida, sem rodar nada)

1. Supabase Dashboard → **Authentication → Users → Add user**.
2. Preencha um e-mail qualquer em formato válido (ex.: `teste@teste.com` — não precisa existir,
   ninguém vai receber nada).
3. Marque **"Auto Confirm User"**.
4. Defina uma senha (8+ caracteres) e salve.

Pronto: já dá para logar em `http://localhost:8080/auth` com esse e-mail/senha.

## 5. Logar e navegar

1. Abra `http://localhost:8080/auth`, entre com e-mail/senha do passo 4.
2. Se você usou `--admin` (ou já clicou em "Tornar-me Orkestria Super Admin"), você cai em
   `/orkestria-admin` — daí dá pra criar um tenant (escritório) + usuário admin desse tenant pela
   própria tela.
3. A partir do tenant admin, crie uma empresa (`/admin/empresas`) e, se quiser ver o BI com dados,
   suba um arquivo SPED Contábil de teste em `/admin/upload`, ou cadastre lançamentos pelo módulo
   de Diário (`/admin/empresas/$id/dados`).

### Atalho sem login nenhum: a rota `/teste`

O projeto já tem uma rota pública (`http://localhost:8080/teste`) que mostra os dados da
**primeira empresa cadastrada no banco**, sem exigir login algum — o próprio código já avisa isso
("Página de teste — sem autenticação. Remover após validação.", em
`src/routes/teste.tsx`/`src/lib/api/teste.functions.ts`). Serve como atalho rápido pra olhar o
DRE/Balanço/DFC de uma empresa que já tenha dados, sem precisar montar usuário nenhum — mas veja o
alerta de segurança no `AUDIT.md` antes de deixar isso acessível em qualquer ambiente que não seja
só a sua máquina local.

---

Qualquer erro que aparecer no meio do caminho (RLS negando alguma query, `Forbidden` em algum
server function, etc.) é esperado se o usuário de teste não tiver o papel/tenant/empresa certos
para a tela que você está tentando abrir — o app é multi-tenant e cada papel (`orkestria_admin`,
`tenant_admin`, `client`) enxerga uma fatia diferente dos dados, por desenho.
