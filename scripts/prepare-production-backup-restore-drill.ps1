<#
.SYNOPSIS
  Plan (default) or prepare an isolated restore drill for the encrypted production logical backup.

.DESCRIPTION
  Fail-closed helper. Default is PLAN ONLY.

  Hard rules:
  - Never targets production hafoaurzfgkkwpvzedvd
  - Never targets Development wpmnjfncaoogssgpqxek
  - Decrypts only into an off-repo work directory with restricted ACL
  - Wipes plaintext after use when restore path completes or fails
  - Does not create cloud projects
  - Does not print backup keys or customer row data

  Recommended target for a faithful drill: a NEW temporary Supabase project (owner-created).
  Local PostgreSQL 17 can only support a limited smoke restore (missing auth/storage managed schemas).

.PARAMETER OwnerAuthorisedDecrypt
  Allows decrypt of ciphertext into the off-repo work directory.

.PARAMETER IConfirmIsolatedTarget
  Exact NEW temporary project ref (20-char Supabase ref). Must match allowlist.

.PARAMETER AllowedRestoreProjectRef
  Explicit allowlist entry for the disposable restore target. Must equal IConfirmIsolatedTarget
  and must NOT be production/development. Can also be provided via env EES_RESTORE_DRILL_ALLOWED_REF.

.PARAMETER BackupTimestamp
  Default: 20261101-194605

.PARAMETER ExecutePsqlRestore
  Requires -DatabaseUrlEnvVarName pointing at an isolated target URL env var.
  URL host/ref must contain AllowedRestoreProjectRef.
#>
[CmdletBinding()]
param(
  [switch]$OwnerAuthorisedDecrypt,
  [string]$IConfirmIsolatedTarget = "",
  [string]$AllowedRestoreProjectRef = "",
  [string]$BackupTimestamp = "20261101-194605",
  [switch]$ExecutePsqlRestore,
  [string]$DatabaseUrlEnvVarName = ""
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$ProdRef = "hafoaurzfgkkwpvzedvd"
$DevRef = "wpmnjfncaoogssgpqxek"
$CipherRoot = Join-Path $env:LOCALAPPDATA "EES\production-backups\$BackupTimestamp"
$KeyRoot = Join-Path $env:LOCALAPPDATA "EES\production-backup-keys\$BackupTimestamp"
$WorkRoot = Join-Path $env:LOCALAPPDATA "EES\restore-drill-work\$BackupTimestamp"

function Write-Info([string]$Message) {
  Write-Host $Message
}

function Restrict-DirectoryAcl([string]$Dir) {
  $user = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
  & icacls.exe $Dir /inheritance:r | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "Failed ACL inheritance clear on $Dir" }
  & icacls.exe $Dir /grant:r "${user}:(OI)(CI)F" | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "Failed ACL grant on $Dir" }
}

function Remove-PlaintextSecurely([string]$FilePath) {
  if (-not (Test-Path -LiteralPath $FilePath)) { return }
  $length = (Get-Item -LiteralPath $FilePath).Length
  if ($length -gt 0) {
    $stream = [System.IO.File]::Open($FilePath, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Write)
    try {
      $chunk = New-Object byte[] ([Math]::Min(1MB, [Math]::Max(1, $length)))
      $remaining = $length
      while ($remaining -gt 0) {
        $write = [int]([Math]::Min($chunk.Length, $remaining))
        $stream.Write($chunk, 0, $write)
        $remaining -= $write
      }
      $stream.Flush()
    } finally {
      $stream.Dispose()
    }
  }
  Remove-Item -LiteralPath $FilePath -Force
}

function Assert-Checksums {
  $sumPath = Join-Path $CipherRoot "SHA256SUMS.txt"
  if (-not (Test-Path -LiteralPath $sumPath)) { throw "Missing SHA256SUMS.txt" }
  foreach ($line in Get-Content -LiteralPath $sumPath) {
    if ([string]::IsNullOrWhiteSpace($line)) { continue }
    $parts = $line -split "\s+", 2
    $actual = (Get-FileHash -LiteralPath (Join-Path $CipherRoot $parts[1]) -Algorithm SHA256).Hash
    if ($actual -ne $parts[0]) { throw "Checksum mismatch for $($parts[1])" }
  }
}

