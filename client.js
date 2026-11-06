/**
 * Client half of the API price-period badge.
 *
 * One small dot plus a two-character label (`低谷` / `高峰`) sits in the
 * composer's bottom tool row, at `conversation.input.right` (just before the
 * model selector and the submit button). Green = off-peak (half price), amber =
 * peak (full price). The native tooltip carries the countdown, the current
 * rates and the rule.
 *
 * The input row was chosen over the sidebar foot because the phone layout
 * collapses the sidebar into a drawer while the composer stays on screen, so
 * this placement is visible on both desktop and mobile without touching the
 * shell.
 *
 * Pricing source, checked 2026-11-02:
 *   https://api-docs.deepseek.com/quick_start/pricing
 * Peak hours are 01:00-04:00 and 06:00-10:00 UTC, Monday through Friday,
 * excluding Chinese public holidays; every other hour is off-peak at half
 * price. In Beijing time that is 09:00-12:00 and 14:00-18:00. Both peak
 * windows fall on the same Beijing calendar date as their UTC date, so a
 * Beijing-date holiday lookup is exact for every peak window.
 *
 * This is a static table, not a live feed: it does not fetch anything. Each run
 * shows when the table was last compared with the official page, and once the
 * current Beijing year is past the last holiday year it says so in the tooltip
 * instead of silently guessing. See README.md for the yearly update.
 */
