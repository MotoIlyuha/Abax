import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      {
        // модули клиента: DOM из jsdom, canvas и Path2D — заглушки из setup
        test: {
          name: 'unit',
          environment: 'jsdom',
          include: ['tests/unit/**/*.test.ts'],
          setupFiles: ['tests/unit/setup.ts'],
        },
      },
      {
        // сервер совместной работы и main-процесс Electron
        test: {
          name: 'server',
          environment: 'node',
          include: ['tests/server/**/*.test.ts'],
        },
      },
    ],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts', 'electron/**/*.cjs'],
      // интерфейс (DOM, canvas, события) проверяют сквозные тесты Playwright в e2e/
      exclude: [
        'src/app.ts', 'src/controller.ts', 'src/renderer.ts', 'src/main.ts', 'src/types.ts',
        'src/settings-dialog.ts', 'src/toolbar-editor.ts', 'src/page-transition.ts', 'src/hotkeys-settings.ts',
      ],
      reporter: ['text', 'html'],
    },
  },
});