function Decrypt-FileAes([string]$CipherPath, [string]$OutPath, [byte[]]$Key) {
  $in = [System.IO.File]::OpenRead($CipherPath)
  try {
    $iv = New-Object byte[] 16
    if ($in.Read($iv, 0, 16) -ne 16) { throw "Cipher too short: $CipherPath" }
    $aes = [System.Security.Cryptography.Aes]::Create()
    try {
      $aes.KeySize = 256
      $aes.Mode = [System.Security.Cryptography.CipherMode]::CBC
      $aes.Padding = [System.Security.Cryptography.PaddingMode]::PKCS7
      $aes.Key = $Key
      $aes.IV = $iv
      $decryptor = $aes.CreateDecryptor()
      $out = [System.IO.File]::Create($OutPath)
      try {
        $crypto = New-Object System.Security.Cryptography.CryptoStream($in, $decryptor, [System.Security.Cryptography.CryptoStreamMode]::Read)
        try {
          $crypto.CopyTo($out)
        } finally {
          $crypto.Dispose()
        }
      } finally {
        $out.Dispose()
      }
    } finally {
      $aes.Dispose()
    }
  } finally {
    $in.Dispose()
  }
}

Write-Info "EES production backup restore-drill helper (fail-closed)"
Write-Info "Forbidden targets: $ProdRef (prod), $DevRef (development)"
Write-Info "Cipher: $CipherRoot"
Write-Info "Keys:   $KeyRoot"
Write-Info "Work:   $WorkRoot"
Write-Info ""

Assert-Checksums
Write-Info "Checksum recheck: PASS"

foreach ($n in @("roles.sql.aes", "schema.sql.aes", "data.sql.aes", "backup.key", "backup.iv")) {
  $p = if ($n -like "*.aes") { Join-Path $CipherRoot $n } else { Join-Path $KeyRoot $n }
  if (-not (Test-Path -LiteralPath $p)) { throw "Missing required artifact: $n" }
}

$plainLeft = @(Get-ChildItem $CipherRoot, $KeyRoot -Recurse -Include *.sql -ErrorAction SilentlyContinue)
if ($plainLeft.Count -gt 0) { throw "Plaintext .sql unexpectedly present beside ciphertext/keys" }
Write-Info "Plaintext beside backup/key dirs: none"

Write-Info ""
Write-Info "Baseline validation counts (from pre-migration production probe; not re-queried here):"
Write-Info "  booking_diary=1572  fuel_logs=2729  ees_locations=103  ees_location_map_pins=0"
Write-Info "  account_access=4  vehicle_monthly_performance=149  maintenance_records=43"
Write-Info ""
Write-Info "Known gaps: Auth users/sessions, Storage objects, Edge Functions, Dashboard settings, role passwords."
Write-Info "Circular FK note: ees_employee_documents - use session_replication_role=replica on ISOLATED target only."
Write-Info ""

if (-not $OwnerAuthorisedDecrypt) {
  Write-Info "PLAN ONLY. No decrypt/restore executed."
  Write-Info "Owner-approved decrypt+restore example (after temp project exists):"
  Write-Info '  $env:EES_RESTORE_DRILL_ALLOWED_REF = "NEW_TEMP_REF"'
  Write-Info '  $env:EES_RESTORE_DRILL_DB_URL = "postgresql://...isolated..."'
  Write-Info '  powershell -File scripts/prepare-production-backup-restore-drill.ps1 -OwnerAuthorisedDecrypt -IConfirmIsolatedTarget NEW_TEMP_REF -AllowedRestoreProjectRef NEW_TEMP_REF -ExecutePsqlRestore -DatabaseUrlEnvVarName EES_RESTORE_DRILL_DB_URL'
  Write-Info "Faithful drill requires a NEW temporary Supabase project (never $ProdRef / $DevRef)."
  exit 0
}

