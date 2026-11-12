@echo off
:: Right-click -> Run as administrator
:: Expo Go fails when Windows treats Wi-Fi as Public (inbound blocked).
echo === Expo Go network fix ===
echo.
echo 1) Try set Wi-Fi to Private...
powershell -NoProfile -Command "try { Set-NetConnectionProfile -InterfaceAlias 'Wi-Fi' -NetworkCategory Private; 'Wi-Fi set to Private' } catch { $_.Exception.Message }"
echo.
echo 2) Allow Metro through firewall on ALL profiles (Public included)...
netsh advfirewall firewall delete rule name="Expo Metro 8081" >nul 2>&1
netsh advfirewall firewall delete rule name="Expo Metro 19000" >nul 2>&1
netsh advfirewall firewall delete rule name="Expo Metro 19001" >nul 2>&1
netsh advfirewall firewall add rule name="Expo Metro 8081" dir=in action=allow protocol=TCP localport=8081 profile=any
netsh advfirewall firewall add rule name="Expo Metro 19000" dir=in action=allow protocol=TCP localport=19000 profile=any
netsh advfirewall firewall add rule name="Expo Metro 19001" dir=in action=allow protocol=TCP localport=19001 profile=any
echo.
echo Done.
echo Next:
echo   cd C:\Users\viper\OneDrive\Desktop\CollectiveLiveg
echo   npm run start:go
echo Then in Expo Go open: exp://192.168.5.95:8081
echo Or scan the NEW QR from that terminal.
echo.
pause
