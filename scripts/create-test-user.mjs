#!/usr/bin/env node
// ============================================================================
// Orkestria BI — cria um usuário de teste JÁ CONFIRMADO, sem precisar
// receber e-mail de verificação nenhum.
//
// Usa a Admin API do Supabase (createUser com email_confirm: true), a mesma
// técnica que src/lib/api/orkestria.functions.ts já usa para criar usuários
// de tenant/cliente — só que rodando localmente via CLI em vez de pela UI.
//
// Requer a service role key do projeto (NUNCA o publishable key). Pegue em:
//   Supabase Dashboard → seu projeto → Project Settings → API → service_role
//
// Uso:
//   node --env-file=.env scripts/create-test-user.mjs <email> <senha> [--admin]
//
//   <email>   pode ser qualquer string em formato de e-mail (ex: teste@teste.com).
//             Não precisa existir de verdade — email_confirm:true pula a etapa
//             de clicar no link de confirmação.
//   <senha>   mínimo 8 caracteres (mesma regra do formulário de signup).
//   --admin   se passado, o usuário já sai vinculado como orkestria_admin
//             (super admin da plataforma) — equivalente a clicar em
//             "Tornar-me Orkestria Super Admin" na tela inicial após o login,
//             mas sem precisar ser o primeiro usuário do banco.
//
// Se Node < 20.6 (sem --env-file), exporte as variáveis manualmente antes:
//   export SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=...
//   node scripts/create-test-user.mjs teste@teste.com senha1234 --admin
// ============================================================================

import { createClient } from "@supabase/supabase-js";

const [, , emailArg, passwordArg, ...rest] = process.argv;
const makeAdmin = rest.includes("--admin");

if (!emailArg || !passwordArg) {
  console.error(
    "Uso: node --env-file=.env scripts/create-test-user.mjs <email> <senha> [--admin]",
  );
  process.exit(1);
}
if (passwordArg.length < 8) {
  console.error("A senha precisa ter pelo menos 8 caracteres.");
  process.exit(1);
}

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error(
    "Faltam SUPABASE_URL e/ou SUPABASE_SERVICE_ROLE_KEY no ambiente.\n" +
      "Rode com: node --env-file=.env scripts/create-test-user.mjs ...\n" +
      "(ou exporte as duas variáveis manualmente antes de rodar o script)",
  );
  process.exit(1);
}

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function main() {
  console.log(`Criando usuário confirmado: ${emailArg}`);
  const { data, error } = await admin.auth.admin.createUser({
    email: emailArg,
    password: passwordArg,
    email_confirm: true, // pula a etapa de confirmação por e-mail
    user_metadata: { full_name: "Usuário de Teste" },
  });

  if (error) {
    console.error("Falha ao criar usuário:", error.message);
    process.exit(1);
  }

  const userId = data.user.id;
  console.log(`Usuário criado (id=${userId}). O trigger on_auth_user_created`);
  console.log("já deve ter gerado a linha correspondente em public.profiles.");

  if (makeAdmin) {
    const { error: roleErr } = await admin
      .from("user_roles")
      .upsert({ user_id: userId, role: "orkestria_admin" }, { onConflict: "user_id,role" });
    if (roleErr) {
      console.error("Usuário criado, mas falhou ao atribuir orkestria_admin:", roleErr.message);
      process.exit(1);
    }
    console.log("Papel 'orkestria_admin' atribuído — este usuário já entra direto em /orkestria-admin.");
  } else {
    console.log(
      "Nenhum papel atribuído ainda. Ao logar em /auth, a conta cai em " +
        "'Conta sem acesso atribuído':\n" +
        "  - se for o primeiro usuário do banco, clique em 'Tornar-me Orkestria Super Admin';\n" +
        "  - senão, peça para um orkestria_admin/tenant_admin existente vincular essa conta\n" +
        "    a um tenant/empresa (tela Admin → Usuários), ou rode este script de novo com --admin.",
    );
  }

  console.log("\nPronto. Login em /auth:");
  console.log(`  e-mail: ${emailArg}`);
  console.log(`  senha:  ${passwordArg}`);
}

main();
