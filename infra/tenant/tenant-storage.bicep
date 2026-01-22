@description('Deployment location (should match the tenant RG region).')
param location string

@description('Environment name, e.g. prod/stage/dev.')
param env string

@description('Tenant ID slug, e.g. t-aisharktooth-demo.')
param tenantId string

@description('Globally-unique storage account name (lowercase, 3-24 chars).')
param storageAccountName string

@description('Optional tags to apply to resources.')
param tags object = {}

var defaultTags = {
  'stai:env': env
  'stai:tenantId': tenantId
  'stai:component': 'tenant-storage'
}

var mergedTags = union(defaultTags, tags)

var containerNames = [
  'ro-raw'
  'ro-processed'
  'ro-quarantine'
]

resource stg 'Microsoft.Storage/storageAccounts@2023-01-01' = {
  name: storageAccountName
  location: location
  tags: mergedTags
  sku: {
    name: 'Standard_LRS'
  }
  kind: 'StorageV2'
  properties: {
    allowBlobPublicAccess: false
    minimumTlsVersion: 'TLS1_2'
    accessTier: 'Hot'
    publicNetworkAccess: 'Enabled'
    networkAcls: {
      defaultAction: 'Allow'
      bypass: 'AzureServices'
    }
    isHnsEnabled: true
  }
}

resource blob 'Microsoft.Storage/storageAccounts/blobServices@2023-01-01' = {
  name: '${stg.name}/default'
}

resource roRaw 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-01-01' = {
  name: '${blob.name}/${containerNames[0]}'
  properties: {}
}

resource roProcessed 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-01-01' = {
  name: '${blob.name}/${containerNames[1]}'
  properties: {}
}

resource roQuarantine 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-01-01' = {
  name: '${blob.name}/${containerNames[2]}'
  properties: {}
}

output storageAccountResourceId string = stg.id
output storageAccountName string = stg.name
output blobEndpoint string = stg.properties.primaryEndpoints.blob
output containerNames array = containerNames
