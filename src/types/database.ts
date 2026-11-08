export type EventStatus = 'open' | 'closed' | 'draft';
export type DietaryType = 'meat' | 'vegetarian' | 'none';
export type RegistrationStatus = 'confirmed' | 'waitlist' | 'cancelled';
export type VolunteerRole = 'volunteer' | 'staff_admin' | 'super_admin';

export interface EventShift {
  id: string;
  event_id: string;
  group_name: string;
  start_time: string;
  end_time: string;
  quota: number;
  waitlist_quota: number;
  confirmed_count: number;
  waitlist_count: number;
  sort_order: number;
  created_at?: string;
}

export interface VolunteerEvent {
  id: string;
  title: string;
  description: string;
  location: string;
  event_date: string;
  registration_deadline: string | null;
  status: EventStatus;
  created_at: string;
  event_shifts?: EventShift[];
}

export interface Registration {
  id: string;
  event_id: string;
  shift_id: string;
  volunteer_name: string;
  phone: string;
  email: string;
  id_number: string;
  birth_date: string;
  dietary: DietaryType;
  emergency_contact: string;
  emergency_phone: string;
  note: string;
  status: RegistrationStatus;
  checked_in: boolean;
  checked_in_at: string | null;
  role?: VolunteerRole;
  admin_pin?: string;
  created_at: string;
  event_shifts?: {
    group_name: string;
    start_time: string;
    end_time: string;
  };
  events?: {
    title: string;
    event_date: string;
  };
}

export interface LookupRegistrationResult {
  registration_id: string;
  event_id: string;
  event_title: string;
  event_date: string;
  event_location: string;
  shift_id: string;
  group_name: string;
  start_time: string;
  end_time: string;
  volunteer_name: string;
  phone: string;
  email: string;
  masked_id_number: string;
  dietary: DietaryType;
  emergency_contact: string;
  status: RegistrationStatus;
  checked_in: boolean;
  checked_in_at: string | null;
  created_at: string;
}
