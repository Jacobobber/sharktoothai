param(
  [Parameter(Mandatory=$true)][ValidateSet("dev","stage","prod")] [string] $Env,
  [Parameter(Mandatory=$true)] [string] $TenantId,

  [Parameter(Mandatory=$false)] [string] $SubscriptionId = "",
  [Parameter(Mandatory=$false)] [string] $Location = "",

  [Parameter(Mandatory=$false)] [string] $FoundationRg = "stai-prod-foundation",
  [Parameter(Mandatory=$false)] [string] $AcrName = "acrstaiprod",
  [Parameter(Mandatory=$false)] [string] $StorageAccountName = ""
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$subscriptionId = $SubscriptionId
$location = $Location
$storageAccountName = ""
$storageResourceId = ""
$storageContainers = @()
$deploymentResult = $null

function Get-DeterministicStorageAccountName([string] $env, [string] $tenantId) {
  $base = ("stai" + $env + $tenantId).ToLower()
  $sanitized = ($base -replace '[^a-z0-9]', '')
  if ([string]::IsNullOrWhiteSpace($sanitized)) { $sanitized = "stai" }
  if ($sanitized -notmatch '^[a-z]') { $sanitized = "s$sanitized" }

  if ($sanitized.Length -gt 24) {
    $sha256 = [System.Security.Cryptography.SHA256]::Create()
    $hashBytes = $sha256.ComputeHash([System.Text.Encoding]::UTF8.GetBytes("$env|$tenantId"))
    $hashHex = -join ($hashBytes | ForEach-Object { $_.ToString("x2") })
    $suffix = $hashHex.Substring(0,6)
    $prefixLength = 24 - $suffix.Length
    $sanitized = $sanitized.Substring(0, $prefixLength) + $suffix
  }

  while ($sanitized.Length -lt 3) { $sanitized += "0" }
  return $sanitized
}

function Assert-Ok([string] $msg, [int] $code) {
  if ($code -ne 0) { throw $msg }
}

# Validate tenantId slug (t- + lowercase/nums/hyphen)
if ($TenantId -notmatch '^t-[a-z0-9]+(-[a-z0-9]+)*$') {
  throw "Invalid TenantId '$TenantId'. Expected format like: t-aisharktooth-demo (lowercase, digits, hyphen)."
}

if ([string]::IsNullOrWhiteSpace($subscriptionId)) {
  $subscriptionId = az account show --query id -o tsv
}
az account set --subscription $subscriptionId | Out-Null

# Default location from foundation RG if not provided
if ([string]::IsNullOrWhiteSpace($location)) {
  $location = az group show -n $FoundationRg --query location -o tsv
  if ([string]::IsNullOrWhiteSpace($location)) { throw "Could not determine location from foundation RG '$FoundationRg'." }
}

$tenantRg = "stai-$Env-tenant-$TenantId"
$uamiName = "uami-stai-$Env-tenant-$TenantId-ingest"

if ([string]::IsNullOrWhiteSpace($StorageAccountName)) {
  $storageAccountName = Get-DeterministicStorageAccountName -env $Env -tenantId $TenantId
} else {
  $storageAccountName = $StorageAccountName.ToLower()
}

if ($storageAccountName -notmatch '^[a-z][a-z0-9]{2,23}$') {
  throw "Invalid storage account name '$storageAccountName'. Must be 3-24 chars, lowercase letters/numbers, starting with a letter."
}

Write-Host "== Provision tenant =="
Write-Host "  subscription: $subscriptionId"
Write-Host "  location:     $location"
Write-Host "  tenantRg:     $tenantRg"
Write-Host "  uamiName:     $uamiName"
Write-Host "  storageAccountName: $storageAccountName"

# Ensure tenant RG
$rgExists = az group exists -n $tenantRg
if ($rgExists -ne "true") {
  Write-Host "Creating resource group: $tenantRg"
  az group create -n $tenantRg -l $location -o none
} else {
  Write-Host "Resource group exists: $tenantRg"
}

# Ensure UAMI (robust/idempotent)
$uamiPrincipalId = az identity show -g $tenantRg -n $uamiName --query principalId -o tsv 2>$null
$uamiResourceId  = az identity show -g $tenantRg -n $uamiName --query id -o tsv 2>$null

if ([string]::IsNullOrWhiteSpace($uamiResourceId)) {
  Write-Host "Creating UAMI: $uamiName"
  az identity create -g $tenantRg -n $uamiName -l $location -o none
}

# Re-read (and retry briefly) until principalId is present
$maxTries = 10
for ($i=1; $i -le $maxTries; $i++) {
  $uamiPrincipalId = az identity show -g $tenantRg -n $uamiName --query principalId -o tsv 2>$null
  $uamiResourceId  = az identity show -g $tenantRg -n $uamiName --query id -o tsv 2>$null
  if (-not [string]::IsNullOrWhiteSpace($uamiPrincipalId)) { break }
  Start-Sleep -Seconds 2
}

if ([string]::IsNullOrWhiteSpace($uamiPrincipalId)) {
  throw "UAMI principalId still empty after creation: $uamiName (rg=$tenantRg)"
}

Write-Host "UAMI ready:"
Write-Host "  id: $uamiResourceId"
Write-Host "  principalId: $uamiPrincipalId"

# Resolve ACR resource ID
$acrId = az acr show -g $FoundationRg -n $AcrName --query id -o tsv
if ([string]::IsNullOrWhiteSpace($acrId)) { throw "ACR not found: $AcrName in RG $FoundationRg" }

# Ensure AcrPull assignment (tenant UAMI -> ACR)
$acrPullRoleId = az role definition list --name "AcrPull" --query "[0].id" -o tsv
if ([string]::IsNullOrWhiteSpace($acrPullRoleId)) { throw "Could not resolve role definition for AcrPull" }

$hasAcrPull = az role assignment list `
  --assignee-object-id $uamiPrincipalId `
  --scope $acrId `
  --query "[?roleDefinitionName=='AcrPull'] | length(@)" `
  -o tsv

if ($hasAcrPull -eq "0") {
  Write-Host "Assigning AcrPull on ACR to tenant UAMI..."
  az role assignment create `
    --assignee-object-id $uamiPrincipalId `
    --assignee-principal-type ServicePrincipal `
    --role "AcrPull" `
    --scope $acrId `
    -o none
} else {
  Write-Host "AcrPull already assigned."
}

Write-Host "Storage account name: $storageAccountName"

# Deploy tenant storage + containers via Bicep (management plane)
$tags = @{
  "stai:env"    = $Env
  "stai:tenant" = $TenantId
  "stai:role"   = "tenant-storage"
}

$tagsJson = ($tags | ConvertTo-Json -Compress)

Write-Host "Deploying tenant storage (Bicep)..."
$deploymentResult = az deployment group create `
  -g $tenantRg `
  -n "tenant-storage" `
  --mode Incremental `
  --template-file "infra/tenant/tenant-storage.bicep" `
  --parameters location=$location env=$Env tenantId=$TenantId storageAccountName=$storageAccountName tags=$tagsJson `
  -o json | ConvertFrom-Json

$storageResourceId = $deploymentResult.properties.outputs.storageAccountResourceId.value
$storageContainers = $deploymentResult.properties.outputs.containerNames.value

if ([string]::IsNullOrWhiteSpace($storageResourceId)) {
  $storageResourceId = az storage account show -g $tenantRg -n $storageAccountName --query id -o tsv 2>$null
}

if ([string]::IsNullOrWhiteSpace($storageResourceId)) {
  throw "Storage resourceId is empty after deployment for account '$storageAccountName' (rg=$tenantRg)."
}

Write-Host "Storage scope resourceId: $storageResourceId"

# Ensure Storage Blob Data Contributor for tenant UAMI (idempotent)
$hasStorageRole = az role assignment list `
  --assignee-object-id $uamiPrincipalId `
  --scope $storageResourceId `
  --query "[?roleDefinitionName=='Storage Blob Data Contributor'] | length(@)" `
  -o tsv

if ($hasStorageRole -eq "0") {
  Write-Host "Assigning Storage Blob Data Contributor to tenant UAMI..."
  az role assignment create `
    --assignee-object-id $uamiPrincipalId `
    --assignee-principal-type ServicePrincipal `
    --role "Storage Blob Data Contributor" `
    --scope $storageResourceId -o none
  Write-Host "Storage role assignment applied."
} else {
  Write-Host "Storage role assignment already present; skipping."
}

Write-Host "== Done =="
Write-Host "Tenant RG:   $tenantRg"
Write-Host "UAMI ID:     $uamiResourceId"
Write-Host "UAMI OID:    $uamiPrincipalId"
Write-Host "Storage:     $storageAccountName"
Write-Host "ACR:         $AcrName"
if ($storageContainers.Count -eq 0) { $storageContainers = @("ro-raw","ro-processed","ro-quarantine") }
Write-Host "Summary: tenantRg=$tenantRg uamiName=$uamiName storageAccountName=$storageAccountName containers=$($storageContainers -join ',')"
