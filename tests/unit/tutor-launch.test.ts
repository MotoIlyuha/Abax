import { expect, it } from 'vitest';
import { launchesTutor, telegramData } from '../../src/tutor-launch';
it('выбирает кабинет по адресу и окружению, сохраняет переход на доску и приглашение', () => {
  for (const url of ['https://a.test/tutor','https://a.test/?route=tutor','https://tutor.a.test/','https://a.test/#tgWebAppData=signed']) expect(launchesTutor(url)).toBe(true);
  for (const url of ['https://a.test/','https://tutor.a.test/?route=board','https://tutor.a.test/j/abc','https://tutor.a.test/?route=collab']) expect(launchesTutor(url)).toBe(false);
  expect(telegramData('https://a.test/#tgWebAppData=x%3D1%26y%3D2')).toBe('x=1&y=2');
});
