#!/usr/bin/env node
// Semear os indicadores globais da lista do escritório.
//   node --env-file=.env scripts/seed-indicadores-globais.mjs
import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Faltam SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY. Use --env-file=.env");
  process.exit(1);
}

const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

const { data: tenants, error: tErr } = await admin.from("tenants").select("id, name");
if (tErr) {
  console.error(tErr.message);
  process.exit(1);
}
if (!tenants?.length) {
  console.log("Nenhum escritório ainda. Crie o tenant e rode de novo, ou aplique a migration 20260914.");
  process.exit(0);
}

for (const t of tenants) {
  const { data, error } = await admin.rpc("semear_indicadores_globais", {
    _tenant_id: t.id,
    _substituir: false,
  });
  if (error) {
    console.error(`${t.name}: ${error.message}`);
    console.error("(Aplique a migration 20260914000001 se a função ainda não existe.)");
    process.exit(1);
  }
  console.log(`${t.name}:`, data);
}
