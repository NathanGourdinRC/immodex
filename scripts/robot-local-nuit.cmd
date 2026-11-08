@echo off
rem Lance par la tache planifiee Windows "Immodex robot local", chaque nuit.
rem Le chemin de Node est ecrit en entier : une tache planifiee ne voit pas toujours le PATH de la session.
rem Journal : .immodex-robot.log pour le dernier passage, .immodex-robot.old.log pour celui d'avant.
cd /d "%~dp0.."
if exist .immodex-robot.log move /y .immodex-robot.log .immodex-robot.old.log >nul
echo Lancement %date% %time% > .immodex-robot.log
"C:\Program Files\nodejs\node.exe" scripts\robot-local.mjs >> .immodex-robot.log 2>&1
echo Fin %date% %time% code %errorlevel% >> .immodex-robot.log
