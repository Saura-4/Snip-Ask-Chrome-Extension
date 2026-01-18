@echo off
title Snip & Ask - Disable Offline Mode
echo.
echo [OPT-OUT] Disabling Offline AI Support...
echo.
echo This will remove the Ollama CORS configuration for the extension.
echo.

:: Clear the OLLAMA_ORIGINS environment variable
setx OLLAMA_ORIGINS ""

echo.
echo [DONE] Configuration cleared.
echo Please RESTART Ollama for changes to take effect.
echo.
pause