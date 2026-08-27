# Restaura o dump local neste projeto (schema = migrations; dados = dump).
# Uso (na raiz do projeto, com Docker ligado):
#   .\scripts\restaurar-banco-local.ps1 -DumpPath ".\orkestria-postgres.dump"
#
# Depois: npm install && npm run dev  →  http://localhost:8080

param(
  [string]$DumpPath = $(if (Test-Path ".\orkestria-postgres.dump") { ".\orkestria-postgres.dump" } else { "C:\Users\Note\Desktop\orkestria-bi-entrega\orkestria-postgres.dump" })
)

$ErrorActionPreference = "Stop"
Set-Location (Join-Path $PSScriptRoot "..")

if (-not (Test-Path $DumpPath)) {
  Write-Error "Dump nao encontrado: $DumpPath"
}

Write-Host "1/4  Subindo o Supabase local (portas 15421-15424 — ver supabase/config.toml)..."
npx supabase start

Write-Host "2/4  Recriando o schema a partir das migrations oficiais..."
npx supabase db reset --yes

$container = "supabase_db_uaebzngcblnxxbkygxft"
Write-Host "3/4  Copiando dump para $container..."
docker cp (Resolve-Path $DumpPath) "${container}:/tmp/orkestria.dump"

Write-Host "4/4  Restaurando dados (public + auth + storage), sem reescrever o schema interno do Supabase..."
docker exec $container pg_restore `
  -U postgres -d postgres `
  --data-only --disable-triggers `
  --no-owner --no-acl `
  --schema=public --schema=auth --schema=storage `
  /tmp/orkestria.dump

Write-Host ""
Write-Host "Pronto. Preencha o .env com as chaves desta instancia:"
npx supabase status -o env
Write-Host ""
Write-Host "Copie SUPABASE_URL, ANON_KEY/PUBLISHABLE_KEY e SERVICE_ROLE_KEY para o .env"
Write-Host "(use as linhas VITE_ tambem, com a mesma URL e a mesma publishable key)."
Write-Host "Depois: npm install && npm run dev"
