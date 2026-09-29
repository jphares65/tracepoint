param(
  [string]$Profile = 'tracepoint-production',
  [string]$ChangeSetName = 'tracepoint-production-cognito-password-20260929',
  [switch]$InspectExisting
)

$ErrorActionPreference = 'Stop'
$patchPath = Join-Path $PSScriptRoot '..\infra\changesets\production-cognito-password-20260929\patch.json'
$patch = Get-Content -LiteralPath $patchPath -Raw | ConvertFrom-Json

function Invoke-AwsJson([string[]]$Arguments) {
  $output = & aws @Arguments --profile $Profile --region $patch.region --output json
  if ($LASTEXITCODE -ne 0) { throw "AWS command failed: $($Arguments[0..1] -join ' ')" }
  return $output | ConvertFrom-Json
}

function CanonicalJson($Value) { return ConvertTo-Json -InputObject $Value -Depth 100 -Compress }

$identity = Invoke-AwsJson -Arguments @('sts', 'get-caller-identity')
if ($identity.Account -ne $patch.account) { throw 'Production AWS account guard failed.' }
$stack = (Invoke-AwsJson -Arguments @('cloudformation', 'describe-stacks', '--stack-name', $patch.stack)).Stacks[0]
if ($stack.StackStatus -notin @('CREATE_COMPLETE', 'UPDATE_COMPLETE') -or !$stack.EnableTerminationProtection) {
  throw 'Production Cognito stack is not stable and termination-protected.'
}
$resource = (Invoke-AwsJson -Arguments @('cloudformation', 'describe-stack-resource', '--stack-name', $patch.stack,
    '--logical-resource-id', $patch.poolLogicalId)).StackResourceDetail
if ($resource.PhysicalResourceId -ne $patch.poolId -or $resource.ResourceType -ne 'AWS::Cognito::UserPool') {
  throw 'Production Cognito pool identity guard failed.'
}
$pool = (Invoke-AwsJson -Arguments @('cognito-idp', 'describe-user-pool', '--user-pool-id', $patch.poolId)).UserPool
$mfa = Invoke-AwsJson -Arguments @('cognito-idp', 'get-user-pool-mfa-config', '--user-pool-id', $patch.poolId)
if ($pool.Policies.PasswordPolicy.MinimumLength -ne $patch.expectedMinimumLength -or
    $pool.Policies.PasswordPolicy.RequireLowercase -ne $true -or
    $pool.Policies.PasswordPolicy.RequireUppercase -ne $true -or
    $pool.Policies.PasswordPolicy.RequireNumbers -ne $true -or
    $pool.Policies.PasswordPolicy.RequireSymbols -ne $true -or
    $pool.Policies.PasswordPolicy.TemporaryPasswordValidityDays -ne 1 -or
    ($pool.Policies.PasswordPolicy.PSObject.Properties.Name -contains 'PasswordHistorySize') -or
    $pool.AdminCreateUserConfig.AllowAdminCreateUserOnly -ne $true -or
    ($pool.AdminCreateUserConfig.PSObject.Properties.Name -contains 'InviteMessageTemplate') -or
    $pool.EmailConfiguration.EmailSendingAccount -ne 'DEVELOPER' -or
    $pool.EmailConfiguration.From -ne 'TracePoint <notifications@tracepointhq.com>' -or
    $pool.EmailConfiguration.ConfigurationSet -ne 'tracepoint-production-cognito' -or
    $pool.UserPoolTier -ne 'ESSENTIALS' -or
    $pool.DeletionProtection -ne 'ACTIVE' -or
    @($pool.Policies.SignInPolicy.AllowedFirstAuthFactors).Count -ne 1 -or
    $pool.Policies.SignInPolicy.AllowedFirstAuthFactors[0] -ne 'PASSWORD' -or
    @($pool.UserAttributeUpdateSettings.AttributesRequireVerificationBeforeUpdate).Count -ne 0 -or
    @($pool.LambdaConfig.PSObject.Properties).Count -ne 0 -or
    $pool.KeyConfiguration.KeyType -ne 'AWS_OWNED_KEY' -or
    $pool.IssuerConfiguration.Type -ne 'ORIGINAL' -or
    $mfa.MfaConfiguration -ne 'ON' -or $mfa.SoftwareTokenMfaConfiguration.Enabled -ne $true) {
  throw 'Live Cognito pool differs from the reviewed baseline.'
}

$templateEnvelope = Invoke-AwsJson -Arguments @('cloudformation', 'get-template', '--stack-name', $patch.stack,
  '--template-stage', 'Original')
