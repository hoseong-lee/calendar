// ════════════════════════ Firebase ════════════════════════
// 인증정보는 travel 프로젝트(hosing-5913f)와 동일한 프로젝트를 사용합니다.
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
const schedulesRef = fbDb.ref('calendar/schedules');

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];

function genToken() {
  const a = new Uint8Array(12);
  crypto.getRandomValues(a);
  return Array.from(a, (b) => b.toString(16).padStart(2, '0')).join('');
}
function timeToMin(t) {
  if (!t) return null;
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}
function minToTime(v) {
  const h = Math.floor(v / 60);
  const m = v % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}
function fmtDay(key) {
  const d = parseDateKey(key);
  return `${key} (${WEEKDAYS[d.getDay()]})`;
}

const { createApp } = Vue;

createApp({
  data() {
    const params = new URLSearchParams(location.search);
    const today = dateKey(new Date());
    const plus = (days) => {
      const d = new Date();
      d.setDate(d.getDate() + days);
      return dateKey(d);
    };
    return {
      authReady: false,
      user: null,
      authError: '',
      schedules: [],
      // 일정 등록/수정 폼
      form: { id: null, title: '', date: today, allDay: false, start: '19:00', end: '21:00' },
      formError: '',
      // 공유 링크 컨텍스트
      share: { id: params.get('share'), token: params.get('token') },
      // 최적 일정 계산기
      opt: {
        rangeStart: today,
        rangeEnd: plus(30),
        dayStart: '09:00',
        dayEnd: '22:00',
        duration: 120,
        strict: true,
        selected: {}, // uid -> bool
      },
      results: null,
      copied: '',
    };
  },

  computed: {
    myShareTarget() {
      if (!this.share.id || !this.share.token) return null;
      const s = this.schedules.find((x) => x.id === this.share.id);
      if (s && s.shareToken === this.share.token) return s;
      return null;
    },
    mySchedules() {
      if (!this.user) return [];
      return this.schedules
        .filter((s) => s.ownerUid === this.user.uid)
        .sort((a, b) => (a.date + (a.start || '')).localeCompare(b.date + (b.start || '')));
    },
    // 일정을 등록한 사람들 목록 (최적화 대상 후보)
    participants() {
      const map = {};
      for (const s of this.schedules) {
        if (!map[s.ownerUid]) map[s.ownerUid] = { uid: s.ownerUid, name: s.ownerName || '익명', count: 0 };
        map[s.ownerUid].count++;
      }
      return Object.values(map).sort((a, b) => a.name.localeCompare(b.name));
    },
    allSorted() {
      return [...this.schedules].sort((a, b) =>
        (a.date + (a.start || '')).localeCompare(b.date + (b.start || ''))
      );
    },
  },

  methods: {
    // ── 인증 ──
    signIn() {
      const p = new firebase.auth.GoogleAuthProvider();
      fbAuth.signInWithPopup(p).catch((e) => {
        if (e.code === 'auth/popup-blocked' || e.code === 'auth/popup-closed-by-user') {
          fbAuth.signInWithRedirect(p);
        } else {
          this.authError = '로그인 실패: ' + e.message;
        }
      });
    },
    signOut() {
      fbAuth.signOut();
    },
    // 공유 링크 방문자가 비로그인 상태면 익명 로그인 시도 (RTDB 쓰기에 auth 필요)
    tryAnonForShare() {
      if (this.user || !this.share.id) return;
      fbAuth.signInAnonymously().catch((e) => {
        this.authError =
          '공유 링크 편집에는 로그인이 필요합니다 (익명 로그인 비활성). Google 로그인 후 이용하세요. (' +
          e.code +
          ')';
      });
    },

    // ── 권한 ──
    canEdit(s) {
      if (this.user && s.ownerUid === this.user.uid) return true;
      if (this.share.id === s.id && this.share.token === s.shareToken) return true;
      return false;
    },

    // ── 일정 CRUD ──
    resetForm() {
      this.form = { id: null, title: '', date: dateKey(new Date()), allDay: false, start: '19:00', end: '21:00' };
      this.formError = '';
    },
    editSchedule(s) {
      this.form = {
        id: s.id,
        title: s.title,
        date: s.date,
        allDay: !!s.allDay,
        start: s.start || '19:00',
        end: s.end || '21:00',
      };
      this.formError = '';
      window.scrollTo({ top: 0, behavior: 'smooth' });
    },
    saveSchedule() {
      this.formError = '';
      if (!this.user) {
        this.formError = '로그인이 필요합니다.';
        return;
      }
      if (!this.form.title.trim()) {
        this.formError = '일정 제목을 입력하세요.';
        return;
      }
      if (!this.form.date) {
        this.formError = '날짜를 선택하세요.';
        return;
      }
      if (!this.form.allDay) {
        const s = timeToMin(this.form.start);
        const e = timeToMin(this.form.end);
        if (s == null || e == null || e <= s) {
          this.formError = '종료 시간이 시작 시간보다 늦어야 합니다.';
          return;
        }
      }
      if (this.form.id) {
        // 수정 — 소유자 또는 공유링크 보유자만
        const target = this.schedules.find((x) => x.id === this.form.id);
        if (!target || !this.canEdit(target)) {
          this.formError = '이 일정을 수정할 권한이 없습니다.';
          return;
        }
        schedulesRef
          .child(this.form.id)
          .update({
            title: this.form.title.trim(),
            date: this.form.date,
            allDay: this.form.allDay,
            start: this.form.allDay ? null : this.form.start,
            end: this.form.allDay ? null : this.form.end,
            updatedAt: firebase.database.ServerValue.TIMESTAMP,
          })
          .then(() => this.resetForm())
          .catch((e) => (this.formError = '저장 실패: ' + e.message));
      } else {
        const ref = schedulesRef.push();
        ref
          .set({
            id: ref.key,
            ownerUid: this.user.uid,
            ownerName: this.user.displayName || this.user.email || '익명',
            ownerEmail: this.user.email || '',
            title: this.form.title.trim(),
            date: this.form.date,
            allDay: this.form.allDay,
            start: this.form.allDay ? null : this.form.start,
            end: this.form.allDay ? null : this.form.end,
            shareToken: genToken(),
            createdAt: firebase.database.ServerValue.TIMESTAMP,
            updatedAt: firebase.database.ServerValue.TIMESTAMP,
          })
          .then(() => this.resetForm())
          .catch((e) => (this.formError = '저장 실패: ' + e.message));
      }
    },
    deleteSchedule(s) {
      if (!this.canEdit(s)) return;
      if (!confirm(`"${s.title}" 일정을 삭제할까요?`)) return;
      schedulesRef.child(s.id).remove();
    },
    copyShareLink(s) {
      const url = `${location.origin}${location.pathname}?share=${s.id}&token=${s.shareToken}`;
      navigator.clipboard.writeText(url).then(() => {
        this.copied = s.id;
        setTimeout(() => (this.copied = ''), 1500);
      });
    },

    // ── 최적 일정 계산 ──
    selectedUids() {
      return this.participants.filter((p) => this.opt.selected[p.uid]).map((p) => p.uid);
    },
    toggleAll(v) {
      for (const p of this.participants) this.opt.selected[p.uid] = v;
    },
    runOptimizer() {
      const uids = this.selectedUids();
      const useAll = uids.length === 0;
      const winStart = timeToMin(this.opt.dayStart);
      const winEnd = timeToMin(this.opt.dayEnd);
      const dur = Number(this.opt.duration) || 60;
      const start = parseDateKey(this.opt.rangeStart);
      const end = parseDateKey(this.opt.rangeEnd);

      const available = [];
      let blocked = 0;

      for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
        const key = dateKey(d);
        const todays = this.schedules.filter(
          (s) => s.date === key && (useAll || uids.includes(s.ownerUid))
        );

        if (this.opt.strict) {
          if (todays.length > 0) {
            blocked++;
            continue;
          }
          available.push(this.scoreDay(key, ['전원 가능'], null));
          continue;
        }

        // 시간대 고려 모드: 공통 가용 시간대 계산
        const busy = [];
        for (const s of todays) {
          if (s.allDay) {
            busy.push([winStart, winEnd]);
          } else {
            const a = Math.max(timeToMin(s.start), winStart);
            const b = Math.min(timeToMin(s.end), winEnd);
            if (b > a) busy.push([a, b]);
          }
        }
        const free = this.freeGaps(winStart, winEnd, busy).filter((g) => g[1] - g[0] >= dur);
        if (free.length === 0) {
          blocked++;
          continue;
        }
        const slots = free.map((g) => `${minToTime(g[0])}~${minToTime(g[1])}`);
        available.push(this.scoreDay(key, slots, free));
      }

      available.sort((a, b) => b.score - a.score || a.key.localeCompare(b.key));
      this.results = { available: available.slice(0, 12), blocked, total: available.length };
    },
    freeGaps(winStart, winEnd, busy) {
      const merged = [];
      busy
        .slice()
        .sort((a, b) => a[0] - b[0])
        .forEach((iv) => {
          if (merged.length && iv[0] <= merged[merged.length - 1][1]) {
            merged[merged.length - 1][1] = Math.max(merged[merged.length - 1][1], iv[1]);
          } else {
            merged.push([iv[0], iv[1]]);
          }
        });
      const gaps = [];
      let cur = winStart;
      for (const [a, b] of merged) {
        if (a > cur) gaps.push([cur, a]);
        cur = Math.max(cur, b);
      }
      if (cur < winEnd) gaps.push([cur, winEnd]);
      return gaps;
    },
    scoreDay(key, slots, free) {
      let score = 1;
      const reasons = [];
      const nd = nextDateKey(key);
      if (isHoliday(nd)) {
        score += 3;
        reasons.push('다음날 ' + holidayName(nd));
      } else if (isWeekend(nd)) {
        score += 2;
        reasons.push('다음날 주말');
      }
      if (isDayOff(key)) {
        score += 1;
        reasons.push('당일 휴일');
      }
      return { key, score, reasons, slots, free };
    },
    dayLabel(key) {
      let s = fmtDay(key);
      if (isHoliday(key)) s += ' · ' + holidayName(key);
      return s;
    },
    busyNames(key) {
      return this.schedules
        .filter((s) => s.date === key)
        .map((s) => `${s.ownerName}${s.allDay ? '(종일)' : ` ${s.start}~${s.end}`}`)
        .join(', ');
    },
  },

  mounted() {
    fbAuth.onAuthStateChanged((u) => {
      this.user = u;
      this.authReady = true;
      this.authError = '';
      if (!u) this.tryAnonForShare();
    });
    schedulesRef.on('value', (snap) => {
      const val = snap.val() || {};
      this.schedules = Object.values(val);
      // 최초 로드 시 참가자 전체 선택
      for (const p of this.participants) {
        if (this.opt.selected[p.uid] === undefined) this.opt.selected[p.uid] = true;
      }
      // 공유 링크 대상이 있으면 폼에 로드
      if (this.myShareTarget && !this.form.id) {
        this.editSchedule(this.myShareTarget);
      }
    });
  },

  template: `
<div class="wrap">
  <header class="topbar">
    <div class="brand">🗓️ 일정 취합 <span>· 약속 잡기</span></div>
    <div class="auth">
      <template v-if="!authReady">…</template>
      <template v-else-if="user && !user.isAnonymous">
        <span class="who">{{ user.displayName || user.email }}</span>
        <button class="btn ghost" @click="signOut">로그아웃</button>
      </template>
      <template v-else-if="user && user.isAnonymous">
        <span class="who">익명(공유 링크)</span>
        <button class="btn" @click="signIn">Google 로그인</button>
      </template>
      <template v-else>
        <button class="btn" @click="signIn">Google 로그인</button>
      </template>
    </div>
  </header>

  <p v-if="authError" class="banner err">{{ authError }}</p>
  <p v-if="myShareTarget" class="banner info">
    공유 링크로 <b>{{ myShareTarget.ownerName }}</b>님의 일정 "<b>{{ myShareTarget.title }}</b>"을(를) 편집 중입니다.
  </p>

  <div class="grid">
    <!-- ── 좌: 일정 등록 ── -->
    <section class="card">
      <h2>{{ form.id ? '일정 수정' : '내 일정 등록' }}</h2>
      <div v-if="!user" class="empty">로그인하면 내 일정을 등록할 수 있어요.</div>
      <div v-else class="formgrid">
        <label>제목
          <input v-model="form.title" placeholder="예: 회사 회식, 가족 모임" />
        </label>
        <label>날짜
          <input type="date" v-model="form.date" />
        </label>
        <label class="check">
          <input type="checkbox" v-model="form.allDay" /> 종일 (시간 미지정)
        </label>
        <div class="times" v-if="!form.allDay">
          <label>시작 <input type="time" v-model="form.start" /></label>
          <label>종료 <input type="time" v-model="form.end" /></label>
        </div>
        <p v-if="formError" class="err">{{ formError }}</p>
        <div class="row">
          <button class="btn" @click="saveSchedule">{{ form.id ? '수정 저장' : '등록' }}</button>
          <button v-if="form.id" class="btn ghost" @click="resetForm">취소</button>
        </div>
      </div>

      <h3>내 일정</h3>
      <ul class="list">
        <li v-for="s in mySchedules" :key="s.id">
          <div class="item-main">
            <b>{{ s.title }}</b>
            <span class="meta">{{ dayLabel(s.date) }} · {{ s.allDay ? '종일' : s.start + '~' + s.end }}</span>
          </div>
          <div class="item-actions">
            <button class="mini" @click="editSchedule(s)">수정</button>
            <button class="mini" @click="copyShareLink(s)">{{ copied === s.id ? '복사됨!' : '공유링크' }}</button>
            <button class="mini danger" @click="deleteSchedule(s)">삭제</button>
          </div>
        </li>
        <li v-if="user && mySchedules.length === 0" class="empty">등록한 일정이 없습니다.</li>
      </ul>
    </section>

    <!-- ── 우: 최적 일정 ── -->
    <section class="card">
      <h2>약속 잡기 (최적 일정 추천)</h2>
      <div class="formgrid">
        <div class="times">
          <label>시작일 <input type="date" v-model="opt.rangeStart" /></label>
          <label>종료일 <input type="date" v-model="opt.rangeEnd" /></label>
        </div>
        <div class="times">
          <label>모임 시간대 <input type="time" v-model="opt.dayStart" /></label>
          <label>~ <input type="time" v-model="opt.dayEnd" /></label>
        </div>
        <label>모임 소요(분)
          <input type="number" min="30" step="30" v-model.number="opt.duration" />
        </label>
        <label class="check">
          <input type="checkbox" v-model="opt.strict" />
          엄격 모드 (당일 일정이 하나라도 있으면 제외)
        </label>

        <div v-if="participants.length" class="participants">
          <div class="phead">
            참가자
            <span>
              <button class="mini" @click="toggleAll(true)">전체</button>
              <button class="mini" @click="toggleAll(false)">해제</button>
            </span>
          </div>
          <label v-for="p in participants" :key="p.uid" class="check">
            <input type="checkbox" v-model="opt.selected[p.uid]" />
            {{ p.name }} <span class="cnt">({{ p.count }})</span>
          </label>
        </div>
        <div class="row">
          <button class="btn" @click="runOptimizer">최적 일정 찾기</button>
        </div>
      </div>

      <div v-if="results" class="results">
        <p class="summary">
          가능한 날짜 <b>{{ results.total }}</b>개 · 제외된 날짜 {{ results.blocked }}개
          {{ opt.strict ? '(엄격 모드)' : '(시간대 고려)' }}
        </p>
        <div v-if="results.available.length === 0" class="empty">조건에 맞는 날짜가 없습니다.</div>
        <ol class="ranked">
          <li v-for="r in results.available" :key="r.key" :class="{ top: r === results.available[0] }">
            <div class="rank-head">
              <span class="rday">{{ dayLabel(r.key) }}</span>
              <span class="rscore">⭐ {{ r.score }}</span>
            </div>
            <div class="rslots" v-if="r.slots">가능 시간: {{ r.slots.join(' / ') }}</div>
            <div class="rreasons" v-if="r.reasons.length">{{ r.reasons.join(' · ') }}</div>
          </li>
        </ol>
      </div>
    </section>
  </div>

  <!-- ── 전체 등록 현황 ── -->
  <section class="card">
    <h2>전체 일정 현황 <span class="cnt">({{ schedules.length }}건)</span></h2>
    <ul class="list compact">
      <li v-for="s in allSorted" :key="s.id">
        <div class="item-main">
          <b>{{ s.title }}</b>
          <span class="meta">{{ dayLabel(s.date) }} · {{ s.allDay ? '종일' : s.start + '~' + s.end }} · {{ s.ownerName }}</span>
        </div>
      </li>
      <li v-if="schedules.length === 0" class="empty">아직 등록된 일정이 없습니다.</li>
    </ul>
  </section>

  <footer class="foot">데이터: Firebase Realtime DB · 공휴일은 holidays.js에서 직접 수정 가능</footer>
</div>
`,
}).mount('#app');
