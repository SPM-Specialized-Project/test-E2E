$ErrorActionPreference = 'Stop'

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$stagingRoot = Join-Path $repoRoot 'spm'
$testMappings = @(
  @{ Source = 'tests/US-007.1/execution-verdicts.spec.ts'; Destination = 'frontend/tests/run-code-sandbox/execution-verdicts.spec.ts' },
  @{ Source = 'tests/US-007.1/sandbox-isolation.spec.ts'; Destination = 'frontend/tests/run-code-sandbox/sandbox-isolation.spec.ts' },
  @{ Source = 'tests/US-007.2/us-007.2.spec.ts'; Destination = 'frontend/tests/US-007.2/us-007.2.spec.ts' },
  @{ Source = 'tests/us-008.2/us-008.2.spec.ts'; Destination = 'backend/test/us-008.2/us-008.2.spec.ts' },
  @{ Source = 'tests/us-009.1/issue-detection.spec.ts'; Destination = 'tests/us-009.1/issue-detection.spec.ts' },
  @{ Source = 'tests/us-012-3/retention-backup.spec.ts'; Destination = 'tests/us-012-3/retention-backup.spec.ts' },
  @{ Source = 'tests/US-012.2/admin-operations.spec.ts'; Destination = 'tests/US-012.2-admin-operations/admin-operations.spec.ts' },
  @{ Source = 'tests/US-012.4/semester-reset.spec.ts'; Destination = 'tests/US-012.4/semester-reset.spec.ts' }
)

foreach ($mapping in $testMappings) {
  $sourcePath = Join-Path $repoRoot $mapping.Source
  $destinationPath = Join-Path $stagingRoot $mapping.Destination
  $destinationDirectory = Split-Path -Parent $destinationPath

  if (-not (Test-Path -LiteralPath $sourcePath -PathType Leaf)) {
    throw "Native test source is missing: $($mapping.Source)"
  }

  New-Item -ItemType Directory -Path $destinationDirectory -Force | Out-Null
  Copy-Item -LiteralPath $sourcePath -Destination $destinationPath -Force
}

Write-Output "Staged $($testMappings.Count) Node/Vitest files into the checked-out SPM source tree."
