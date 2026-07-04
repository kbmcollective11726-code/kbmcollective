param(
  [ValidateSet('access-token', 'supabase')]
  [string]$Target = 'access-token'
)
$ErrorActionPreference = 'Stop'
Add-Type -Namespace Win32 -Name Cred -MemberDefinition @'
[StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)]
public struct CREDENTIAL { public int Flags; public int Type; public IntPtr TargetName; public IntPtr Comment; public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten; public int CredentialBlobSize; public IntPtr CredentialBlob; public int Persist; public int AttributeCount; public IntPtr Attributes; public IntPtr TargetAlias; public IntPtr UserName; }
[DllImport("advapi32.dll", CharSet=CharSet.Unicode, SetLastError=true)] public static extern bool CredRead(string target, int type, int reservedFlag, out IntPtr credentialPtr);
[DllImport("advapi32.dll")] public static extern void CredFree(IntPtr cred);
'@

$name = "Supabase CLI:$Target"
$ptr = [IntPtr]::Zero
if (-not [Win32.Cred]::CredRead($name, 1, 0, [ref]$ptr)) {
  Write-Error "CredRead failed for $name"
  exit 1
}

$cred = [Runtime.InteropServices.Marshal]::PtrToStructure($ptr, [type][Win32.Cred+CREDENTIAL])
$bytes = New-Object byte[] $cred.CredentialBlobSize
[Runtime.InteropServices.Marshal]::Copy($cred.CredentialBlob, $bytes, 0, $cred.CredentialBlobSize)
[Win32.Cred]::CredFree($ptr)

$token = [Text.Encoding]::UTF8.GetString($bytes).Trim([char]0)
if ($token -notmatch '^sbp_') {
  $token = [Text.Encoding]::Unicode.GetString($bytes).Trim([char]0)
}
Write-Output $token
