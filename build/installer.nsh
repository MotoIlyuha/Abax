; Схема abax:// — кнопка «Открыть в приложении» на сайте запускает установленную Abax.
; macOS и Linux регистрируют схему из electron-builder.yml, а для Windows установщик
; electron-builder этого не делает, поэтому прописываем ключи сами.
; Приложение дополнительно регистрирует схему при каждом запуске (electron/main.cjs):
; так работает и переносная сборка, которую не устанавливают.

!macro customInstall
  WriteRegStr SHELL_CONTEXT "Software\Classes\abax" "" "URL:Abax"
  WriteRegStr SHELL_CONTEXT "Software\Classes\abax" "URL Protocol" ""
  WriteRegStr SHELL_CONTEXT "Software\Classes\abax\DefaultIcon" "" "$INSTDIR\${APP_EXECUTABLE_FILENAME},0"
  WriteRegStr SHELL_CONTEXT "Software\Classes\abax\shell\open\command" "" '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" "%1"'
!macroend

!macro customUnInstall
  ; установщик пишет в контекст установки, а приложение при запуске — в HKCU
  DeleteRegKey SHELL_CONTEXT "Software\Classes\abax"
  DeleteRegKey HKCU "Software\Classes\abax"
  DeleteRegKey HKLM "Software\Classes\abax"
!macroend
