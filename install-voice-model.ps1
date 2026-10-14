$ErrorActionPreference = 'Stop'
$qtAssets = Join-Path $PSScriptRoot 'assets/tts'
New-Item -ItemType Directory -Force -Path "$qtAssets/model/onnx", "$qtAssets/model/voice_styles", "$qtAssets/runtime" | Out-Null
$qtRevision = 'aafc6e32416a594460b32413efc49d7fe4ce6d46'
$qtBase = "https://huggingface.co/supertone-oss-archive/supertonic-3/resolve/$qtRevision"
$qtFiles = @('LICENSE','README.md','onnx/tts.json','onnx/unicode_indexer.json','voice_styles/F1.json','voice_styles/F2.json','voice_styles/M1.json','voice_styles/M2.json','onnx/duration_predictor.onnx','onnx/text_encoder.onnx','onnx/vector_estimator.onnx','onnx/vocoder.onnx')
$qtTree = Invoke-RestMethod "https://huggingface.co/api/models/supertone-oss-archive/supertonic-3/tree/$qtRevision`?recursive=true"
foreach ($qtFile in $qtFiles) {
  $qtTarget = Join-Path "$qtAssets/model" $qtFile
  $qtMeta = $qtTree | Where-Object { $_.path -eq $qtFile }
  if (!(Test-Path -LiteralPath $qtTarget) -or (Get-Item -LiteralPath $qtTarget).Length -ne $qtMeta.size) {
    Invoke-WebRequest "$qtBase/$qtFile" -OutFile $qtTarget -TimeoutSec 600
  }
  if ($qtMeta.lfs.oid -and (Get-FileHash -LiteralPath $qtTarget).Hash.ToLower() -ne $qtMeta.lfs.oid) { throw "Hash mismatch: $qtFile" }
  Write-Output "Verified $qtFile ($((Get-Item -LiteralPath $qtTarget).Length) bytes)"
}
$qtCodeBase = 'https://raw.githubusercontent.com/supertone-oss-archive/supertonic/1e9799e964ea4c0dad7cde993b65c3c813a7b373'
Invoke-WebRequest "$qtCodeBase/web/helper.js" -OutFile "$qtAssets/helper.mjs" -TimeoutSec 60
Invoke-WebRequest "$qtCodeBase/LICENSE" -OutFile "$qtAssets/LICENSE-SUPERTONIC-CODE.txt" -TimeoutSec 60
foreach ($qtFile in @('ort.wasm.min.mjs','ort-wasm-simd-threaded.mjs','ort-wasm-simd-threaded.wasm')) {
  Invoke-WebRequest "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.30.0/dist/$qtFile" -OutFile "$qtAssets/runtime/$qtFile" -TimeoutSec 600
}
Invoke-WebRequest 'https://raw.githubusercontent.com/microsoft/onnxruntime/v1.30.0/LICENSE' -OutFile "$qtAssets/runtime/LICENSE.txt" -TimeoutSec 60
$qtHelper = [IO.File]::ReadAllText("$qtAssets/helper.mjs").Replace("from 'onnxruntime-web'", "from './runtime/ort.wasm.min.mjs'")
[IO.File]::WriteAllText("$qtAssets/helper.mjs", "// Vendored from Supertone; local import path changed. See LICENSE-SUPERTONIC-CODE.txt.`n" + $qtHelper)
Get-ChildItem -LiteralPath $qtAssets -Recurse -File | ForEach-Object { [PSCustomObject]@{ File = [IO.Path]::GetRelativePath($qtAssets, $_.FullName); Bytes = $_.Length; SHA256 = (Get-FileHash -LiteralPath $_.FullName).Hash } } | ConvertTo-Json | Set-Content "$qtAssets/manifest.json"
Write-Output 'AI voice model and browser runtime downloaded and manifest saved.'
