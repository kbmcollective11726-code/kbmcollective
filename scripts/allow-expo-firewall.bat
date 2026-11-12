@echo off
:: Right-click -> Run as administrator
:: Opens Windows Firewall for Expo Metro so Expo Go on your phone can connect.
netsh advfirewall firewall delete rule name="Expo Metro 8081" >nul 2>&1
netsh advfirewall firewall add rule name="Expo Metro 8081" dir=in action=allow protocol=TCP localport=8081 profile=private,domain
netsh advfirewall firewall add rule name="Expo Metro 19000" dir=in action=allow protocol=TCP localport=19000 profile=private,domain
netsh advfirewall firewall add rule name="Expo Metro 19001" dir=in action=allow protocol=TCP localport=19001 profile=private,domain
echo.
echo Firewall rules added for ports 8081, 19000, 19001 (private/domain).
echo Now on your PC run:  npm start
echo On phone Expo Go enter:  exp://192.168.5.95:8081
echo (Update IP if your PC Wi-Fi IP changed.)
echo.
pause
