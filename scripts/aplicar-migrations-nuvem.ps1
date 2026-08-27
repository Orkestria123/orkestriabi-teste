# Aplica as migrations desta pasta no projeto OFICIAL (Lovable Cloud / Supabase hospedado).
# NAO copia os dados locais (empresas, ECD, usuarios de teste). So schema, funcoes e seeds das migrations.
#
# Pre-requisito: acesso ao projeto (senha do banco no Dashboard → Settings → Database).
#
# Uso:
#   $env:SUPABASE_DB_PASSWORD = "senha-do-dashboard"
#   .\scripts\aplicar-migrations-nuvem.ps1
#
# Ou, se ja estiver linkado:
#   npx supabase db push

param(
  [string]$ProjectRef = "uaebzngcblnxxbkygxft"
)

$ErrorActionPreference = "Stop"
Set-Location (Join-Path $PSScriptRoot "..")

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
Write-Host "Nuvem atualizada com o schema desta versao."
Write-Host "Usuarios e dados da nuvem permanecem. O usuario master do Docker NAO e copiado."
Write-Host "Codigo: git push no repo do Lovable. Ver ENTREGA.md"
