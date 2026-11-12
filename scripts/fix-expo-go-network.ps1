# Requires Administrator
$ErrorActionPreference = 'Continue'
try {
  Set-NetConnectionProfile -InterfaceAlias 'Wi-Fi' -NetworkCategory Private -ErrorAction Stop
  Write-Host 'Wi-Fi set to Private'
} catch {
  Write-Host "Could not set Private (OK if Group Policy blocks): $($_.Exception.Message)"
}

foreach ($port in 8081, 19000, 19001) {
  $name = "Expo Metro $port"
  netsh advfirewall firewall delete rule name="$name" | Out-Null
  netsh advfirewall firewall add rule name="$name" dir=in action=allow protocol=TCP localport=$port profile=any | Out-Null
  Write-Host "Allowed inbound TCP $port (all profiles)"
}

# Also allow Node.js if we can find it
$node = (Get-Command node -ErrorAction SilentlyContinue)?.Source
if ($node) {
  netsh advfirewall firewall delete rule name="Node.js Expo" | Out-Null
  netsh advfirewall firewall add rule name="Node.js Expo" dir=in action=allow program="$node" enable=yes profile=any | Out-Null
  Write-Host "Allowed Node.js program: $node"
}

Write-Host ''
Write-Host 'DONE. Close this window, then run: npm run start:go'
Write-Host 'Scan the QR in that terminal.'
pause
