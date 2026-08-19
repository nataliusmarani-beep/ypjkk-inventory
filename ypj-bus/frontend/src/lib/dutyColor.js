// One colour per nomor tugas (duty_number, 1-5) — besar and kecil are
// usually viewed one group at a time so the same 5-colour palette can be
// reused for both without the two ever being on screen at once to clash.
// Shared by anywhere that needs to tell buses apart by unit at a glance
// (Perjalanan Hari Ini timeline, event-request bus assignment).
export const DUTY_COLORS = ['#13407a', '#1a7a4c', '#b5790a', '#7a1a5c', '#1a5c7a'];
export const dutyColor = (n) => DUTY_COLORS[((n || 1) - 1) % DUTY_COLORS.length];
