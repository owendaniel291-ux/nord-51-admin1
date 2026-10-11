@echo off
cd /d "%~dp0"
title NORD 51 - Boutique
where node >nul 2>nul
if errorlevel 1 (
  echo ERREUR : Node.js n'est pas installe ou n'est pas dans le PATH.
  echo Installe Node.js 18 ou plus recent, puis relance ce fichier.
  pause
  exit /b 1
)
echo Verification des dependances...
if not exist node_modules\nodemailer (
  call npm install
  if errorlevel 1 echo AVERTISSEMENT : installation des dependances impossible. Le site demarrera, mais les e-mails peuvent rester desactives.
)
echo Demarrage de la boutique NORD 51...
node server.js
if errorlevel 1 (
  echo.
  echo Le serveur s'est arrete. Verifie le message ci-dessus.
  pause
)
