// ════════════════════════ Firebase ════════════════════════
const FIREBASE_CONFIG = {
  apiKey: 'AIzaSyBPPr7VX6VHXAmx-jRdEjVcZzAbra9EbLs',
  authDomain: 'hosing-5913f.firebaseapp.com',
  databaseURL: 'https://hosing-5913f-default-rtdb.firebaseio.com',
  projectId: 'hosing-5913f',
  storageBucket: 'hosing-5913f.firebasestorage.app',
  messagingSenderId: '445332229155',
  appId: '1:445332229155:web:eddbe748e4df89769af596',
};

firebase.initializeApp(FIREBASE_CONFIG);
const fbAuth = firebase.auth();
const fbDb = firebase.database();
const groupsRef = fbDb.ref('calendar/groups');

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];

// ─────────── 유틸 ───────────
function timeToMin(t) {
  if (!t) return null;
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}
function fmtDay(key) {
  const d = parseDateKey(key);
  return `${key} (${WEEKDAYS[d.getDay()]})`;
}
function daysBetween(a, b) {
  const A = parseDateKey(a).getTime();
  const B = parseDateKey(b).getTime();
  return Math.round((B - A) / 86400000);
}
function rangeKeys(startKey, endKey) {
  const s = parseDateKey(startKey);
  const e = parseDateKey(endKey);
  if (s > e) return rangeKeys(endKey, startKey);
  const out = [];
  const d = new Date(s);
  while (d <= e) {
    out.push(dateKey(d));
    d.setDate(d.getDate() + 1);
  }
  return out;
}
function addDaysKey(key, n) {
  const d = parseDateKey(key);
  d.setDate(d.getDate() + n);
  return dateKey(d);
}
function randId() {
  const a = new Uint8Array(9);
  crypto.getRandomValues(a);
  return Array.from(a, (b) => b.toString(36).padStart(2, '0')).join('');
}

// ─────────── localStorage ───────────
const LS = {
  nickname: {
    get: () => localStorage.getItem('cal.nickname') || '',
    set: (v) => localStorage.setItem('cal.nickname', v),
  },
  ownerKey: {
    get() {
      let k = localStorage.getItem('cal.ownerKey');
      if (!k) {
        k = randId() + randId();
        localStorage.setItem('cal.ownerKey', k);
      }
      return k;
    },
  },
  myGroups: { // 내가 만든(관리하는) 모임
    get() {
      try { return JSON.parse(localStorage.getItem('cal.myGroups') || '[]'); }
      catch (e) { return []; }
    },
    add(id, name) {
      const list = LS.myGroups.get().filter((x) => x.id !== id);
      list.unshift({ id, name, createdAt: Date.now() });
      localStorage.setItem('cal.myGroups', JSON.stringify(list));
    },
    updateName(id, name) {
      const list = LS.myGroups.get();
      const i = list.findIndex((x) => x.id === id);
      if (i >= 0) { list[i].name = name; localStorage.setItem('cal.myGroups', JSON.stringify(list)); }
    },
    remove(id) {
      const list = LS.myGroups.get().filter((x) => x.id !== id);
      localStorage.setItem('cal.myGroups', JSON.stringify(list));
    },
  },
  adminGrants: { // groupId -> adminToken (이 그룹에 대한 관리자 링크로 접속했음)
    get() {
      try { return JSON.parse(localStorage.getItem('cal.adminGrants') || '{}'); }
      catch (e) { return {}; }
    },
    set(id, token) {
      const map = LS.adminGrants.get();
      map[id] = token;
      localStorage.setItem('cal.adminGrants', JSON.stringify(map));
    },
    remove(id) {
      const map = LS.adminGrants.get();
      delete map[id];
      localStorage.setItem('cal.adminGrants', JSON.stringify(map));
    },
  },
  visited: { // 참여자로 최근 방문한 모임
    get() {
      try { return JSON.parse(localStorage.getItem('cal.visited') || '[]'); }
      catch (e) { return []; }
    },
    add(id, name) {
      const list = LS.visited.get().filter((x) => x.id !== id);
      list.unshift({ id, name, visitedAt: Date.now() });
      localStorage.setItem('cal.visited', JSON.stringify(list.slice(0, 20)));
    },
    remove(id) {
      const list = LS.visited.get().filter((x) => x.id !== id);
      localStorage.setItem('cal.visited', JSON.stringify(list));
    },
  },
};

const { createApp } = Vue;