$template = if ($templateEnvelope.TemplateBody -is [string]) {
  $templateEnvelope.TemplateBody | ConvertFrom-Json
} else { $templateEnvelope.TemplateBody }
$beforeJson = CanonicalJson $template
$beforeHash = [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData([Text.Encoding]::UTF8.GetBytes($beforeJson)))
if ($beforeHash -ne $patch.baselineCanonicalSha256) { throw 'CloudFormation template fingerprint differs from the reviewed baseline.' }
if (@($template.Resources.PSObject.Properties).Count -ne 5 -or
    $template.Resources.$($patch.poolLogicalId).Type -ne 'AWS::Cognito::UserPool') {
  throw 'Unexpected production Cognito resource graph.'
}
$poolProperties = $template.Resources.$($patch.poolLogicalId).Properties
if ($poolProperties.Policies.PasswordPolicy.MinimumLength -ne $patch.expectedMinimumLength -or
    $poolProperties.AdminCreateUserConfig.AllowAdminCreateUserOnly -ne $true -or
    ($poolProperties.AdminCreateUserConfig.PSObject.Properties.Name -contains 'InviteMessageTemplate')) {
  throw 'CloudFormation pool properties differ from the reviewed baseline.'
}
$emailMessage = $patch.emailMessageLines -join "`n"
if ($emailMessage -notmatch "`n\{####\}`n" -or $emailMessage -match '\{####\}[.,;:!?]' -or
    $emailMessage -notmatch '\{username\}' -or $patch.emailSubject -ne 'Your temporary password') {
  throw 'Invitation-template placeholder or subject guard failed.'
}

$poolProperties.Policies.PasswordPolicy.MinimumLength = $patch.newMinimumLength
$poolProperties.AdminCreateUserConfig | Add-Member -NotePropertyName InviteMessageTemplate -NotePropertyValue ([pscustomobject]@{
  EmailSubject = $patch.emailSubject
  EmailMessage = $emailMessage
})

# Reverting only the two intended edits must reproduce every byte of the canonical baseline.
$afterJson = CanonicalJson $template
$poolProperties.Policies.PasswordPolicy.MinimumLength = $patch.expectedMinimumLength
$poolProperties.AdminCreateUserConfig.PSObject.Properties.Remove('InviteMessageTemplate')
if ((CanonicalJson $template) -cne $beforeJson) { throw 'Proposed template contains an unrelated change.' }

$temporaryTemplate = Join-Path ([IO.Path]::GetTempPath()) ("tracepoint-cognito-$([Guid]::NewGuid().ToString('N')).json")
try {
  [IO.File]::WriteAllText($temporaryTemplate, $afterJson, [Text.UTF8Encoding]::new($false))
  if (!$InspectExisting) {
    $create = Invoke-AwsJson -Arguments @('cloudformation', 'create-change-set', '--stack-name', $patch.stack,
      '--change-set-name', $ChangeSetName, '--change-set-type', 'UPDATE', '--template-body', "file://$temporaryTemplate",
      '--capabilities', 'CAPABILITY_NAMED_IAM')
  }
  for ($attempt = 0; $attempt -lt 30; $attempt++) {
    $changeSet = Invoke-AwsJson -Arguments @('cloudformation', 'describe-change-set', '--stack-name', $patch.stack,
      '--change-set-name', $ChangeSetName)
    if ($changeSet.Status -in @('CREATE_COMPLETE', 'FAILED')) { break }
    Start-Sleep -Seconds 2
  }
  if ($changeSet.Status -ne 'CREATE_COMPLETE') { throw "Change set preparation failed: $($changeSet.StatusReason)" }
  $changeSetTemplateEnvelope = Invoke-AwsJson -Arguments @('cloudformation', 'get-template', '--stack-name', $patch.stack,
    '--change-set-name', $ChangeSetName)
  $changeSetTemplate = if ($changeSetTemplateEnvelope.TemplateBody -is [string]) {
    $changeSetTemplateEnvelope.TemplateBody | ConvertFrom-Json
  } else { $changeSetTemplateEnvelope.TemplateBody }
  if ((CanonicalJson $changeSetTemplate) -cne $afterJson) { throw 'Change set template differs from the exact reviewed proposal.' }
  $changes = @($changeSet.Changes | ForEach-Object { $_.ResourceChange })
  $poolChange = @($changes | Where-Object LogicalResourceId -eq $patch.poolLogicalId)
  $dependentPolicy = @($changes | Where-Object LogicalResourceId -eq 'LifecycleAdministration8B7DE6EA')
  if ($changes.Count -ne 2 -or $poolChange.Count -ne 1 -or $dependentPolicy.Count -ne 1 -or
      $poolChange[0].Action -ne 'Modify' -or $poolChange[0].Replacement -ne 'False' -or
      $dependentPolicy[0].Action -ne 'Modify' -or $dependentPolicy[0].Replacement -ne 'False' -or
      $dependentPolicy[0].Details.Count -ne 1 -or $dependentPolicy[0].Details[0].Evaluation -ne 'Dynamic' -or
      $dependentPolicy[0].Details[0].CausingEntity -ne "$($patch.poolLogicalId).Arn") {
    throw 'Change set contains an unexpected resource change or replacement.'
  }
  [pscustomobject]@{
    Stack = $patch.stack
    PoolId = $patch.poolId
    ChangeSetId = $changeSet.ChangeSetId
    ChangeSetStatus = $changeSet.Status
    ResourceChanges = $changes | Select-Object LogicalResourceId, Action, Replacement
    ChangedProperties = @('Policies.PasswordPolicy.MinimumLength', 'AdminCreateUserConfig.InviteMessageTemplate.EmailSubject',
      'AdminCreateUserConfig.InviteMessageTemplate.EmailMessage')
    BaselineTemplateSha256 = $beforeHash
    ProposedTemplateSha256 = [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData([Text.Encoding]::UTF8.GetBytes($afterJson)))
    Executed = $false
  } | ConvertTo-Json -Depth 6
} finally {
  if (Test-Path -LiteralPath $temporaryTemplate) { Remove-Item -LiteralPath $temporaryTemplate }
}
