import { env } from '../shared/env.js';

const MAX_IDS_POR_LOTE = 500;

function esperar(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function dividirEnLotes(lista, tamano = MAX_IDS_POR_LOTE) {
  const lotes = [];
  for (let i = 0; i < lista.length; i += tamano) {
    lotes.push(lista.slice(i, i + tamano));
  }
  return lotes;
}

export class OneSignalClient {
  constructor({
    appId = env.ONESIGNAL_APP_ID,
    restApiKey = env.ONESIGNAL_REST_API_KEY,
    apiUrl = env.ONESIGNAL_API_URL,
    maxReintentos = env.WORKER_MAX_RETRIES || 3,
    backoffBaseMs = 400,
    timeoutMs = 8000,
    fetchImpl = fetch,
  } = {}) {
    this.appId = appId;
    this.restApiKey = restApiKey;
    this.apiUrl = apiUrl;
    this.maxReintentos = maxReintentos;
    this.backoffBaseMs = backoffBaseMs;
    this.timeoutMs = timeoutMs;
    this.fetchImpl = fetchImpl;
  }

  estaConfigurado() {
    return Boolean(
      this.appId &&
        this.restApiKey &&
        !this.appId.startsWith('tu_') &&
        !this.restApiKey.startsWith('tu_')
    );
  }

  /**
   * Envía notificaciones push por lotes vía API REST de OneSignal.
   * Asigna prioridad alta (priority: 10) cuando esAlertaRosa === true o prioridad === 'ALTA',
   * con reintentos exponenciales ante HTTP 429 (rate limit) o errores transitorios 5xx / red.
   */
  async enviarPorLotes({
    subscriptionIds = [],
    titulo,
    mensaje,
    esAlertaRosa = false,
    prioridad = 'NORMAL',
    datos = {},
    urlDestino = null,
    tamanoLote = MAX_IDS_POR_LOTE,
  }) {
    const idsUnicos = [...new Set((subscriptionIds || []).filter(Boolean))];
    if (idsUnicos.length === 0) {
      return { enviados: 0, fallidos: 0, lotes: [], omitidoSinDestinatarios: true };
    }

    if (!this.estaConfigurado()) {
      throw new Error(
        'OneSignal no está configurado (defina ONESIGNAL_APP_ID y ONESIGNAL_REST_API_KEY válidos).'
      );
    }

    const altaPrioridad = Boolean(esAlertaRosa) || String(prioridad).toUpperCase() === 'ALTA';
    const lotes = dividirEnLotes(idsUnicos, tamanoLote);
    const resultadosLotes = [];
    let enviados = 0;
    let fallidos = 0;

    for (const lote of lotes) {
      const cuerpo = {
        app_id: this.appId,
        target_channel: 'push',
        include_subscription_ids: lote,
        headings: {
          es: esAlertaRosa ? `🚨 ALERTA ROSA (Ley 2326): ${titulo}` : titulo,
          en: esAlertaRosa ? `🚨 ALERTA ROSA: ${titulo}` : titulo,
        },
        contents: {
          es: mensaje,
          en: mensaje,
        },
        priority: altaPrioridad ? 10 : 5,
        ttl: altaPrioridad ? 86400 : 43200,
        data: {
          ...datos,
          esAlertaRosa: Boolean(esAlertaRosa),
          prioridad: altaPrioridad ? 'ALTA' : 'NORMAL',
        },
      };

      if (urlDestino) {
        cuerpo.url = urlDestino;
      }

      try {
        const resLote = await this._enviarConReintentos(cuerpo);
        enviados += lote.length;
        resultadosLotes.push({ ok: true, cantidad: lote.length, respuesta: resLote });
      } catch (err) {
        fallidos += lote.length;
        resultadosLotes.push({ ok: false, cantidad: lote.length, error: err.message });
      }
    }

    return {
      enviados,
      fallidos,
      lotes: resultadosLotes,
      prioridadAplicada: altaPrioridad ? 'ALTA' : 'NORMAL',
    };
  }

  async _enviarConReintentos(cuerpo) {
    let ultimoError = null;

    for (let intento = 0; intento <= this.maxReintentos; intento += 1) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);

      try {
        const response = await this.fetchImpl(this.apiUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json; charset=utf-8',
            Authorization: `Key ${this.restApiKey}`,
          },
          body: JSON.stringify(cuerpo),
          signal: controller.signal,
        });

        clearTimeout(timer);

        const data = await response.json().catch(() => ({}));

        if (response.ok) {
          return data;
        }

        const esReintentable = response.status === 429 || response.status >= 500;
        ultimoError = new Error(
          `OneSignal HTTP ${response.status}: ${JSON.stringify(data.errors || data)}`
        );

        if (!esReintentable || intento === this.maxReintentos) {
          throw ultimoError;
        }

        const retryAfterSec = Number(response.headers?.get('retry-after'));
        const esperaMs =
          Number.isFinite(retryAfterSec) && retryAfterSec > 0
            ? retryAfterSec * 1000
            : this.backoffBaseMs * Math.pow(2, intento) + Math.floor(Math.random() * 150);

        await esperar(esperaMs);
      } catch (error) {
        clearTimeout(timer);
        ultimoError = error;

        if (intento === this.maxReintentos) {
          throw ultimoError;
        }

        const esperaMs =
          this.backoffBaseMs * Math.pow(2, intento) + Math.floor(Math.random() * 150);
        await esperar(esperaMs);
      }
    }

    throw ultimoError || new Error('Error desconocido al enviar notificación por OneSignal.');
  }
}