if ([string]::IsNullOrWhiteSpace($IConfirmIsolatedTarget)) {
  throw "Refusing: -IConfirmIsolatedTarget is required (exact new project ref)."
}
if ($IConfirmIsolatedTarget -eq $ProdRef -or $IConfirmIsolatedTarget -eq $DevRef) {
  throw "Refusing: isolated target must not be production or Development."
}
if ($IConfirmIsolatedTarget -notmatch '^[a-z]{20}$') {
  throw "Refusing: -IConfirmIsolatedTarget must be a 20-char lowercase Supabase project ref."
}

$allowRef = $AllowedRestoreProjectRef
if ([string]::IsNullOrWhiteSpace($allowRef)) {
  $allowRef = [Environment]::GetEnvironmentVariable("EES_RESTORE_DRILL_ALLOWED_REF", "Process")
}
if ([string]::IsNullOrWhiteSpace($allowRef)) {
  $allowRef = [Environment]::GetEnvironmentVariable("EES_RESTORE_DRILL_ALLOWED_REF", "User")
}
if ([string]::IsNullOrWhiteSpace($allowRef)) {
  throw "Refusing: set -AllowedRestoreProjectRef or env EES_RESTORE_DRILL_ALLOWED_REF to the NEW temp project ref."
}
if ($allowRef -ne $IConfirmIsolatedTarget) {
  throw "Refusing: allowlist ref '$allowRef' does not match -IConfirmIsolatedTarget '$IConfirmIsolatedTarget'."
}
if ($allowRef -eq $ProdRef -or $allowRef -eq $DevRef) {
  throw "Refusing: allowlist cannot include production or Development."
}
Write-Info "Restore-target allowlist confirmed for ref: $allowRef"

New-Item -ItemType Directory -Force -Path $WorkRoot | Out-Null
Restrict-DirectoryAcl $WorkRoot

$key = $null
$wipePlaintextAtEnd = $true
$plainFiles = @(
  (Join-Path $WorkRoot "roles.sql"),
  (Join-Path $WorkRoot "schema.sql"),
  (Join-Path $WorkRoot "data.sql")
)
$key = [System.IO.File]::ReadAllBytes((Join-Path $KeyRoot "backup.key"))

