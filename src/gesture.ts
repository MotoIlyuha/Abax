// Идёт ли у пользователя жест на доске (перенос, рисование, ввод текста). Чужие правки в это время
// откладываются: жест держит в руках прежний массив элементов и затёр бы их при завершении.

type Probe = () => boolean;
const probes = new Set<Probe>();

/** Источник «жест идёт»; возвращает функцию отмены регистрации. */
export function addGestureProbe(probe: Probe): () => void {
  probes.add(probe);
  return () => { probes.delete(probe); };
}

export function gestureActive(): boolean {
  for (const p of probes) if (p()) return true;
  return false;
}
