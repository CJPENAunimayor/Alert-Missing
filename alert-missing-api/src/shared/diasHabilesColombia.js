const BOGOTA_OFFSET_MS = -5 * 60 * 60 * 1000;

/**
 * Calcula el Domingo de Pascua (algoritmo gregoriano anónimo) para un año dado.
 */
function calcularPascua(anio) {
  const a = anio % 19;
  const b = Math.floor(anio / 100);
  const c = anio % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mes = Math.floor((h + l - 7 * m + 114) / 31);
  const dia = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(anio, mes - 1, dia));
}

function claveFechaUtc(dateUtc) {
  const y = dateUtc.getUTCFullYear();
  const m = String(dateUtc.getUTCMonth() + 1).padStart(2, '0');
  const d = String(dateUtc.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function sumarDiasUtc(dateUtc, dias) {
  return new Date(dateUtc.getTime() + dias * 86400000);
}

function trasladarALunesEmiliani(anio, mes, dia) {
  const d = new Date(Date.UTC(anio, mes - 1, dia));
  const dow = d.getUTCDay(); // 0=Dom, 1=Lun, ...
  if (dow === 1) return d;
  const diasHastaLunes = dow === 0 ? 1 : 8 - dow;
  return sumarDiasUtc(d, diasHastaLunes);
}

const cacheFestivosPorAnio = new Map();

/**
 * Retorna el conjunto de festivos oficiales de Colombia (YYYY-MM-DD) para un año.
 * Incluye festivos fijos, Ley Emiliani (lunes siguiente) y festivos basados en Pascua.
 */
export function obtenerFestivosColombia(anio) {
  if (cacheFestivosPorAnio.has(anio)) {
    return cacheFestivosPorAnio.get(anio);
  }

  const festivos = new Set();

  // Festivos fijos
  for (const [mes, dia] of [
    [1, 1], // Año Nuevo
    [5, 1], // Día del Trabajo
    [7, 20], // Independencia
    [8, 7], // Batalla de Boyacá
    [12, 8], // Inmaculada Concepción
    [12, 25], // Navidad
  ]) {
    festivos.add(claveFechaUtc(new Date(Date.UTC(anio, mes - 1, dia))));
  }

  // Festivos Ley Emiliani (trasladados al lunes siguiente)
  for (const [mes, dia] of [
    [1, 6], // Reyes Magos
    [3, 19], // San José
    [6, 29], // San Pedro y San Pablo
    [8, 15], // Asunción
    [10, 12], // Día de la Raza
    [11, 1], // Todos los Santos
    [11, 11], // Independencia de Cartagena
  ]) {
    festivos.add(claveFechaUtc(trasladarALunesEmiliani(anio, mes, dia)));
  }

  // Festivos ligados a Semana Santa / Pascua
  const pascua = calcularPascua(anio);
  festivos.add(claveFechaUtc(sumarDiasUtc(pascua, -3))); // Jueves Santo
  festivos.add(claveFechaUtc(sumarDiasUtc(pascua, -2))); // Viernes Santo
  festivos.add(claveFechaUtc(sumarDiasUtc(pascua, 43))); // Ascensión del Señor (lunes)
  festivos.add(claveFechaUtc(sumarDiasUtc(pascua, 64))); // Corpus Christi (lunes)
  festivos.add(claveFechaUtc(sumarDiasUtc(pascua, 71))); // Sagrado Corazón (lunes)

  cacheFestivosPorAnio.set(anio, festivos);
  return festivos;
}

/**
 * Indica si una fecha (interpretada en calendario local de Colombia) es día hábil.
 */
export function esDiaHabilColombia(fechaUtcEnBogota) {
  const dow = fechaUtcEnBogota.getUTCDay();
  if (dow === 0 || dow === 6) return false;
  const festivos = obtenerFestivosColombia(fechaUtcEnBogota.getUTCFullYear());
  return !festivos.has(claveFechaUtc(fechaUtcEnBogota));
}

/**
 * Suma N días hábiles colombianos (America/Bogota, UTC-5) preservando la hora exacta del día.
 * Ejemplo: viernes 15:00 + 1 día hábil -> lunes 15:00 (o martes 15:00 si el lunes es festivo).
 *
 * @param {Date|string} [fechaInicio]
 * @param {number} [diasHabiles=1]
 * @returns {string} Fecha límite en formato ISO-8601 UTC
 */
export function sumarDiasHabilesColombia(fechaInicio = new Date(), diasHabiles = 1) {
  const base = fechaInicio instanceof Date ? fechaInicio : new Date(fechaInicio);
  const diasObjetivo = Math.max(1, Math.floor(Number(diasHabiles) || 1));

  // Desplazar a reloj de pared de Bogotá (UTC-5, Colombia no aplica horario de verano)
  let bogotaMs = base.getTime() + BOGOTA_OFFSET_MS;
  let contados = 0;

  while (contados < diasObjetivo) {
    bogotaMs += 86400000;
    const fechaBogota = new Date(bogotaMs);
    if (esDiaHabilColombia(fechaBogota)) {
      contados += 1;
    }
  }

  // Volver a UTC real
  return new Date(bogotaMs - BOGOTA_OFFSET_MS).toISOString();
}
