import nodemailer from 'nodemailer';
import { env } from '../shared/env.js';

export class CanalAlternoClient {
  constructor({
    smtpConfig = {
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      secure: env.SMTP_SECURE,
      user: env.SMTP_USER,
      pass: env.SMTP_PASS,
      from: env.MAIL_FROM,
    },
    smsConfig = {
      webhookUrl: env.SMS_WEBHOOK_URL,
      apiKey: env.SMS_API_KEY,
      senderId: env.SMS_SENDER_ID,
    },
    fetchImpl = fetch,
  } = {}) {
    this.smtpConfig = smtpConfig;
    this.smsConfig = smsConfig;
    this.fetchImpl = fetchImpl;
    this._transporter = null;
  }

  esEmailConfigurado() {
    return Boolean(
      this.smtpConfig.host &&
        !this.smtpConfig.host.includes('ejemplo.com') &&
        this.smtpConfig.user &&
        this.smtpConfig.pass &&
        !this.smtpConfig.pass.startsWith('tu_')
    );
  }

  esSmsConfigurado() {
    return Boolean(this.smsConfig.webhookUrl);
  }

  _obtenerTransporter() {
    if (!this._transporter) {
      this._transporter = nodemailer.createTransport({
        host: this.smtpConfig.host,
        port: this.smtpConfig.port,
        secure: this.smtpConfig.secure,
        auth: {
          user: this.smtpConfig.user,
          pass: this.smtpConfig.pass,
        },
      });
    }
    return this._transporter;
  }

  /**
   * Envío de respaldo por correo electrónico usando Nodemailer (SMTP).
   */
  async enviarEmail({ destinatario, asunto, texto, html = null }) {
    if (!destinatario) {
      throw new Error('Destinatario de correo electrónico requerido.');
    }

    if (!this.esEmailConfigurado()) {
      // Modo seguro cuando SMTP aún no está configurado en entorno local
      console.warn(
        `[CanalAlternoClient] SMTP no configurado; correo simulado para ${destinatario}: "${asunto}"`
      );
      return {
        enviado: true,
        simulado: true,
        canal: 'EMAIL',
        destinatario,
      };
    }

    const transporter = this._obtenerTransporter();
    const info = await transporter.sendMail({
      from: this.smtpConfig.from,
      to: destinatario,
      subject: asunto,
      text: texto,
      html: html || undefined,
    });

    return {
      enviado: true,
      simulado: false,
      canal: 'EMAIL',
      destinatario,
      messageId: info.messageId,
    };
  }

  /**
   * Adaptador SMS (compatible con pasarelas HTTP/Webhook como Twilio/Hablamelo/AWS SNS).
   */
  async enviarSms({ telefono, mensaje }) {
    if (!telefono) {
      throw new Error('Número de teléfono requerido para envío SMS.');
    }

    if (!this.esSmsConfigurado()) {
      console.warn(
        `[CanalAlternoClient] SMS_WEBHOOK_URL no configurado; SMS simulado para ${telefono}: "${mensaje.slice(0, 80)}"`
      );
      return {
        enviado: true,
        simulado: true,
        canal: 'SMS',
        destinatario: telefono,
      };
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);

    try {
      const response = await this.fetchImpl(this.smsConfig.webhookUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(this.smsConfig.apiKey ? { Authorization: `Bearer ${this.smsConfig.apiKey}` } : {}),
        },
        body: JSON.stringify({
          to: telefono,
          from: this.smsConfig.senderId,
          body: mensaje,
        }),
        signal: controller.signal,
      });

      clearTimeout(timer);

      if (!response.ok) {
        throw new Error(`Pasarela SMS respondió HTTP ${response.status}`);
      }

      const data = await response.json().catch(() => ({}));
      return {
        enviado: true,
        simulado: false,
        canal: 'SMS',
        destinatario: telefono,
        respuesta: data,
      };
    } catch (error) {
      clearTimeout(timer);
      throw error;
    }
  }
}