createApp({
  data() {
    const params = new URLSearchParams(location.search);
    const now = new Date();
    return {
      authReady: false,
      user: null,
      authError: '',

      // 라우팅
      groupId: params.get('g') || '',
      groupMeta: null,
      groupLoading: false,
      groupNotFound: false,
      schedules: [],
      groupOff: null,

      // 홈
      newGroupName: '',
      myGroups: LS.myGroups.get(),
      visited: LS.visited.get(),

      // 사용자 별명
      nickname: LS.nickname.get(),
      nicknameDraft: LS.nickname.get(),
      showNickPrompt: false,
      ownerKey: LS.ownerKey.get(),

      // 달력
      calYear: now.getFullYear(),
      calMon: now.getMonth(),

      // 드래그
      dragging: false,
      dragStart: '',
      dragEnd: '',
      dragMoved: false,

      // 일정 모달
      modal: {
        open: false, mode: 'create', id: null,
        title: '', dateStart: '', dateEnd: '',
        allDay: true, start: '09:00', end: '18:00',
        memo: '', error: '',
      },

      // 하루 상세
      dayView: { open: false, key: '' },

      copied: false,

      // 추천 옵션 (기본 펼침)
      recOpen: true,
      rec: {
        rangeStart: dateKey(now),
        rangeEnd: dateKey(new Date(now.getFullYear(), now.getMonth() + 2, now.getDate())),
        minAvailable: 0, // 최소 가능 인원 (0 = 전원)
      },
    };
  },

  computed: {
    view() {
      if (!this.groupId) return 'home';
      if (this.groupLoading) return 'loading';
      if (this.groupNotFound) return 'notfound';
      return 'group';
    },
    isAdmin() {
      if (!this.groupMeta) return false;
      if (this.groupMeta.creatorKey === this.ownerKey) return true;
      const t = this.groupMeta.adminToken;
      if (t && LS.adminGrants.get()[this.groupId] === t) return true;
      return false;
    },
    calLabel() {
      return `${this.calYear}년 ${this.calMon + 1}월`;
    },
    // 참가자 목록 (일정을 등록한 사람들)
    participants() {
      const map = {};
      for (const s of this.schedules) {
        const k = s.ownerKey || s.ownerUid || 'unknown';
        if (!map[k]) map[k] = { key: k, name: s.ownerName || '익명', count: 0 };
        map[k].count++;
      }
      return Object.values(map).sort((a, b) => a.name.localeCompare(b.name));
    },
    // 내가 등록한 불가 일정
    mySchedules() {
      return this.schedules
        .filter((s) => s.ownerKey === this.ownerKey)
        .sort((a, b) => a.dateStart.localeCompare(b.dateStart));
    },
    // 6주 달력 셀
    calCells() {
      const first = new Date(this.calYear, this.calMon, 1);
      const start = new Date(first);
      start.setDate(1 - first.getDay());
      const todayKey = dateKey(new Date());
      const byDate = {};
      for (const s of this.schedules) {
        for (const k of rangeKeys(s.dateStart, s.dateEnd || s.dateStart)) {
          (byDate[k] || (byDate[k] = [])).push(s);
        }
      }
      const dragRange = this.dragging
        ? new Set(rangeKeys(this.dragStart, this.dragEnd || this.dragStart))
        : null;
      const recSet = this.recResult
        ? new Set(this.recResult.available.map((r) => r.key))
        : null;
      const cells = [];
      for (let i = 0; i < 42; i++) {
        const d = new Date(start);
        d.setDate(start.getDate() + i);
        const key = dateKey(d);
        const items = (byDate[key] || []).sort((a, b) =>
          (a.ownerName || '').localeCompare(b.ownerName || '')
        );
        cells.push({
          key,
          day: d.getDate(),
          dow: d.getDay(),
          inMonth: d.getMonth() === this.calMon,
          isToday: key === todayKey,
          holiday: holidayName(key),
          isHol: isHoliday(key),
          items,
          busyCount: (byDate[key] || []).length,
          inDrag: dragRange ? dragRange.has(key) : false,
          isRec: recSet ? recSet.has(key) : false,
        });
      }
      return cells;
    },
    allSorted() {
      return [...this.schedules].sort((a, b) =>
        (a.dateStart + (a.start || '')).localeCompare(b.dateStart + (b.start || ''))
      );
    },
    dayViewItems() {
      if (!this.dayView.open) return [];
      const k = this.dayView.key;
      return this.schedules
        .filter((s) => s.dateStart <= k && k <= (s.dateEnd || s.dateStart))
        .sort((a, b) => (a.ownerName || '').localeCompare(b.ownerName || ''));
    },
    shareUrl() {
      return `${location.origin}${location.pathname}?g=${this.groupId}`;
    },
    adminShareUrl() {
      if (!this.groupMeta || !this.groupMeta.adminToken) return '';
      return `${location.origin}${location.pathname}?g=${this.groupId}&admin=${this.groupMeta.adminToken}`;
    },
    // 가능 날짜 추천 (관리자·참여자 모두 볼 수 있음)
    recResult() {
      if (!this.recOpen) return null;
      const start = this.rec.rangeStart;
      const end = this.rec.rangeEnd;
      if (!start || !end) return null;
      const uniqPeople = this.participants.length; // 등록에 참여한 인원 수
      const busy = {}; // key -> Set<ownerKey>
      for (const s of this.schedules) {
        for (const k of rangeKeys(s.dateStart, s.dateEnd || s.dateStart)) {
          if (!busy[k]) busy[k] = new Set();
          busy[k].add(s.ownerKey || s.ownerUid || 'unknown');
        }
      }
      const need = Number(this.rec.minAvailable) || 0;
      const available = [];
      let blocked = 0;
      for (const k of rangeKeys(start, end)) {
        const blockers = busy[k] ? busy[k].size : 0;
        const canCount = Math.max(0, uniqPeople - blockers);
        // 등록한 참여자 중 얼마나 가능한가
        // need=0 → 전원 가능(blockers=0)만
        const passesStrict = need === 0 ? blockers === 0 : canCount >= need;
        if (!passesStrict) { blocked++; continue; }
        let score = 1;
        const reasons = [];
        const nd = addDaysKey(k, 1);
        if (isHoliday(nd)) { score += 3; reasons.push('다음날 ' + holidayName(nd)); }
        else if (isWeekend(nd)) { score += 2; reasons.push('다음날 주말'); }
        if (isDayOff(k)) { score += 1; reasons.push('당일 휴일'); }
        if (blockers === 0 && uniqPeople > 0) { score += 1; reasons.push('전원 가능'); }
        available.push({
          key: k, score, reasons,
          blockers, canCount, total: uniqPeople,
          blockNames: busy[k] ? [...busy[k]].map((ok) => {
            const p = this.participants.find((p) => p.key === ok);
            return p ? p.name : '?';
          }) : [],
        });
      }
      available.sort((a, b) => b.score - a.score || a.key.localeCompare(b.key));
      return { available: available.slice(0, 20), blocked, total: available.length, participants: uniqPeople };
    },
  },

  watch: {
    groupId(val) {
      if (val) this.loadGroup(val);
      else this.unloadGroup();
    },
  },

  methods: {
    // ── 라우팅 ──
    openGroup(id) {
      history.pushState({}, '', `${location.pathname}?g=${id}`);
      this.groupId = id;
    },
    goHome() {
      history.pushState({}, '', location.pathname);
      this.groupId = '';
      this.myGroups = LS.myGroups.get();
      this.visited = LS.visited.get();
    },
    handlePop() {
      const params = new URLSearchParams(location.search);
      this.groupId = params.get('g') || '';
    },

    // ── 그룹 로드/언로드 ──
    unloadGroup() {
      if (this.groupOff) { this.groupOff(); this.groupOff = null; }
      this.groupMeta = null;
      this.schedules = [];
      this.groupNotFound = false;
      this.recOpen = true;
    },
    loadGroup(id) {
      this.unloadGroup();
      this.groupLoading = true;
      const gRef = groupsRef.child(id);
      gRef.child('meta').once('value')
        .then((snap) => {
          const meta = snap.val();
          if (!meta) {
            this.groupNotFound = true;
            this.groupLoading = false;
            return;
          }
          // URL의 admin 파라미터가 meta.adminToken 과 일치하면 관리자로 인정
          const params = new URLSearchParams(location.search);
          const adminParam = params.get('admin');
          if (adminParam && meta.adminToken && adminParam === meta.adminToken) {
            LS.adminGrants.set(id, adminParam);
          }
          this.groupMeta = meta;
          const isAdminNow =
            meta.creatorKey === this.ownerKey ||
            (meta.adminToken && LS.adminGrants.get()[id] === meta.adminToken);
          if (isAdminNow) {
            LS.myGroups.add(id, meta.name || '(이름 없음)');
            this.myGroups = LS.myGroups.get();
            // 옛 그룹 마이그레이션: 관리자인데 meta.adminToken이 없으면 새로 발급
            if (!meta.adminToken) {
              const t = randId() + randId();
              gRef.child('meta').update({ adminToken: t }).then(() => {
                this.groupMeta = { ...this.groupMeta, adminToken: t };
                LS.adminGrants.set(id, t);
              });
            }
          } else {
            LS.visited.add(id, meta.name || '(이름 없음)');
            this.visited = LS.visited.get();
          }

          const sRef = gRef.child('schedules');
          const cb = (s) => {
            const val = s.val() || {};
            this.schedules = Object.values(val);
          };
          sRef.on('value', cb);
          this.groupOff = () => sRef.off('value', cb);
          this.groupLoading = false;
        })
        .catch((e) => {
          this.authError = '그룹 로드 실패: ' + e.message;
          this.groupLoading = false;
        });
    },

    // ── 새 모임 생성 (관리자) ──
    createGroup() {
      const name = this.newGroupName.trim();
      if (!name) return;
      if (!this.user) { this.authError = '인증 준비 중입니다.'; return; }
      if (!this.nickname) { this.showNickPrompt = true; return; }
      const ref = groupsRef.push();
      const adminToken = randId() + randId();
      ref.child('meta').set({
        id: ref.key,
        name,
        creatorUid: this.user.uid,
        creatorKey: this.ownerKey,
        creatorName: this.nickname,
        adminToken,
        createdAt: firebase.database.ServerValue.TIMESTAMP,
      })
        .then(() => {
          LS.adminGrants.set(ref.key, adminToken);
          this.newGroupName = '';
          this.openGroup(ref.key);
        })
        .catch((e) => (this.authError = '생성 실패: ' + e.message));
    },

    renameGroup() {
      if (!this.isAdmin) return;
      const cur = this.groupMeta.name;
      const v = prompt('모임 이름을 변경하세요.', cur);
      if (!v || v.trim() === cur) return;
      groupsRef.child(this.groupId).child('meta').update({ name: v.trim() })
        .then(() => {
          this.groupMeta.name = v.trim();
          LS.myGroups.updateName(this.groupId, v.trim());
          this.myGroups = LS.myGroups.get();
        });
    },
    deleteGroup() {
      if (!this.isAdmin) return;
      if (!confirm(`"${this.groupMeta.name}" 모임을 완전히 삭제할까요? 참여자들의 등록 내용도 모두 사라집니다.`)) return;
      groupsRef.child(this.groupId).remove()
        .then(() => {
          LS.myGroups.remove(this.groupId);
          this.myGroups = LS.myGroups.get();
          this.goHome();
        });
    },
    removeMyGroup(id, ev) {
      ev.stopPropagation();
      if (!confirm('목록에서 숨길까요? (모임 데이터는 유지됩니다)')) return;
      LS.myGroups.remove(id);
      this.myGroups = LS.myGroups.get();
    },
    removeVisited(id, ev) {
      ev.stopPropagation();
      LS.visited.remove(id);
      this.visited = LS.visited.get();
    },

    // ── 별명 ──
    openNickPrompt() {
      this.nicknameDraft = this.nickname;
      this.showNickPrompt = true;
    },
    saveNickname() {
      const v = this.nicknameDraft.trim();
      if (!v) return;
      LS.nickname.set(v);
      this.nickname = v;
      this.showNickPrompt = false;
      // 내가 등록한 기존 일정의 ownerName도 갱신
      if (this.groupId) {
        for (const s of this.schedules) {
          if (s.ownerKey === this.ownerKey && s.ownerName !== v) {
            groupsRef.child(this.groupId).child('schedules').child(s.id)
              .update({ ownerName: v }).catch(() => {});
          }
        }
      }
    },

    // ── 공유 링크 ──
    copyShare() {
      navigator.clipboard.writeText(this.shareUrl).then(() => {
        this.copied = 'member';
        setTimeout(() => (this.copied = false), 1500);
      });
    },
    copyAdminShare() {
      if (!this.adminShareUrl) return;
      navigator.clipboard.writeText(this.adminShareUrl).then(() => {
        this.copied = 'admin';
        setTimeout(() => (this.copied = false), 1500);
      });
    },

    // ── 달력 ──
    prevMonth() {
      if (this.calMon === 0) { this.calMon = 11; this.calYear--; }
      else this.calMon--;
    },
    nextMonth() {
      if (this.calMon === 11) { this.calMon = 0; this.calYear++; }
      else this.calMon++;
    },
    goToday() {
      const n = new Date();
      this.calYear = n.getFullYear();
      this.calMon = n.getMonth();
    },

    // ── 드래그 ──
    onCellDown(cell, ev) {
      if (ev.button !== undefined && ev.button !== 0) return;
      this.dragging = true;
      this.dragStart = cell.key;
      this.dragEnd = cell.key;
      this.dragMoved = false;
      ev.preventDefault();
    },
    onCellEnter(cell) {
      if (!this.dragging) return;
      if (cell.key !== this.dragEnd) {
        this.dragEnd = cell.key;
        this.dragMoved = true;
      }
    },
    onCellUp(cell, ev) {
      if (!this.dragging) return;
      this.dragging = false;
      const start = this.dragStart;
      const end = this.dragEnd || start;
      const [a, b] = daysBetween(start, end) >= 0 ? [start, end] : [end, start];
      if (!this.dragMoved && a === b) {
        this.openDayView(a);
      } else {
        this.openCreate(a, b);
      }
      this.dragStart = '';
      this.dragEnd = '';
      this.dragMoved = false;
    },
    onCalendarLeave() {
      if (this.dragging) {
        const start = this.dragStart;
        const end = this.dragEnd || start;
        const [a, b] = daysBetween(start, end) >= 0 ? [start, end] : [end, start];
        this.dragging = false;
        if (this.dragMoved) this.openCreate(a, b);
        this.dragStart = ''; this.dragEnd = ''; this.dragMoved = false;
      }
    },
    onTouchStart(cell, ev) {
      const t = ev.touches[0]; if (!t) return;
      this.dragging = true;
      this.dragStart = cell.key;
      this.dragEnd = cell.key;
      this.dragMoved = false;
    },
    onTouchMove(ev) {
      if (!this.dragging) return;
      const t = ev.touches[0]; if (!t) return;
      const el = document.elementFromPoint(t.clientX, t.clientY);
      const cellEl = el && el.closest && el.closest('[data-key]');
      if (cellEl) {
        const k = cellEl.getAttribute('data-key');
        if (k && k !== this.dragEnd) {
          this.dragEnd = k;
          this.dragMoved = true;
          ev.preventDefault();
        }
      }
    },
    onTouchEnd() {
      if (!this.dragging) return;
      const start = this.dragStart;
      const end = this.dragEnd || start;
      const [a, b] = daysBetween(start, end) >= 0 ? [start, end] : [end, start];
      this.dragging = false;
      if (!this.dragMoved && a === b) this.openDayView(a);
      else this.openCreate(a, b);
      this.dragStart = ''; this.dragEnd = ''; this.dragMoved = false;
    },

    // ── 일정 모달 ──
    openCreate(dateStart, dateEnd) {
      if (!this.ensureReady()) return;
      this.modal = {
        open: true, mode: 'create', id: null,
        title: '', dateStart, dateEnd: dateEnd || dateStart,
        allDay: true, start: '09:00', end: '18:00',
        memo: '', error: '',
      };
    },
    openEdit(s) {
      if (!this.canEdit(s)) return;
      this.dayView.open = false;
      this.modal = {
        open: true, mode: 'edit', id: s.id,
        title: s.title || '',
        dateStart: s.dateStart, dateEnd: s.dateEnd || s.dateStart,
        allDay: !!s.allDay,
        start: s.start || '09:00', end: s.end || '18:00',
        memo: s.memo || '',
        error: '',
      };
    },
    closeModal() { this.modal.open = false; },
    ensureReady() {
      if (!this.user) { this.authError = '인증 준비 중입니다.'; return false; }
      if (!this.nickname) { this.showNickPrompt = true; return false; }
      return true;
    },
    saveModal() {
      const m = this.modal;
      m.error = '';
      if (!m.dateStart || !m.dateEnd) { m.error = '날짜를 선택하세요.'; return; }
      let a = m.dateStart, b = m.dateEnd;
      if (a > b) [a, b] = [b, a];
      if (!m.allDay) {
        const s = timeToMin(m.start), e = timeToMin(m.end);
        if (s == null || e == null || e <= s) { m.error = '종료 시간이 시작 시간보다 늦어야 합니다.'; return; }
      }
      const sRef = groupsRef.child(this.groupId).child('schedules');
      const payload = {
        title: (m.title || '').trim() || '불가',
        dateStart: a, dateEnd: b,
        allDay: m.allDay,
        start: m.allDay ? null : m.start,
        end: m.allDay ? null : m.end,
        memo: m.memo || '',
        updatedAt: firebase.database.ServerValue.TIMESTAMP,
      };
      if (m.mode === 'edit' && m.id) {
        const target = this.schedules.find((x) => x.id === m.id);
        if (!target || !this.canEdit(target)) { m.error = '수정 권한이 없습니다.'; return; }
        sRef.child(m.id).update(payload)
          .then(() => (this.modal.open = false))
          .catch((e) => (m.error = '저장 실패: ' + e.message));
      } else {
        const ref = sRef.push();
        ref.set({
          id: ref.key,
          ownerUid: this.user.uid,
          ownerKey: this.ownerKey,
          ownerName: this.nickname,
          ...payload,
          createdAt: firebase.database.ServerValue.TIMESTAMP,
        })
          .then(() => (this.modal.open = false))
          .catch((e) => (m.error = '저장 실패: ' + e.message));
      }
    },
    deleteFromModal() {
      const m = this.modal;
      if (m.mode !== 'edit' || !m.id) return;
      const target = this.schedules.find((x) => x.id === m.id);
      if (!target || !this.canEdit(target)) return;
      if (!confirm(`"${target.title}" 일정을 삭제할까요?`)) return;
      groupsRef.child(this.groupId).child('schedules').child(m.id).remove()
        .then(() => (this.modal.open = false));
    },
    deleteSchedule(s) {
      if (!this.canEdit(s)) return;
      if (!confirm(`"${s.title}" 일정을 삭제할까요?`)) return;
      groupsRef.child(this.groupId).child('schedules').child(s.id).remove();
    },

    // ── 하루 상세 ──
    openDayView(key) { this.dayView = { open: true, key }; },
    closeDayView() { this.dayView.open = false; },
    addFromDayView() {
      const k = this.dayView.key;
      this.dayView.open = false;
      this.openCreate(k, k);
    },

    // ── 권한 ──
    canEdit(s) {
      if (!s) return false;
      if (this.ownerKey && s.ownerKey === this.ownerKey) return true;
      if (this.isAdmin) return true;   // 관리자는 모든 일정 수정/삭제 가능
      if (this.user && s.ownerUid === this.user.uid) return true;
      return false;
    },
    dayLabel(key) {
      let s = fmtDay(key);
      if (isHoliday(key)) s += ' · ' + holidayName(key);
      return s;
    },
    scheduleRange(s) {
      if (!s.dateEnd || s.dateStart === s.dateEnd) return fmtDay(s.dateStart);
      return `${s.dateStart} ~ ${s.dateEnd}`;
    },
    timeLabel(s) {
      return s.allDay ? '종일' : `${s.start}~${s.end}`;
    },
    jumpToDate(key) {
      const d = parseDateKey(key);
      this.calYear = d.getFullYear();
      this.calMon = d.getMonth();
      this.openDayView(key);
    },

    // ── 관리자 추천 ──
    toggleRec() { this.recOpen = !this.recOpen; },
  },

  mounted() {
    fbAuth.onAuthStateChanged((u) => {
      this.user = u;
      this.authReady = true;
      if (!u) {
        fbAuth.signInAnonymously().catch((e) => {
          this.authError =
            '익명 로그인 실패: ' + (e.code || '') + ' — Firebase 콘솔에서 익명 인증을 활성화해 주세요.';
        });
      } else {
        this.authError = '';
        if (this.groupId && !this.groupMeta && !this.groupLoading) {
          this.loadGroup(this.groupId);
        }
      }
    });
    window.addEventListener('popstate', this.handlePop);
    if (!this.nickname) this.showNickPrompt = true;
  },
  beforeUnmount() {
    this.unloadGroup();
    window.removeEventListener('popstate', this.handlePop);
  },

  template: `
<div class="wrap">
  <header class="topbar">
    <div class="brand" @click="goHome" style="cursor:pointer">🗓️ 일정 취합</div>
    <div class="auth">
      <span class="who" v-if="nickname">{{ nickname }}</span>
      <button class="mini" @click="openNickPrompt">{{ nickname ? '이름 변경' : '이름 설정' }}</button>
    </div>
  </header>

  <p v-if="authError" class="banner err">{{ authError }}</p>

  <!-- ══ 홈 ══ -->
  <template v-if="view === 'home'">
    <section class="card home-card">
      <h2>🛠 관리자: 새 모임 만들기</h2>
      <p class="help">모임을 만들면 이 브라우저가 관리자가 됩니다. 관리자만 참여자들의 불가 일정을 취합해 <b>가능한 날짜</b>를 추천받을 수 있어요.</p>
      <div class="row">
        <input v-model="newGroupName" placeholder="예: 3월 팀 워크샵 일정"
               @keyup.enter="createGroup" />
        <button class="btn" :disabled="!newGroupName.trim() || !authReady" @click="createGroup">모임 만들기</button>
      </div>
    </section>

    <section class="card" v-if="myGroups.length">
      <h2>내가 관리하는 모임</h2>
      <ul class="glist">
        <li v-for="g in myGroups" :key="g.id" @click="openGroup(g.id)">
          <div class="gname">👑 {{ g.name }}</div>
          <div class="gmeta">
            <span>ID: {{ g.id }}</span>
            <button class="mini danger" @click="removeMyGroup(g.id, $event)">숨기기</button>
          </div>
        </li>
      </ul>
    </section>

    <section class="card" v-if="visited.length">
      <h2>참여 중인 모임</h2>
      <ul class="glist">
        <li v-for="g in visited" :key="g.id" @click="openGroup(g.id)">
          <div class="gname">🙋 {{ g.name }}</div>
          <div class="gmeta">
            <span>ID: {{ g.id }}</span>
            <button class="mini danger" @click="removeVisited(g.id, $event)">숨기기</button>
          </div>
        </li>
      </ul>
    </section>

    <section class="card" v-if="!myGroups.length && !visited.length">
      <p class="empty">아직 참여한 모임이 없습니다. 위에서 새 모임을 만들거나 공유받은 링크로 접속하세요.</p>
    </section>
  </template>

  <template v-else-if="view === 'loading'">
    <section class="card"><p class="empty">불러오는 중…</p></section>
  </template>

  <template v-else-if="view === 'notfound'">
    <section class="card">
      <h2>모임을 찾을 수 없습니다</h2>
      <p class="empty">링크가 잘못되었거나 삭제된 모임일 수 있어요.</p>
      <div class="row"><button class="btn" @click="goHome">홈으로</button></div>
    </section>
  </template>

  <!-- ══ 모임 화면 ══ -->
  <template v-else>
    <div class="group-head">
      <div style="flex:1; min-width: 0;">
        <div class="ghead-name">
          <span v-if="isAdmin" class="admin-badge">관리자</span>
          {{ groupMeta && groupMeta.name }}
        </div>
        <div class="ghead-meta">
          <span class="cnt">참여자 {{ participants.length }}명 · 불가 {{ schedules.length }}건</span>
          <button class="mini" @click="goHome">← 홈</button>
          <button class="mini" @click="copyShare">{{ copied === 'member' ? '복사됨!' : '🔗 참여자 링크' }}</button>
          <template v-if="isAdmin">
            <button class="mini" @click="copyAdminShare" v-if="adminShareUrl">
              {{ copied === 'admin' ? '복사됨!' : '👑 관리자 링크' }}
            </button>
            <button class="mini" @click="renameGroup">이름 변경</button>
            <button class="mini danger" @click="deleteGroup">모임 삭제</button>
          </template>
        </div>
      </div>
    </div>

    <p v-if="!isAdmin" class="banner info">
      👋 참여자로 접속했습니다. 아래 달력에서 <b>참석이 어려운 날짜</b>를 드래그하거나 클릭해 등록해 주세요.
      관리자가 이 정보를 취합해 가능한 날짜를 정합니다.
    </p>

    <section class="card">
      <div class="cal-bar">
        <button class="mini" @click="prevMonth">‹</button>
        <span class="cal-label">{{ calLabel }}</span>
        <button class="mini" @click="nextMonth">›</button>
        <button class="mini" @click="goToday">오늘</button>
        <span class="cal-hint">클릭=상세 · 드래그=여러 날 불가 등록</span>
      </div>
      <div class="cal-grid cal-dow">
        <div v-for="(w, i) in ['일','월','화','수','목','금','토']" :key="w"
             :class="{ sun: i===0, sat: i===6 }">{{ w }}</div>
      </div>
      <div class="cal-grid cal-body"
           @mouseleave="onCalendarLeave"
           @touchmove.prevent="onTouchMove"
           @touchend="onTouchEnd">
        <div v-for="c in calCells" :key="c.key"
             class="cal-cell"
             :data-key="c.key"
             :class="{ out: !c.inMonth, today: c.isToday, hol: c.isHol, sun: c.dow===0, sat: c.dow===6, drag: c.inDrag, rec: c.isRec, hasbusy: c.busyCount > 0 }"
             @mousedown="onCellDown(c, $event)"
             @mouseenter="onCellEnter(c)"
             @mouseup="onCellUp(c, $event)"
             @touchstart="onTouchStart(c, $event)">
          <div class="cal-num">
            {{ c.day }}
            <span v-if="c.holiday" class="cal-hol">{{ c.holiday }}</span>
            <span v-if="c.isRec" class="rec-star">★</span>
          </div>
          <div class="cal-items">
            <div v-for="s in c.items.slice(0,4)" :key="s.id"
                 class="chip"
                 :class="{ mine: s.ownerKey === ownerKey }"
                 :title="s.ownerName + ' · ' + (s.allDay ? '종일' : s.start + '~' + s.end) + (s.title ? ' · ' + s.title : '')">
              🚫 {{ s.ownerName }}<span v-if="!s.allDay" class="chip-t"> {{ s.start }}</span>
            </div>
            <div v-if="c.items.length > 4" class="chip more">+{{ c.items.length - 4 }}</div>
          </div>
        </div>
      </div>
    </section>

    <!-- ── 가능 날짜 추천 (전원 열람 가능) ── -->
    <section class="card">
      <div style="display: flex; justify-content: space-between; align-items: center;">
        <h2 style="margin:0;">📅 가능 날짜 추천</h2>
        <button class="mini" @click="toggleRec">{{ recOpen ? '접기' : '펼치기' }}</button>
      </div>
      <p class="help" style="margin-top:10px;">
        참여자들이 등록한 <b>불가 일정</b>을 취합해서, 아래 기간 안에서 모두(또는 지정한 최소 인원)가 <b>가능한 날짜</b>를 점수순으로 보여줍니다.
        점수 가산 기준: <b>다음날 공휴일 +3</b> · <b>다음날 주말 +2</b> · <b>당일 휴일 +1</b> · <b>전원 가능 +1</b>.
        추천 날짜는 달력에도 ⭐로 표시돼요.
      </p>
      <div v-if="recOpen" style="margin-top: 6px;">
        <div class="formgrid">
          <div class="times">
            <label>시작일 <input type="date" v-model="rec.rangeStart" /></label>
            <label>종료일 <input type="date" v-model="rec.rangeEnd" /></label>
          </div>
          <label>최소 가능 인원
            <input type="number" min="0" v-model.number="rec.minAvailable"
                   :placeholder="'0이면 전원 가능만 (총 ' + participants.length + '명)'" />
          </label>
        </div>
        <div v-if="recResult" class="results">
          <p class="summary">
            추천 후보 <b>{{ recResult.total }}</b>일 · 제외 {{ recResult.blocked }}일 · 등록 참여자 {{ recResult.participants }}명
          </p>
          <div v-if="recResult.available.length === 0" class="empty">
            해당 조건에 맞는 날짜가 없습니다. 최소 인원을 낮추거나 범위를 조정해 보세요.
          </div>
          <ol class="ranked" v-else>
            <li v-for="r in recResult.available" :key="r.key"
                :class="{ top: r === recResult.available[0] }">
              <div class="rank-head">
                <span class="rday" @click="jumpToDate(r.key)" style="cursor:pointer;">{{ dayLabel(r.key) }}</span>
                <span class="rscore">⭐ {{ r.score }}</span>
              </div>
              <div class="rslots">
                가능 {{ r.canCount }}명 / 등록 {{ r.total }}명
                <span v-if="r.blockers > 0"> · 불가: {{ r.blockNames.join(', ') }}</span>
              </div>
              <div class="rreasons" v-if="r.reasons.length">{{ r.reasons.join(' · ') }}</div>
            </li>
          </ol>
        </div>
      </div>
    </section>

    <!-- ── 목록 ── -->
    <section class="card">
      <h2>{{ isAdmin ? '전체 불가 일정' : '내 불가 일정' }}</h2>
      <ul class="list">
        <li v-for="s in (isAdmin ? allSorted : mySchedules)" :key="s.id">
          <div class="item-main">
            <b>{{ s.ownerName }}</b>
            <span class="meta">
              {{ scheduleRange(s) }} · {{ timeLabel(s) }}
              <span v-if="s.title && s.title !== '불가'"> · {{ s.title }}</span>
            </span>
            <span v-if="s.memo" class="memo">{{ s.memo }}</span>
          </div>
          <div class="item-actions" v-if="canEdit(s)">
            <button class="mini" @click="openEdit(s)">수정</button>
            <button class="mini danger" @click="deleteSchedule(s)">삭제</button>
          </div>
        </li>
        <li v-if="(isAdmin ? allSorted : mySchedules).length === 0" class="empty">
          {{ isAdmin ? '아직 등록된 불가 일정이 없습니다.' : '내가 등록한 불가 일정이 없습니다. 달력에서 드래그해서 등록해 보세요.' }}
        </li>
      </ul>
    </section>
  </template>

  <!-- ══ 하루 상세 모달 ══ -->
  <div v-if="dayView.open" class="modal-bg" @click.self="closeDayView">
    <div class="modal">
      <div class="modal-head">
        <h3>{{ dayLabel(dayView.key) }}</h3>
        <button class="mini" @click="closeDayView">✕</button>
      </div>
      <div class="modal-body">
        <ul class="list" v-if="dayViewItems.length">
          <li v-for="s in dayViewItems" :key="s.id">
            <div class="item-main">
              <b>🚫 {{ s.ownerName }}</b>
              <span class="meta">
                {{ s.dateStart !== (s.dateEnd || s.dateStart) ? scheduleRange(s) + ' · ' : '' }}{{ timeLabel(s) }}
                <span v-if="s.title && s.title !== '불가'"> · {{ s.title }}</span>
              </span>
              <span v-if="s.memo" class="memo">{{ s.memo }}</span>
            </div>
            <div class="item-actions" v-if="canEdit(s)">
              <button class="mini" @click="openEdit(s)">수정</button>
              <button class="mini danger" @click="deleteSchedule(s)">삭제</button>
            </div>
          </li>
        </ul>
        <p v-else class="empty">이 날짜에 등록된 불가 일정이 없습니다.</p>
      </div>
      <div class="modal-foot">
        <button class="btn" @click="addFromDayView">＋ 내 불가 일정 추가</button>
      </div>
    </div>
  </div>

  <!-- ══ 등록/수정 모달 ══ -->
  <div v-if="modal.open" class="modal-bg" @click.self="closeModal">
    <div class="modal">
      <div class="modal-head">
        <h3>{{ modal.mode === 'edit' ? '불가 일정 수정' : '불가 일정 등록' }}</h3>
        <button class="mini" @click="closeModal">✕</button>
      </div>
      <div class="modal-body formgrid">
        <div class="times">
          <label>시작일 <input type="date" v-model="modal.dateStart" /></label>
          <label>종료일 <input type="date" v-model="modal.dateEnd" /></label>
        </div>
        <label class="check">
          <input type="checkbox" v-model="modal.allDay" /> 종일 (하루 전체)
        </label>
        <div class="times" v-if="!modal.allDay">
          <label>시작 <input type="time" v-model="modal.start" /></label>
          <label>종료 <input type="time" v-model="modal.end" /></label>
        </div>
        <label>사유(선택)
          <input v-model="modal.title" placeholder="예: 출장, 개인 일정, 휴가" />
        </label>
        <label>메모(선택)
          <input v-model="modal.memo" placeholder="추가 설명 (선택)" />
        </label>
        <p v-if="modal.error" class="err">{{ modal.error }}</p>
      </div>
      <div class="modal-foot">
        <button v-if="modal.mode === 'edit'" class="btn ghost danger" @click="deleteFromModal">삭제</button>
        <span style="flex:1"></span>
        <button class="btn ghost" @click="closeModal">취소</button>
        <button class="btn" @click="saveModal">{{ modal.mode === 'edit' ? '수정 저장' : '등록' }}</button>
      </div>
    </div>
  </div>

  <!-- ══ 별명 모달 ══ -->
  <div v-if="showNickPrompt" class="modal-bg" @click.self="showNickPrompt = false">
    <div class="modal small">
      <div class="modal-head"><h3>이름을 알려주세요</h3></div>
      <div class="modal-body formgrid">
        <p class="help">이 이름으로 불가 일정을 등록합니다. 이 브라우저에 저장되며 언제든 변경할 수 있어요.</p>
        <label>이름(별명)
          <input v-model="nicknameDraft" placeholder="예: 호성" @keyup.enter="saveNickname" />
        </label>
      </div>
      <div class="modal-foot">
        <button class="btn" :disabled="!nicknameDraft.trim()" @click="saveNickname">저장</button>
      </div>
    </div>
  </div>

  <footer class="foot">
    데이터: Firebase Realtime DB · 관리자는 이 브라우저에 저장된 키로 인식됩니다
  </footer>
</div>
`,
}).mount('#app');
