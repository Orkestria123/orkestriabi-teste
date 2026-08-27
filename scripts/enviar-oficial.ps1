# Envia esta versao para a stack OFICIAL: GitHub -> Lovable + Supabase Cloud.
# Nao usa Docker na maquina de destino.
#
# 1) Schema no projeto uaebzngcblnxxbkygxft
# 2) Dump opcional dos dados publicos locais (empresas, ECD, indicadores)
# 3) Instrucoes de push no GitHub (o Lovable publica a partir do repo)
#
# Uso:
#   $env:SUPABASE_DB_PASSWORD = "senha-do-dashboard-oficial"
#   .\scripts\enviar-oficial.ps1
#   .\scripts\enviar-oficial.ps1 -ComDados     # tambem gera SQL dos dados locais
#   .\scripts\enviar-oficial.ps1 -SoSchema      # so db push, sem dump

param(
  [string]$ProjectRef = "uaebzngcblnxxbkygxft",
  [switch]$ComDados,
  [switch]$SoSchema
)

$ErrorActionPreference = "Stop"
$root = Resolve-Path (Join-Path $PSScriptRoot "..")
Set-Location $root

$outDir = Join-Path $root "entrega-oficial"
New-Item -ItemType Directory -Force -Path $outDir | Out-Null

Write-Host "=== Orkestria BI → Lovable + Supabase + GitHub ==="
Write-Host "Projeto Supabase: $ProjectRef"
Write-Host ""

# --- schema ---
if (-not $env:SUPABASE_DB_PASSWORD) {
  Write-Host "Senha do banco OFICIAL: Dashboard Supabase → Project Settings → Database → Database password"
  $secure = Read-Host "SUPABASE_DB_PASSWORD" -AsSecureString
  $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  $env:SUPABASE_DB_PASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringAuto($bstr)
}

Write-Host "Linkando e aplicando migrations pendentes (nao apaga dados que ja estao na nuvem)..."
npx supabase link --project-ref $ProjectRef --password $env:SUPABASE_DB_PASSWORD --yes
npx supabase db push --yes

Write-Host ""
Write-Host "Schema da nuvem alinhado com as migrations desta pasta."

# --- dados (opcional) ---
if ($ComDados -and -not $SoSchema) {
  $dataFile = Join-Path $outDir "dados-public-local.sql"
  Write-Host ""
  Write-Host "Gerando dump dos dados locais (schema public) em:"
  Write-Host "  $dataFile"
  npx supabase db dump --local --data-only --use-copy --schema public -f $dataFile
  Write-Host ""
  Write-Host "Para CARREGAR esses dados na nuvem (substitui linhas das tabelas public):"
  Write-Host "  npx supabase db query --linked --file `"$dataFile`""
  Write-Host "Isso NAO copia usuarios do Docker (auth). Crie o master no Dashboard:"
  Write-Host "  Authentication → Users → Add user (Auto Confirm) → depois role orkestria_admin."
}

Write-Host ""
Write-Host "=== GitHub / Lovable ==="
Write-Host "Esta pasta NAO tem repositorio git. O app oficial publica pelo GitHub ligado ao Lovable."
Write-Host "Na maquina com git e acesso ao repo:"
Write-Host "  1. Clone o repositorio que o Lovable ja usa"
Write-Host "  2. Copie por cima: src, supabase/migrations, package.json, vite.config.ts, etc."
Write-Host "  3. git add -A && git commit && git push"
Write-Host "  4. No Lovable: o deploy segue o push (branch principal do projeto)"
Write-Host ""
Write-Host "NAO commite .env (aponta para Docker local). Na nuvem o Lovable ja injeta"
Write-Host "SUPABASE_URL=https://$ProjectRef.supabase.co e as chaves do projeto."
Write-Host ""
Write-Host "Pronto. Pasta de artefatos: $outDir"
