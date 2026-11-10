<#
.SYNOPSIS
  Plan or run an encrypted logical backup of EES production Supabase (fail-closed).

.DESCRIPTION
  Default: PLAN ONLY (no dump, no dry-run that prints credentials).

  Hard rules:
  - Target is always production ref hafoaurzfgkkwpvzedvd
  - Never touches Development wpmnjfncaoogssgpqxek
  - Destination must be outside the git repo
  - Dump requires -OwnerAuthorised AND -IConfirmProductionTarget hafoaurzfgkkwpvzedvd
  - Plaintext .sql is encrypted then securely removed; encryption failure aborts with plaintext deleted
  - Does not use supabase --dry-run (that mode can print ephemeral PGPASSWORD to the console)
  - Does not echo connection strings or passwords

.PARAMETER OwnerAuthorised
  Explicit owner approval to create dumps.

.PARAMETER IConfirmProductionTarget
  Must equal hafoaurzfgkkwpvzedvd when dumping.

.PARAMETER DestinationRoot
  Off-repo folder for ciphertext. Default: %LOCALAPPDATA%\EES\production-backups

.PARAMETER KeyRoot
  Separate off-repo folder for backup.key. Default: %LOCALAPPDATA%\EES\production-backup-keys

.PARAMETER KeepPlaintext
  Dangerous; refused unless also -OwnerAuthorised (still discouraged). Default is delete plaintext after encrypt.
#>
[CmdletBinding()]
param(
  [switch]$OwnerAuthorised,
  [string]$IConfirmProductionTarget = "",
  [string]$DestinationRoot = (Join-Path $env:LOCALAPPDATA "EES\production-backups"),
  [string]$KeyRoot = (Join-Path $env:LOCALAPPDATA "EES\production-backup-keys"),
  [switch]$KeepPlaintext
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$ProdRef = "hafoaurzfgkkwpvzedvd"
$DevRef = "wpmnjfncaoogssgpqxek"
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path

function Write-Info([string]$Message) {
  Write-Host $Message
}

function Assert-OutsideRepo([string]$Path) {
  $full = [System.IO.Path]::GetFullPath($Path)
  $repo = [System.IO.Path]::GetFullPath($RepoRoot)
  if ($full.StartsWith($repo, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Destination must be outside the git repository: $full"
  }
}

function Restrict-DirectoryAcl([string]$Dir) {
  # Restrict to current user only (Windows ACL). Fail closed if icacls fails.
  $user = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
  & icacls.exe $Dir /inheritance:r | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "Failed to clear ACL inheritance on $Dir" }
  & icacls.exe $Dir /grant:r "${user}:(OI)(CI)F" | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "Failed to grant restricted ACL on $Dir" }
}

