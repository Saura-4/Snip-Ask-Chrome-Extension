@echo off
title Snip & Ask - Enable Offline Mode
echo.
echo [OPT-IN] Enabling Offline AI Support...
echo.
echo This will allow the 'Snip & Ask' extension (and ONLY this extension)
echo to communicate with your local Ollama instance.
echo.

:: REPLACE THIS with your actual ID after publishing!
set "EXTENSION_ID=YOUR_EXTENSION_ID_HERE"

:: If you are still testing locally, uncomment the line below:
:: set "EXTENSION_ID=*"

setx OLLAMA_ORIGINS "chrome-extension://%EXTENSION_ID%"

echo.
echo [DONE] Configuration saved.
echo Please RESTART Ollama for changes to take effect.
echo.
pause