try {
  Write-Info "Decrypting into restricted work directory..."
  Decrypt-FileAes (Join-Path $CipherRoot "roles.sql.aes") $plainFiles[0] $key
  Decrypt-FileAes (Join-Path $CipherRoot "schema.sql.aes") $plainFiles[1] $key
  Decrypt-FileAes (Join-Path $CipherRoot "data.sql.aes") $plainFiles[2] $key
  foreach ($f in $plainFiles) {
    if (-not (Test-Path $f) -or (Get-Item $f).Length -le 0) { throw "Decrypt produced empty $f" }
    Write-Info ("DECRYPTED_BYTES_{0}={1}" -f [IO.Path]::GetFileName($f), (Get-Item $f).Length)
  }

  if (-not $ExecutePsqlRestore) {
    # Keep plaintext for a same-session manual restore; owner must wipe afterward.
    $wipePlaintextAtEnd = $false
    Write-Info ""
    Write-Info "Decrypt complete. psql restore NOT executed (no -ExecutePsqlRestore)."
    Write-Info "Manual isolated restore order (isolated target only):"
    Write-Info ("  step1 Confirm target host/ref is neither {0} nor {1}" -f $ProdRef, $DevRef)
    Write-Info "  step2 Optional filtered roles (skip managed SUPERUSER recreate conflicts on Supabase)"
    Write-Info "  step3 psql -v ON_ERROR_STOP=1 -f schema.sql"
    Write-Info "  step4 SET session_replication_role = replica; load data.sql; SET session_replication_role = DEFAULT;"
    Write-Info "  step5 Count checks vs baseline; verify RLS enabled; record PASS/FAIL"
    Write-Info "  step6 Wipe plaintext work dir before leaving the workstation unattended"
    Write-Info ""
    Write-Info ("WARNING: plaintext currently present under {0}" -f $WorkRoot)
    return
  }

  if ([string]::IsNullOrWhiteSpace($DatabaseUrlEnvVarName)) {
    throw "ExecutePsqlRestore requires -DatabaseUrlEnvVarName (env var holding isolated DB URL)."
  }
  $dbUrl = [Environment]::GetEnvironmentVariable($DatabaseUrlEnvVarName, "Process")
  if ([string]::IsNullOrWhiteSpace($dbUrl)) {
    $dbUrl = [Environment]::GetEnvironmentVariable($DatabaseUrlEnvVarName, "User")
  }
  if ([string]::IsNullOrWhiteSpace($dbUrl)) {
    throw ("Env var {0} is empty" -f $DatabaseUrlEnvVarName)
  }
  if ($dbUrl -match [regex]::Escape($ProdRef) -or $dbUrl -match [regex]::Escape($DevRef)) {
    throw "Refusing restore: database URL references production or Development."
  }
  if ($dbUrl -match "(?i)hafoaurzfgkkwpvzedvd|wpmnjfncaoogssgpqxek") {
    throw "Refusing restore: protected project ref detected in URL."
  }
  if ($dbUrl -notmatch [regex]::Escape($allowRef)) {
    throw "Refusing restore: database URL does not contain allowlisted ref '$allowRef'."
  }

  Write-Info "Executing psql restore against isolated URL from env var name only (URL not printed)..."
  $env:Path = "C:\Program Files\PostgreSQL\17\bin;" + $env:Path
  $prevEap = $ErrorActionPreference
  $ErrorActionPreference = "Continue"

  $connSql = "select current_database() as db, inet_server_addr()::text as addr;"
  & psql.EXE $dbUrl -v ON_ERROR_STOP=1 -c $connSql 2>&1 | ForEach-Object {
    $line = "$_"
    if ($line -match "(?i)password=|postgresql://[^@]+@") {
      Write-Info "[redacted connection detail]"
    } else {
      Write-Info $line
    }
  }
  if ($LASTEXITCODE -ne 0) { throw "Target connectivity check failed" }

  Write-Info "Restoring schema..."
  & psql.EXE $dbUrl -v ON_ERROR_STOP=1 -f $plainFiles[1]
  if ($LASTEXITCODE -ne 0) { throw "schema restore failed" }

  Write-Info "Restoring data with session_replication_role=replica (isolated target only)..."
  $setReplica = "SET session_replication_role = replica;"
  $setDefault = "SET session_replication_role = DEFAULT;"
  & psql.EXE $dbUrl -v ON_ERROR_STOP=1 -c $setReplica -f $plainFiles[2] -c $setDefault
  if ($LASTEXITCODE -ne 0) { throw "data restore failed" }

  Write-Info "Running count validation (counts only)..."
  $countSql = @"
select 'booking_diary' as t, count(*)::bigint as n from public.booking_diary
union all select 'fuel_logs', count(*) from public.fuel_logs
union all select 'ees_locations', count(*) from public.ees_locations
union all select 'ees_location_map_pins', count(*) from public.ees_location_map_pins
union all select 'account_access', count(*) from public.account_access
union all select 'vehicle_monthly_performance', count(*) from public.vehicle_monthly_performance
union all select 'maintenance_records', count(*) from public.maintenance_records
order by 1;
"@
  & psql.EXE $dbUrl -v ON_ERROR_STOP=1 -c $countSql
  if ($LASTEXITCODE -ne 0) { throw "validation counts failed" }
  $ErrorActionPreference = $prevEap
  Write-Info "RESTORE_COMMANDS_COMPLETED - compare counts to baseline and record PASS/FAIL explicitly."
}
finally {
  if ($null -ne $key) { [Array]::Clear($key, 0, $key.Length) }
  if ($wipePlaintextAtEnd) {
    foreach ($f in $plainFiles) {
      try {
        Remove-PlaintextSecurely $f
      } catch {
        Write-Info ("WARN: failed wiping {0}" -f $f)
      }
    }
    Write-Info ("Plaintext wipe attempted under {0}" -f $WorkRoot)
  }
}
