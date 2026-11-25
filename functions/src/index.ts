import { initializeApp } from 'firebase-admin/app';

initializeApp();

export { scheduledReminderEngine } from './engine/reminderEngine';
export { scheduledMonthlyReport } from './engine/monthlyReport';
export { whatsappWebhook, paymentWebhook } from './webhooks/handlers';
