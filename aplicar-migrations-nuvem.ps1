# Aplica as migrations DESTA pasta no Supabase oficial (Lovable Cloud).
# Nao copia dados locais (empresas, ECD, usuarios de teste).
#
# Uso (na pasta do clone, depois do aplicar-no-clone.ps1):
#   $env:SUPABASE_DB_PASSWORD = "senha-do-dashboard"
#   .\aplicar-migrations-nuvem.ps1
#
# Dashboard → Project Settings → Database → Database password
# Projeto: uaebzngcblnxxbkygxft

param(
  [string]$ProjectRef = "uaebzngcblnxxbkygxft"
)

$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

if (-not (Test-Path (Join-Path $PSScriptRoot "supabase\migrations"))) {
  Write-Error "Nao achei supabase/migrations nesta pasta. Rode o script na raiz do clone."
  exit 1
}

if (-not $env:SUPABASE_DB_PASSWORD) {
  Write-Host "Cole a senha do banco oficial (Dashboard → Project Settings → Database → Database password)."
  $secure = Read-Host "SUPABASE_DB_PASSWORD" -AsSecureString
  $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  $env:SUPABASE_DB_PASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringAuto($bstr)
}

Write-Host "Linkando projeto $ProjectRef..."
npx supabase link --project-ref $ProjectRef --password $env:SUPABASE_DB_PASSWORD --yes

Write-Host "Enviando migrations pendentes (nao apaga dados da nuvem)..."
npx supabase db push --yes

Write-Host ""
Write-Host "Schema da nuvem alinhado. Usuarios e empresas da nuvem permanecem."
Write-Host "Codigo: git push no clone. Lovable publica a branch principal."
