param(
  [Parameter(Mandatory = $true)][string]$RequestPath,
  [Parameter(Mandatory = $true)][string]$ResponsePath,
  [switch]$ValidateOnly
)

$ErrorActionPreference = 'Stop'
$request = Get-Content -LiteralPath $RequestPath -Raw -Encoding UTF8 | ConvertFrom-Json
if (-not $request.nodeId -or -not $request.requestId -or -not $request.step) {
  throw 'Request requires nodeId, requestId and step'
}
if ($ValidateOnly) {
  Write-Output 'valid'
  exit 0
}

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
[System.Windows.Forms.Application]::EnableVisualStyles()

$form = New-Object System.Windows.Forms.Form
$form.Text = '需要你的决定'
$form.Size = New-Object System.Drawing.Size(520, 340)
$form.StartPosition = 'CenterScreen'
$form.TopMost = $true
$form.FormBorderStyle = 'FixedDialog'
$form.MaximizeBox = $false
$form.MinimizeBox = $false

$prompt = New-Object System.Windows.Forms.Label
$prompt.Location = New-Object System.Drawing.Point(20, 20)
$prompt.Size = New-Object System.Drawing.Size(470, 70)
$prompt.Text = [string]$request.prompt
$form.Controls.Add($prompt)

$meta = New-Object System.Windows.Forms.Label
$meta.Location = New-Object System.Drawing.Point(20, 94)
$meta.Size = New-Object System.Drawing.Size(470, 35)
$meta.Text = "步骤: $($request.step)   请求: $($request.requestId)"
$form.Controls.Add($meta)

$inputLabel = New-Object System.Windows.Forms.Label
$inputLabel.Location = New-Object System.Drawing.Point(20, 135)
$inputLabel.Size = New-Object System.Drawing.Size(470, 20)
$inputLabel.Text = '继续时传入的文本'
$form.Controls.Add($inputLabel)

$inputBox = New-Object System.Windows.Forms.TextBox
$inputBox.Location = New-Object System.Drawing.Point(20, 158)
$inputBox.Size = New-Object System.Drawing.Size(470, 70)
$inputBox.Multiline = $true
$inputBox.Text = [string]$request.text
$form.Controls.Add($inputBox)

$approve = New-Object System.Windows.Forms.Button
$approve.Text = '批准并继续'
$approve.Location = New-Object System.Drawing.Point(258, 248)
$approve.Size = New-Object System.Drawing.Size(110, 32)
$approve.Add_Click({ $form.Tag = 'approve'; $form.Close() })
$form.Controls.Add($approve)

$reject = New-Object System.Windows.Forms.Button
$reject.Text = '拒绝并终止'
$reject.Location = New-Object System.Drawing.Point(380, 248)
$reject.Size = New-Object System.Drawing.Size(110, 32)
$reject.Add_Click({ $form.Tag = 'reject'; $form.Close() })
$form.Controls.Add($reject)

[void]$form.ShowDialog()
$response = if ($form.Tag -eq 'approve' -or $form.Tag -eq 'reject') {
  [ordered]@{
    nodeId = [string]$request.nodeId
    requestId = [string]$request.requestId
    step = [string]$request.step
    decision = [string]$form.Tag
    text = [string]$inputBox.Text
  }
} else {
  [ordered]@{ cancelled = $true }
}
$response | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $ResponsePath -Encoding UTF8
Write-Output $ResponsePath
