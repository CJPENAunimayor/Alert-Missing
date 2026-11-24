const TIPOS_PERMITIDOS = new Set(['image/jpeg', 'image/jpg', 'image/png', 'image/webp']);

/**
 * Carga un archivo File/Blob en un HTMLImageElement para procesarlo con <canvas>.
 */
function cargarImagenDesdeArchivo(archivo) {
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(archivo);
    const img = new Image();

    img.onload = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(img);
    };

    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error('No se pudo leer la imagen seleccionada. Verifique que el archivo sea válido.'));
    };

    img.src = objectUrl;
  });
}

/**
 * Comprime una imagen en el navegador usando <canvas> antes de subirla al backend.
 * - Ancho máximo por defecto: 1200 px (mantiene proporción y no amplía imágenes más pequeñas).
 * - Calidad por defecto: 0.8 en formato JPEG para optimizar redes móviles.
 *
 * @param {File} archivo
 * @param {{ maxWidth?: number, quality?: number, outputType?: string }} [opciones]
 */
export async function comprimirImagen(
  archivo,
  { maxWidth = 1200, quality = 0.8, outputType = 'image/jpeg' } = {}
) {
  if (!(archivo instanceof Blob)) {
    throw new Error('Debe seleccionar un archivo de imagen válido.');
  }

  const tipoEntrada = (archivo.type || '').toLowerCase();
  if (!TIPOS_PERMITIDOS.has(tipoEntrada)) {
    throw new Error('Formato no soportado. Use imágenes en formato JPG, PNG o WebP.');
  }

  const imagen = await cargarImagenDesdeArchivo(archivo);

  let anchoDestino = imagen.naturalWidth || imagen.width;
  let altoDestino = imagen.naturalHeight || imagen.height;

  if (anchoDestino > maxWidth) {
    const escala = maxWidth / anchoDestino;
    anchoDestino = Math.round(maxWidth);
    altoDestino = Math.max(1, Math.round(altoDestino * escala));
  }

  const canvas = document.createElement('canvas');
  canvas.width = anchoDestino;
  canvas.height = altoDestino;

  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('El navegador no soporta compresión de imágenes con Canvas 2D.');
  }

  // Fondo blanco para evitar transparencias negras al exportar PNG a JPEG
  if (outputType === 'image/jpeg') {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, anchoDestino, altoDestino);
  }

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(imagen, 0, 0, anchoDestino, altoDestino);

  const base64 = canvas.toDataURL(outputType, quality);

  // Calcular tamaño aproximado en bytes del resultado comprimido
  const datosPuros = base64.split(',')[1] || '';
  const tamanoComprimidoBytes = Math.round((datosPuros.length * 3) / 4);

  const nombreBase = (archivo.name || 'fotografia').replace(/\.[^/.]+$/, '');
  const extension = outputType === 'image/webp' ? 'webp' : 'jpg';

  return {
    base64,
    contentType: outputType,
    nombreArchivo: `${nombreBase}.${extension}`,
    tamanoOriginalBytes: archivo.size,
    tamanoComprimidoBytes,
    ancho: anchoDestino,
    alto: altoDestino,
  };
}

/**
 * Formatea bytes a texto legible (KB / MB).
 */
export function formatearTamanoBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 KB';
  if (bytes < 1024 * 1024) {
    return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}