function Remove-PlaintextSecurely([string]$FilePath) {
  if (-not (Test-Path -LiteralPath $FilePath)) { return }
  # Overwrite then delete (best-effort on SSDs; still required before exit).
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

function Encrypt-FileAes([string]$PlainPath, [string]$CipherPath, [byte[]]$Key, [byte[]]$Iv) {
  $aes = [System.Security.Cryptography.Aes]::Create()
  try {
    $aes.KeySize = 256
    $aes.Mode = [System.Security.Cryptography.CipherMode]::CBC
    $aes.Padding = [System.Security.Cryptography.PaddingMode]::PKCS7
    $aes.Key = $Key
    $aes.IV = $Iv
    $encryptor = $aes.CreateEncryptor()
    $inStream = [System.IO.File]::OpenRead($PlainPath)
    $outStream = [System.IO.File]::Create($CipherPath)
    try {
      # Prepend IV for decryptors (not secret by itself).
      $outStream.Write($Iv, 0, $Iv.Length)
      $crypto = New-Object System.Security.Cryptography.CryptoStream($outStream, $encryptor, [System.Security.Cryptography.CryptoStreamMode]::Write)
      try {
        $inStream.CopyTo($crypto)
        $crypto.FlushFinalBlock()
      } finally {
        $crypto.Dispose()
      }
    } finally {
      $inStream.Dispose()
      $outStream.Dispose()
    }
  } finally {
    $aes.Dispose()
  }
}

Write-Info "EES production logical backup helper (fail-closed)"
Write-Info "Fixed production ref: $ProdRef"
Write-Info "Protected Development ref (never use): $DevRef"
Write-Info "Repo root: $RepoRoot"
Write-Info ""
Write-Info "NOTE: supabase db dump --dry-run is disabled here because it can print ephemeral PGPASSWORD to the console."
Write-Info ""

Assert-OutsideRepo $DestinationRoot
Assert-OutsideRepo $KeyRoot
if ([System.IO.Path]::GetFullPath($DestinationRoot).Equals([System.IO.Path]::GetFullPath($KeyRoot), [System.StringComparison]::OrdinalIgnoreCase)) {
  throw "KeyRoot must be a different directory from DestinationRoot (key separation)."
}

$ts = Get-Date -Format "yyyyMMdd-HHmmss"
$dest = Join-Path $DestinationRoot $ts
$keyDir = Join-Path $KeyRoot $ts

Write-Info "Planned ciphertext destination: $dest"
Write-Info "Planned key destination: $keyDir"
Write-Info "Artifacts: roles.sql / schema.sql / data.sql -> *.aes (then plaintext removed)"
Write-Info "Classification: PARTIAL logical export (public app schema/data). Not a full platform physical backup."
Write-Info ""

if (-not $OwnerAuthorised) {
  Write-Info "PLAN ONLY. No dump executed."
  Write-Info "Owner-approved dump example:"
  Write-Info "  powershell -File scripts/prepare-production-logical-backup.ps1 -OwnerAuthorised -IConfirmProductionTarget $ProdRef"
  exit 0
}

if ($IConfirmProductionTarget -ne $ProdRef) {
  throw "Refusing dump: -IConfirmProductionTarget must be exactly '$ProdRef' (got '$IConfirmProductionTarget')."
}

if ($KeepPlaintext) {
  throw "Refusing -KeepPlaintext. Plaintext must be encrypted and removed (fail-closed)."
}

# Ensure we never point at Development via env accidents for this process.
if ($env:SUPABASE_PROJECT_ID -eq $DevRef -or $env:SUPABASE_PROJECT_REF -eq $DevRef) {
  throw "Refusing dump: process environment references Development project."
}

# Clear accidental linked-project confusion: dump always uses --project-ref $ProdRef.
Write-Info "Dump target forced via --project-ref $ProdRef (ignore any linked Development ref)."

New-Item -ItemType Directory -Force -Path $dest | Out-Null
New-Item -ItemType Directory -Force -Path $keyDir | Out-Null
Restrict-DirectoryAcl $dest
Restrict-DirectoryAcl $keyDir

$roles = Join-Path $dest "roles.sql"
$schema = Join-Path $dest "schema.sql"
$data = Join-Path $dest "data.sql"
$plainFiles = @($roles, $schema, $data)
$key = $null
$ivBase = $null

try {
  # Prefer durable DB password from process env if already present (never echo it).
  # Do not reuse any previously printed ephemeral cli_login_postgres password.
  if ([string]::IsNullOrWhiteSpace($env:SUPABASE_DB_PASSWORD)) {
    Write-Info "SUPABASE_DB_PASSWORD not set in process env; a fresh short-lived login role may be minted (not echoed)."
  } else {
    Write-Info "SUPABASE_DB_PASSWORD is set in process env (value not displayed)."
  }

  $dockerAvailable = [bool](Get-Command docker -ErrorAction SilentlyContinue) -or [bool](Get-Command podman -ErrorAction SilentlyContinue)
  $pgDump = Get-Command pg_dump -ErrorAction SilentlyContinue
  $pgDumpall = Get-Command pg_dumpall -ErrorAction SilentlyContinue
  if (-not $dockerAvailable -and $pgDump -and $pgDumpall) {
    Write-Info "Docker/Podman not found; using local pg_dump/pg_dumpall fallback for public schema only."
    Write-Info "This helper does not auto-mint login roles. Set SUPABASE_DB_PASSWORD for postgres (or cli_login_postgres) and PGOPTIONS='-c role=postgres' when using a CLI login role."
    if ([string]::IsNullOrWhiteSpace($env:SUPABASE_DB_PASSWORD)) {
      throw "Local dump fallback requires SUPABASE_DB_PASSWORD in process env (never pass on command line)."
    }
    $dbHost = "db.$ProdRef.supabase.co"
    $dbUser = if ($env:SUPABASE_DB_USER) { $env:SUPABASE_DB_USER } else { "postgres" }
    if ([string]::IsNullOrWhiteSpace($env:PGOPTIONS)) {
      $env:PGOPTIONS = "-c role=postgres"
      Write-Info "PGOPTIONS defaulted to '-c role=postgres' for CLI login-role compatibility."
    }
    try {
      Write-Info "Dumping roles via pg_dumpall..."
      & pg_dumpall.EXE -h $dbHost -p 5432 -U $dbUser --roles-only --no-role-passwords --no-password -f $roles
      if ($LASTEXITCODE -ne 0) { throw "roles dump failed with exit $LASTEXITCODE" }
      Write-Info "Dumping public schema via pg_dump..."
      & pg_dump.EXE -h $dbHost -p 5432 -U $dbUser -d postgres --schema=public --schema-only --no-owner --no-privileges --no-password -f $schema
      if ($LASTEXITCODE -ne 0) { throw "schema dump failed with exit $LASTEXITCODE" }
      Write-Info "Dumping public data via pg_dump..."
      & pg_dump.EXE -h $dbHost -p 5432 -U $dbUser -d postgres --schema=public --data-only --no-owner --no-privileges --no-password -f $data
      if ($LASTEXITCODE -ne 0) { throw "data dump failed with exit $LASTEXITCODE" }
    } finally {
      # Do not leak password via accidental later echo; caller owns env lifetime.
    }
  } elseif ($dockerAvailable) {
    function Invoke-SupabaseDump {
      param(
        [Parameter(Mandatory)][string]$Label,
        [Parameter(Mandatory)][string[]]$DumpArgs
      )
      Write-Info $Label
      # npm may write benign warnings to stderr; do not treat those as terminating under Stop.
      $prevEap = $ErrorActionPreference
      $ErrorActionPreference = "Continue"
      $output = & npx.cmd @DumpArgs 2>&1
      $code = $LASTEXITCODE
      $ErrorActionPreference = $prevEap
      foreach ($item in @($output)) {
        $line = "$item"
        if ($line -match '(?i)PGPASSWORD|password\s*=') {
          Write-Info "[redacted CLI line containing credential-like text]"
        } elseif ($line -match '(?i)^npm warn') {
          # Ignore npm config noise
        } else {
          Write-Info $line
        }
      }
      if ($code -ne 0) { throw "$Label failed with exit $code" }
    }

    Invoke-SupabaseDump -Label "Dumping roles (no password echoed)..." -DumpArgs @(
      "supabase", "db", "dump", "--project-ref", $ProdRef, "-f", $roles, "--role-only"
    )
    Invoke-SupabaseDump -Label "Dumping schema..." -DumpArgs @(
      "supabase", "db", "dump", "--project-ref", $ProdRef, "-f", $schema
    )
    Invoke-SupabaseDump -Label "Dumping data (may take several minutes)..." -DumpArgs @(
      "supabase", "db", "dump", "--project-ref", $ProdRef, "-f", $data, "--data-only", "--use-copy"
    )
  } else {
    throw "Neither Docker/Podman nor local pg_dump/pg_dumpall are available. Install Docker Desktop or PostgreSQL client tools."
  }

  foreach ($f in $plainFiles) {
    if (-not (Test-Path -LiteralPath $f) -or (Get-Item -LiteralPath $f).Length -le 0) {
      throw "Dump produced missing/empty file: $f"
    }
  }

  # Generate encryption key material; write key file ONLY under KeyRoot (separate from ciphertext).
  $keyPath = Join-Path $keyDir "backup.key"
  $metaPath = Join-Path $keyDir "backup-meta.txt"
  $key = New-Object byte[] 32
  $ivBase = New-Object byte[] 16
  $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
  try {
    $rng.GetBytes($key)
    $rng.GetBytes($ivBase)
  } finally {
    $rng.Dispose()
  }
  [System.IO.File]::WriteAllBytes($keyPath, $key)
  # Persist IV base next to key (needed for decrypt validation / restore tooling). Not secret alone, but kept with key.
  $ivPath = Join-Path $keyDir "backup.iv"
  [System.IO.File]::WriteAllBytes($ivPath, $ivBase)
  @(
    "project_ref=$ProdRef"
    "created_utc=$((Get-Date).ToUniversalTime().ToString('o'))"
    "ciphertext_dir=$dest"
    "artifacts=roles.sql.aes,schema.sql.aes,data.sql.aes"
    "algorithm=AES-256-CBC"
    "note=PARTIAL logical backup; Auth/Storage/Edge/settings not fully covered"
  ) | Set-Content -LiteralPath $metaPath -Encoding ascii
  Restrict-DirectoryAcl $keyDir
  Restrict-DirectoryAcl $dest

  $checksums = New-Object System.Collections.Generic.List[string]
  foreach ($f in $plainFiles) {
    $name = [System.IO.Path]::GetFileName($f)
    $cipher = Join-Path $dest ($name + ".aes")
    # Unique IV per file derived from base IV + filename hash (still prepended to ciphertext).
    $nameHash = [System.Security.Cryptography.SHA256]::Create().ComputeHash([System.Text.Encoding]::UTF8.GetBytes($name))
    $iv = New-Object byte[] 16
    for ($i = 0; $i -lt 16; $i++) { $iv[$i] = $ivBase[$i] -bxor $nameHash[$i] }

    try {
      Encrypt-FileAes -PlainPath $f -CipherPath $cipher -Key $key -Iv $iv
    } catch {
      throw "Encryption failed for $name : $($_.Exception.Message)"
    }

    if (-not (Test-Path -LiteralPath $cipher) -or (Get-Item -LiteralPath $cipher).Length -le 32) {
      throw "Encryption produced invalid ciphertext for $name"
    }

    $hash = (Get-FileHash -LiteralPath $cipher -Algorithm SHA256).Hash
    $checksums.Add("$hash  $name.aes")
    Remove-PlaintextSecurely $f
    if (Test-Path -LiteralPath $f) { throw "Failed to remove plaintext $f (fail-closed)." }
  }

  $sumPath = Join-Path $dest "SHA256SUMS.txt"
  $checksums | Set-Content -LiteralPath $sumPath -Encoding ascii
  # Pointer only (no key material) so ciphertext folder can locate key dir.
  @(
    "key_dir=$keyDir"
    "project_ref=$ProdRef"
  ) | Set-Content -LiteralPath (Join-Path $dest "KEY_LOCATION.txt") -Encoding ascii

  # Validate ciphertext hashes immediately.
  foreach ($line in $checksums) {
    $parts = $line -split "\s+", 2
    $expected = $parts[0]
    $fileName = $parts[1]
    $actual = (Get-FileHash -LiteralPath (Join-Path $dest $fileName) -Algorithm SHA256).Hash
    if ($actual -ne $expected) { throw "Checksum mismatch for $fileName" }
  }

  Write-Info ""
  Write-Info "SUCCESS: encrypted backup artifacts in $dest"
  Write-Info "Key material stored separately in $keyDir"
  Write-Info "Ciphertext folder contains: roles.sql.aes schema.sql.aes data.sql.aes SHA256SUMS.txt KEY_LOCATION.txt"
  Write-Info "Key folder contains: backup.key backup.iv backup-meta.txt"
  Write-Info "Never commit either folder. Restore ONLY into a NEW temporary project. Never into $DevRef or production."
  Write-Info "Partial logical backup: Auth/Storage/Edge/settings are not fully recovered by this dump."
}
catch {
  Write-Info "ERROR: $($_.Exception.Message)"
  foreach ($f in $plainFiles) {
    try { Remove-PlaintextSecurely $f } catch { }
  }
  throw
}
finally {
  if ($null -ne $key) { [Array]::Clear($key, 0, $key.Length) }
  if ($null -ne $ivBase) { [Array]::Clear($ivBase, 0, $ivBase.Length) }
}
