import type { PlanTier } from '../src/types';

export interface AdminPage<T> { items: T[]; page: number; hasMore: boolean }
export interface AdminSession { id: string; displayName: string }
export interface AdminSummary { users: number; promos: number; pendingPayments: number; blockedAliases: number }

export interface AdminUser {
  id: string;
  displayName: string;
  email: string | null;
  googleEmail: string | null;
  google: boolean;
  telegramId: string | null;
  telegramUsername: string | null;
  storedPlan: string;
  plan: PlanTier;
  expiresAt: number | null;
  expired: boolean;
  trial: boolean;
  createdAt: number;
}

export interface AdminPromo {
  code: string;
  reference: string;
  plan: string;
  days: number;
  uses: number;
  maxUses: number | null;
  expiresAt: number | null;
  disabledAt: number | null;
  status: 'active' | 'disabled' | 'expired' | 'exhausted' | 'invalid';
}

export interface AdminPayment {
  id: string;
  providerId: string | null;
  userId: string;
  userName: string;
  email: string | null;
  plan: string;
  amount: number;
  status: string;
  provider: string;
  createdAt: number;
  resolvedAt: number | null;
}

export interface AdminAlias {
  alias: string;
  state: string;
  ownerId: string | null;
  ownerName: string | null;
  ownerEmail: string | null;
  projectId: string | null;
  blockedAt: number | null;
  blockedReason: string | null;
}

export const AUDIT_OPERATIONS = {
  'plan.set': 'Назначение тарифа',
  'promo.create': 'Создание промокода',
  'promo.disable': 'Отключение промокода',
  'alias.block': 'Блокировка адреса',
  'alias.unblock': 'Разблокировка адреса',
} as const;

export type AuditOperation = keyof typeof AUDIT_OPERATIONS;

export interface AdminAudit {
  id: number;
  adminId: string;
  adminName: string | null;
  createdAt: number;
  operation: AuditOperation;
  objectId: string;
  reason: string;
  change: Record<string, unknown>;
}
