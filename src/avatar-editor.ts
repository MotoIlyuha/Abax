// Выбор аватара: круг с буквами имени (по умолчанию), смайлом или фото. В правом нижнем углу круга — та же
// кнопка, что «Добавить иконку проекта» (src/icon-button.ts): смайл вместо букв. Ниже — «Установить фото»:
// системное окно выбора файла, затем обрезка под круг (src/avatar-crop.ts); с фото кнопка — «Удалить фото».
// Общий для окна первого входа и раздела настроек «Профиль».

import { createUserAvatar, updateUserAvatar } from './avatar';
import { closeAvatarCrop, openAvatarCrop } from './avatar-crop';
import { isAvatarEmoji, isAvatarPhoto } from './avatar-value';
import { cursorPreset } from './cursors';
import { createIconButton } from './icon-button';
import { closeIconPicker } from './icon-picker';

export interface AvatarEditorOptions {
  /** Текущий аватар: смайл, фото или null — буквы. */
  value: string | null;
  /** Имя (для букв). */
  name: string;
  /** Курсор: цвета круга — его плашки, как у аватара в шапке. */
  cursorId: string;
  /** Окна выбора смайла и обрезки — поверх модального окна. */
  overDialog?: boolean;
  onChange(value: string | null): void;
}

export interface AvatarEditor {
  el: HTMLElement;
  setName(name: string): void;
  setCursor(cursorId: string): void;
  /** Значение сменилось снаружи (например, пришло из аккаунта); onChange не вызывается. */
  setValue(value: string | null): void;
  value(): string | null;
  /** Закрыть окна выбора смайла и обрезки (окно под ними закрывается). */
  dispose(): void;
}

export function createAvatarEditor(o: AvatarEditorOptions): AvatarEditor {
  let value = o.value;
  let name = o.name;
  let cursorId = o.cursorId;
  let disposed = false;

  const root = document.createElement('div');
  root.className = 'ae';
  const face = document.createElement('div');
  face.className = 'ae-face';
  // круг — тот же аватар, что в шапке, без курсора и статуса; только показ
  const avatar = createUserAvatar({ name, bg: '#868e96', fg: '#ffffff', status: 'online' }, 'ae-avatar');
  avatar.tabIndex = -1;
  avatar.setAttribute('aria-hidden', 'true');

  const emoji = createIconButton({
    className: 'project-icon ae-emoji',
    value: isAvatarEmoji(value) ? value : null,
    showValue: false,
    title: v => (v ? 'Сменить смайл' : 'Смайл вместо букв'),
    picker: { label: 'Смайл аватара', upload: false, removeTitle: 'Вернуть буквы имени', overDialog: o.overDialog },
    onPick: v => set(v),
  });
  face.append(avatar, emoji.el);

  const photoBtn = document.createElement('button');
  photoBtn.type = 'button';
  photoBtn.className = 'ae-photo';
  const file = document.createElement('input');
  file.type = 'file';
  file.accept = 'image/*';
  file.hidden = true;
  photoBtn.addEventListener('click', () => {
    if (isAvatarPhoto(value)) { set(null); return; }
    file.value = '';
    file.click();
  });
  file.addEventListener('change', () => {
    const f = file.files?.[0];
    if (!f) return;
    void openAvatarCrop(f).then(photo => { if (photo && !disposed) set(photo); });
  });
  root.append(face, photoBtn, file);

  function paint(): void {
    const p = cursorPreset(cursorId);
    updateUserAvatar(avatar, { name, bg: p.badgeBg, fg: p.badgeText, cursorId, avatar: value, status: 'online', title: 'Ваш аватар' });
    const photo = isAvatarPhoto(value);
    photoBtn.textContent = photo ? 'Удалить фото' : 'Установить фото';
    photoBtn.classList.toggle('danger', photo);
    emoji.set(isAvatarEmoji(value) ? value : null);
  }

  function set(next: string | null): void {
    if (next === value) return;
    value = next;
    paint();
    o.onChange(value);
  }

  paint();
  return {
    el: root,
    setName(n) { if (n !== name) { name = n; paint(); } },
    setCursor(id) { if (id !== cursorId) { cursorId = id; paint(); } },
    setValue(v) { if (v !== value) { value = v; paint(); } },
    value: () => value,
    dispose() {
      if (disposed) return;
      disposed = true;
      closeIconPicker(true);
      closeAvatarCrop();
    },
  };
}