window.__ModuleLoader__.load({
  id: 'dsh-price-badge',
  factory(require) {
    const React = require('react');
    const h = React.createElement;

    /** Dictionary namespace owned by this plugin. */
    const NS = 'price-badge';

    /** Peak windows in UTC minutes of day, [start, end). */
    const PEAK_WINDOWS = [[60, 240], [360, 600]];

    /** Date the pricing rule and holiday table below were checked. */
    const RULE_CHECKED_AT = '2026-11-02';

    /** Observed Chinese public holidays, Beijing dates, inclusive. */
    const HOLIDAYS = [
      // 2026 — 国办发明电〔2025〕7号, published 2025-11-04.
      ['2026-01-01', '2026-01-03'], // 元旦
      ['2026-02-15', '2026-02-23'], // 春节
      ['2026-04-04', '2026-04-06'], // 清明
      ['2026-05-01', '2026-05-05'], // 劳动节
      ['2026-06-19', '2026-06-21'], // 端午
      ['2026-09-25', '2026-09-27'], // 中秋
      ['2026-10-01', '2026-10-07'], // 国庆
      // 2027 — as reported on 2026-11-02 (provisional until the official notice).
      ['2027-01-01', '2027-01-03'],
      ['2027-02-05', '2027-02-13'],
      ['2027-04-03', '2027-04-05'],
      ['2027-04-30', '2027-05-04'],
      ['2027-06-09', '2027-06-09'],
      ['2027-09-15', '2027-09-15'],
      ['2027-10-01', '2027-10-07'],
    ].map(([from, to]) => [Date.parse(`${from}T00:00:00Z`), Date.parse(`${to}T00:00:00Z`)]);

    const DAY = 86400000;
    const TIME_ZONE = 'Asia/Shanghai';
    const REFRESH_MS = 30000;

    /**
     * 当前会话选中的模型：Web GUI 的 composer 模型按钮把当前选中项渲染成
     * `<span data-provider-id data-model-id>`，这里只读取它，不依赖任何内部服务。
     * 读不到时返回 null（保持旧行为，不隐藏徽标）。
     */
    function readCurrentModel() {
      try {
        for (const span of document.querySelectorAll('[data-model-id]')) {
          const button = span.closest('button');
          if (!button || !/model/i.test(String(button.className ?? ''))) continue;
          return {
            providerId: String(span.getAttribute('data-provider-id') ?? ''),
            modelId: String(span.getAttribute('data-model-id') ?? ''),
          };
        }
        const trigger = document.querySelector('button[class*="ModelSelect"]');
        if (trigger) {
          const label = String(trigger.getAttribute('aria-label') ?? '') || String(trigger.title ?? '');
          return { providerId: '', modelId: label };
        }
      } catch {
        /* 忽略：DOM 不可用时退回显示 */
      }
      return null;
    }

    /** 是否 DeepSeek 路由：provider id 或 model id / 显示名里带 deepseek。 */
    function isDeepSeekModel(model) {
      if (!model) return true;
      const provider = String(model.providerId ?? '').toLowerCase();
      const name = String(model.modelId ?? '').toLowerCase();
      return provider.includes('deepseek') || name.includes('deepseek');
    }

    /** Holiday table coverage, derived so the warning cannot drift from it. */
    const FIRST_HOLIDAY_YEAR = new Date(Math.min(...HOLIDAYS.map(([from]) => from))).getUTCFullYear();
    const LAST_HOLIDAY_YEAR = new Date(Math.max(...HOLIDAYS.map(([, to]) => to))).getUTCFullYear();

    /** The Beijing calendar date of `instant`, as the UTC midnight of that date. */
    function dayOf(instant) {
      const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: TIME_ZONE,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).formatToParts(instant);
      const pick = (type) => Number(parts.find((part) => part.type === type)?.value);
      return Date.UTC(pick('year'), pick('month') - 1, pick('day'));
    }

    function isHoliday(day) {
      return HOLIDAYS.some(([from, to]) => day >= from && day <= to);
    }

    function weekdayOf(day) {
      return new Date(day).getUTCDay();
    }

    /** Peak eligibility of a Beijing calendar day: Monday-Friday, not a holiday. */
    function isPeakDay(day) {
      const weekday = weekdayOf(day);
      return weekday >= 1 && weekday <= 5 && !isHoliday(day);
    }

    function classify(instant) {
      const utcMinutes = instant.getUTCHours() * 60 + instant.getUTCMinutes();
      const day = dayOf(instant);
      const holiday = isHoliday(day);
      const weekend = weekdayOf(day) === 0 || weekdayOf(day) === 6;
      const year = new Date(day).getUTCFullYear();
      const peak =
        !holiday &&
        !weekend &&
        PEAK_WINDOWS.some(([from, to]) => utcMinutes >= from && utcMinutes < to);
      return { peak, holiday, weekend, day, stale: year > LAST_HOLIDAY_YEAR };
    }

    /**
     * The next instant at which the state flips, and which state it flips to.
     * Every boundary is a peak window edge of an eligible day, so scanning the
     * current day plus a fortnight covers every holiday run.
     */
    function nextChange(instant) {
      const now = instant.getTime();
      const today = dayOf(instant);
      let best = null;
      for (let offset = 0; offset <= 14; offset += 1) {
        const day = today + offset * DAY;
        if (!isPeakDay(day)) continue;
        for (const [from, to] of PEAK_WINDOWS) {
          for (const boundary of [
            { at: day + from * 60000, peakStart: true },
            { at: day + to * 60000, peakStart: false },
          ]) {
            if (boundary.at <= now) continue;
            if (best === null || boundary.at < best.at) best = boundary;
          }
        }
      }
      return best;
    }

    function formatDuration(milliseconds, tr) {
      const totalMinutes = Math.max(1, Math.round(milliseconds / 60000));
      const hours = Math.floor(totalMinutes / 60);
      const minutes = totalMinutes % 60;
      if (hours === 0) return `${minutes} ${tr('unit.minute')}`;
      if (minutes === 0) return `${hours} ${tr('unit.hour')}`;
      return `${hours} ${tr('unit.hour')} ${minutes} ${tr('unit.minute')}`;
    }

    /** Beijing wall-clock weekday plus time, localized by `localeTag`. */
    function formatWhen(instant, localeTag) {
      try {
        return new Intl.DateTimeFormat(localeTag, {
          timeZone: TIME_ZONE,
          weekday: 'short',
          hour: '2-digit',
          minute: '2-digit',
          hour12: false,
        }).format(instant);
      } catch {
        return instant.toISOString();
      }
    }

    function describe(instant, tr, localeTag) {
      const state = classify(instant);
      const next = nextChange(instant);
      const lines = [`DeepSeek API · ${tr(state.peak ? 'status.peak' : 'status.offPeak')}`];
      if (state.holiday) lines.push(tr('status.holiday'));
      else if (state.weekend) lines.push(tr('status.weekend'));
      if (next !== null) {
        const prefix = tr(next.peakStart ? 'next.peak' : 'next.offPeak');
        const wait = formatDuration(next.at - instant.getTime(), tr);
        lines.push(`${prefix} ${wait} · ${formatWhen(next.at, localeTag)}`);
      }
      if (state.stale) {
        lines.push(`${tr('data.stale.label')} ${LAST_HOLIDAY_YEAR}${tr('data.stale.tail')}`);
      } else {
        lines.push(
          `${tr('data.checked')} ${RULE_CHECKED_AT} · ${tr('data.holidays')} ${FIRST_HOLIDAY_YEAR}–${LAST_HOLIDAY_YEAR}`,
        );
      }
      lines.push(tr('rule'));
      return { state, text: lines.join('\n') };
    }

    /** Simplified Chinese dictionary (the key-set source of truth). */
    const zh = {
      label: 'API 价格时段',
      peak: '高峰',
      offPeak: '低谷',
      stale: '过期',
      'status.peak': '高峰时段 · 全价',
      'status.offPeak': '低谷时段 · 半价',
      'status.holiday': '法定节假日 · 全天低谷',
      'status.weekend': '周末 · 全天低谷',
      'next.peak': '距高峰',
      'next.offPeak': '距低谷',
      'unit.hour': '小时',
      'unit.minute': '分钟',
      'data.checked': '数据核对',
      'data.holidays': '节假日覆盖',
      'data.stale.label': '⚠ 节假日数据只到',
      'data.stale.tail': '，节假日期间可能判错，请更新插件',
      rule: '规则：周一至周五 09:00–12:00、14:00–18:00（北京时间）为高峰；其余时间、周末与法定节假日均为低谷',
    };

    /** English dictionary, checked complete against the zh key set. */
    const en = {
      label: 'API price period',
      peak: 'Peak',
      offPeak: 'Off-peak',
      stale: 'Stale',
      'status.peak': 'peak hours · full price',
      'status.offPeak': 'off-peak hours · half price',
      'status.holiday': 'Chinese public holiday · off-peak all day',
      'status.weekend': 'weekend · off-peak all day',
      'next.peak': 'Peak in',
      'next.offPeak': 'Off-peak in',
      'unit.hour': 'h',
      'unit.minute': 'min',
      'data.checked': 'checked',
      'data.holidays': 'holidays through',
      'data.stale.label': '⚠ holidays through',
      'data.stale.tail': ' only - holidays may read wrong, update the plugin',
      rule: 'Rule: 09:00-12:00 and 14:00-18:00 Beijing time, Monday to Friday, are peak; every other hour, weekends, and Chinese public holidays are off-peak.',
    };

    function createBadge(tr, localeTag) {
      return function PriceBadge(props) {
        const activeTr = typeof props.t === 'function' ? props.t : tr;
        const [, refresh] = React.useState(0);
        const [model, setModel] = React.useState(() => readCurrentModel());
        React.useEffect(() => {
          let timer = null;
          const update = () => {
            if (timer !== null) return;
            timer = setTimeout(() => {
              timer = null;
              const next = readCurrentModel();
              setModel((previous) => {
                const before = previous === null ? '' : `${previous.providerId}|${previous.modelId}`;
                const after = next === null ? '' : `${next.providerId}|${next.modelId}`;
                return before === after ? previous : next;
              });
            }, 250);
          };
          update();
          const observer = new MutationObserver(update);
          observer.observe(document.body, { subtree: true, childList: true, characterData: true });
          return () => {
            observer.disconnect();
            if (timer !== null) clearTimeout(timer);
          };
        }, []);
        // 只在 DeepSeek 模型下显示：其它提供方没有峰谷计价，徽标没有意义。
        React.useEffect(() => {
          const timer = setInterval(() => refresh((value) => value + 1), REFRESH_MS);
          return () => clearInterval(timer);
        }, []);
        if (!isDeepSeekModel(model)) return null;
        const now = new Date();
        const { state, text } = describe(now, activeTr, localeTag());
        const color = state.stale
          ? 'var(--dsw-alias-state-idle-primary)'
          : state.peak
            ? 'var(--dsw-alias-state-warn-primary)'
            : 'var(--dsw-alias-state-success-primary)';
        return h(
          'div',
          {
            title: text,
            'aria-label': text,
            style: {
              display: 'inline-flex',
              alignItems: 'center',
              gap: '4px',
              flex: 'none',
              height: '18px',
              padding: '0 2px',
              fontSize: '11px',
              lineHeight: '1',
              color: 'var(--dsw-alias-label-secondary)',
              whiteSpace: 'nowrap',
              userSelect: 'none',
              cursor: 'default',
            },
          },
          h('span', {
            key: 'dot',
            style: {
              width: '8px',
              height: '8px',
              borderRadius: '999px',
              flex: 'none',
              background: color,
              boxShadow: `0 0 0 2px color-mix(in srgb, ${color} 22%, transparent)`,
              transition: 'background-color .4s ease',
            },
          }),
          h('span', { key: 'label' }, activeTr(state.stale ? 'stale' : state.peak ? 'peak' : 'offPeak')),
        );
      };
    }

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'price-badge: dictionaries');
        const tr =
          typeof ctx.locale.bind === 'function'
            ? ctx.locale.bind(NS)
            : (key) => zh[key] ?? key;
        const localeTag = () => {
          const active = ctx.locale.getLocale().active ?? '';
          return active.toLowerCase().startsWith('zh') ? 'zh-CN' : 'en';
        };
        ctx.slots.inject('conversation.input.right', () =>
          ctx.slots.register(
            {
              name: 'conversation.input.right',
              id: 'price-badge',
              order: 0,
              locale: NS,
              label: () => tr('label'),
            },
            createBadge(tr, localeTag),
          ),
        );
      },
    };
  },
});
