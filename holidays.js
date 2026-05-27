// 대한민국 공휴일 (대체공휴일 포함). 필요 시 직접 수정/추가하면 됩니다.
// 정확도는 데모 수준이며, 실서비스라면 공휴일 OpenAPI 연동을 권장합니다.
window.KR_HOLIDAYS = {
  '2026-01-01': '신정',
  '2026-02-16': '설날 연휴',
  '2026-02-17': '설날',
  '2026-02-18': '설날 연휴',
  '2026-03-01': '삼일절',
  '2026-03-02': '삼일절 대체공휴일',
  '2026-05-05': '어린이날',
  '2026-05-24': '부처님오신날',
  '2026-05-25': '부처님오신날 대체공휴일',
  '2026-06-06': '현충일',
  '2026-08-15': '광복절',
  '2026-08-17': '광복절 대체공휴일',
  '2026-09-24': '추석 연휴',
  '2026-09-25': '추석',
  '2026-09-26': '추석 연휴',
  '2026-09-28': '추석 대체공휴일',
  '2026-10-03': '개천절',
  '2026-10-05': '개천절 대체공휴일',
  '2026-10-09': '한글날',
  '2026-12-25': '성탄절',
  '2027-01-01': '신정',
};

// 'YYYY-MM-DD' 로컬 날짜 키
window.dateKey = function (d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

window.parseDateKey = function (key) {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
};

window.isHoliday = function (key) {
  return !!window.KR_HOLIDAYS[key];
};

window.holidayName = function (key) {
  return window.KR_HOLIDAYS[key] || '';
};

// 토(6)·일(0)
window.isWeekend = function (key) {
  const day = window.parseDateKey(key).getDay();
  return day === 0 || day === 6;
};

// 휴일(공휴일 또는 주말) 여부
window.isDayOff = function (key) {
  return window.isHoliday(key) || window.isWeekend(key);
};

window.nextDateKey = function (key) {
  const d = window.parseDateKey(key);
  d.setDate(d.getDate() + 1);
  return window.dateKey(d);
};
