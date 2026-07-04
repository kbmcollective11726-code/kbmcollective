$ErrorActionPreference = 'Stop'
Add-Type -Namespace Win32 -Name Cred -MemberDefinition @'
[StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)]
public struct CREDENTIAL { public int Flags; public int Type; public IntPtr TargetName; public IntPtr Comment; public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten; public int CredentialBlobSize; public IntPtr CredentialBlob; public int Persist; public int AttributeCount; public IntPtr Attributes; public IntPtr TargetAlias; public IntPtr UserName; }
[DllImport("advapi32.dll", CharSet=CharSet.Unicode, SetLastError=true)] public static extern bool CredRead(string target, int type, int reservedFlag, out IntPtr credentialPtr);
[DllImport("advapi32.dll")] public static extern void CredFree(IntPtr cred);
'@

foreach ($target in @('Supabase CLI:access-token', 'Supabase CLI:supabase')) {
  $ptr = [IntPtr]::Zero
  if (-not [Win32.Cred]::CredRead($target, 1, 0, [ref]$ptr)) { continue }
  $cred = [Runtime.InteropServices.Marshal]::PtrToStructure($ptr, [type][Win32.Cred+CREDENTIAL])
  $bytes = New-Object byte[] $cred.CredentialBlobSize
  [Runtime.InteropServices.Marshal]::Copy($cred.CredentialBlob, $bytes, 0, $cred.CredentialBlobSize)
  [Win32.Cred]::CredFree($ptr)
  $raw = [Text.Encoding]::UTF8.GetString($bytes).Trim([char]0)
  Write-Output "TARGET=$target KIND=$($raw.Substring(0, [Math]::Min(6, $raw.Length))) LEN=$($raw.Length)"
  try {
    $json = $raw | ConvertFrom-Json
    Write-Output "  JSON_KEYS=$($json.PSObject.Properties.Name -join ',')"
  } catch {
    Write-Output "  NOT_JSON"
  }
}
