import { createClient } from '@supabase/supabase-js';
import type {
  DietaryType,
  RegistrationStatus,
  EventStatus,
  VolunteerRole,
} from '@/types/database';

const supabaseUrl =
  process.env.NEXT_PUBLIC_SUPABASE_URL ||
  'https://lsappuzizypupfvyiyxj.supabase.co';
const supabaseAnonKey =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  'sb_publishable_ny_2K-mUqbDGKHgBfes7mw_wUJQzcBd';

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

export function formatTimeRange(startTime: string, endTime: string): string {
  const s = startTime ? startTime.slice(0, 5) : '';
  const e = endTime ? endTime.slice(0, 5) : '';
  return `${s} - ${e}`;
}

export function getDietaryLabel(dietary: DietaryType): string {
  switch (dietary) {
    case 'meat':
      return '葷食';
    case 'vegetarian':
      return '素食';
    case 'none':
      return '不需供餐';
    default:
      return dietary;
  }
}

export function getRegistrationStatusMeta(status: RegistrationStatus): {
  label: string;
  badgeClass: string;
} {
  switch (status) {
    case 'confirmed':
      return {
        label: '正取',
        badgeClass: 'bg-emerald-100 text-emerald-800 border-emerald-200',
      };
    case 'waitlist':
      return {
        label: '候補中',
        badgeClass: 'bg-amber-100 text-amber-800 border-amber-200',
      };
    case 'cancelled':
      return {
        label: '已取消',
        badgeClass: 'bg-slate-100 text-slate-600 border-slate-200',
      };
  }
}

export function getEventStatusMeta(status: EventStatus): {
  label: string;
  badgeClass: string;
} {
  switch (status) {
    case 'open':
      return {
        label: '招募中',
        badgeClass: 'bg-emerald-100 text-emerald-800 border-emerald-200',
      };
    case 'closed':
      return {
        label: '報名截止',
        badgeClass: 'bg-slate-200 text-slate-700 border-slate-300',
      };
    case 'draft':
      return {
        label: '草稿 (未公開)',
        badgeClass: 'bg-amber-100 text-amber-800 border-amber-200',
      };
  }
}

export function getVolunteerRoleMeta(role?: VolunteerRole): {
  label: string;
  shortLabel: string;
  badgeClass: string;
} {
  switch (role) {
    case 'super_admin':
      return {
        label: '👑 最高管理員 (完整權限)',
        shortLabel: '👑 最高管理員',
        badgeClass: 'bg-purple-100 text-purple-800 border-purple-300',
      };
    case 'staff_admin':
      return {
        label: '🛡️ 志工幹部管理員 (簽到/名單管理)',
        shortLabel: '🛡️ 志工幹部管理員',
        badgeClass: 'bg-blue-100 text-blue-800 border-blue-300',
      };
    case 'volunteer':
    default:
      return {
        label: '一般志工 (無後台權限)',
        shortLabel: '一般志工',
        badgeClass: 'bg-slate-100 text-slate-600 border-slate-200',
      };
  }
}
