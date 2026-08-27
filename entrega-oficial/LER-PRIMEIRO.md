# Entrega oficial — Lovable + Supabase + GitHub

O app **não** precisa de Docker na nuvem. Docker foi só o workaround desta máquina (portas do Windows). Destino: o projeto Lovable, o GitHub já ligado a ele, e o Supabase `uaebzngcblnxxbkygxft`.

## O que cada peça faz

| Peça | Papel |
|---|---|
| **GitHub** | código-fonte. O Lovable publica o que estiver no repo. |
| **Lovable** | build/hosting + variáveis `SUPABASE_*` da nuvem. |
| **Supabase Cloud** | banco, auth, storage. URL `https://uaebzngcblnxxbkygxft.supabase.co`. |

O `.env` local (`127.0.0.1:15421`) **não** vai para o GitHub. Na nuvem o Lovable já aponta para o Supabase oficial.

## 1. Código → GitHub → Lovable

Esta pasta veio de zip, sem `.git`. Na máquina da pessoa responsável:

```bash
git clone <repo-que-o-lovable-usa>
# copiar por cima src/, supabase/migrations/, package.json, etc.
git add -A
git commit -m "Atualiza BI (EBIT/EBITDA, indicadores, ajustes gerenciais)."
git push
```

Depois disso o Lovable rebuilda sozinho. Confira no painel Lovable se o deploy da branch principal passou.

Não commitar: `node_modules`, `.env`, `orkestria-postgres.dump`, `entrega-oficial/`.

## 2. Schema → Supabase oficial

Na raiz deste projeto (com a senha do Dashboard → Settings → Database):

```powershell
$env:SUPABASE_DB_PASSWORD = "cole-a-senha-oficial"
.\scripts\enviar-oficial.ps1
```

Isso faz `supabase db push`: cria/altera tabelas e funções que ainda não existem na nuvem. **Não apaga** empresas nem usuários que já estão no projeto oficial.

Se a CLI não autenticar, cole no SQL Editor do Dashboard, **nessa ordem**, os arquivos em `supabase/migrations/` que ainda não rodaram (os desta fase começam em `20260914` … `20260919`).

## 3. Dados locais → nuvem (opcional)

Os dados de teste desta máquina (empresas, ECD, indicadores, usuário `georg@opengestao.com.br`) estão no Docker local. **Auth da nuvem é outro.** Não copie `auth.users` do Docker para o Supabase oficial.

Para levar só as tabelas `public` (lançamentos, plano, indicadores):

```powershell
$env:SUPABASE_DB_PASSWORD = "cole-a-senha-oficial"
.\scripts\enviar-oficial.ps1 -ComDados
```

O script gera `entrega-oficial/dados-public-local.sql`. Importar isso **mistura/substitui** dados da nuvem. Só faça com autorização e backup.

Usuário master na nuvem: Dashboard → Authentication → Add user (Auto Confirm) → no SQL:

```sql
INSERT INTO public.user_roles (user_id, role)
SELECT id, 'orkestria_admin'
  FROM auth.users
 WHERE email = 'georg@opengestao.com.br'
ON CONFLICT (user_id, role) DO NOTHING;
```

(ajuste o e-mail se o da nuvem for outro.)

## 4. Conferir

1. Lovable abriu o app no domínio deles.
2. Login com usuário da **nuvem** (não o do Docker).
3. DRE / dashboard / indicadores batem — o código novo já está no GitHub.

## O que não fazer

- Não mandar o zip pedindo `docker compose` / `supabase start` na produção.
- Não apontar o Lovable para `http://127.0.0.1:15421`.
- Não restaurar `orkestria-postgres.dump` no banco oficial (é dump completo do Postgres local, inclusive schemas internos).
