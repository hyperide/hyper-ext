/**
 * Conversion at the two boundaries (§4.13.5, R83, R77).
 *
 * The section's whole argument is that the wire boundary and the view boundary
 * obey different laws and must not share one encode/decode pair. These checks
 * are that argument, executed: the codec round-trips exactly and takes no
 * ambient input, the presenter is reactive and lossy on purpose, and a parse
 * failure keeps both representations — the raw text and the last good value —
 * because that is the only shape in which a half-typed number is not data loss.
 */
import {
  DateType,
  customType,
  presented,
  field,
  encodeFor,
  decodeFor,
  signal,
  watch,
  formatterConstructions,
} from '../src/lib/proto';

let failures = 0;
function check(name: string, cond: boolean, detail = '') {
  if (cond) console.log(`  ok   ${name}`);
  else {
    failures++;
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

console.log('\nthe wire boundary: fidelity');
{
  const d = new Date('2026-09-04T11:22:33.444Z');
  const wire = DateType.codec.encode(d);
  const back = DateType.codec.decode(wire);
  check('encodes to a string', typeof wire === 'string', typeof wire);
  check('decode(encode(v)) equals v', back.getTime() === d.getTime());
  check('decode returns a real Date, not a string', back instanceof Date);
  check('the codec takes no ambient context', DateType.codec.encode.length === 1 && DateType.codec.decode.length === 1);
}

console.log('\nthe view boundary: presentation is lossy and locale-dependent');
{
  const d = new Date('2026-09-04T11:22:33.444Z');
  const en = DateType.present!.format(d, { locale: 'en-GB', timeZone: 'UTC' });
  const de = DateType.present!.format(d, { locale: 'de-DE', timeZone: 'UTC' });
  check('the same value reads differently per locale', en !== de, `${en} / ${de}`);
  check('presentation drops the time — lossy on purpose', !en.includes('11:22'), en);
}

console.log('\npresentation is reactive: change the locale, every string recomputes');
{
  const locale = signal('en-GB', 'locale');
  const when = signal(new Date('2026-09-04T00:00:00Z'), 'when');
  const shown = presented(
    () => when.get(),
    DateType,
    () => ({ locale: locale.get(), timeZone: 'UTC' }),
  );
  const seen: string[] = [];
  watch(() => seen.push(shown()));
  const first = shown();
  locale.set('de-DE');
  const second = shown();
  check('the derived string followed the locale', first !== second, `${first} → ${second}`);
  check('the watcher saw the change', seen.length >= 2, seen.join(' | '));
}

console.log('\nformatter construction is cached (55x, §4.13.5)');
{
  const before = formatterConstructions();
  const d = new Date();
  for (let i = 0; i < 500; i++) DateType.present!.format(d, { locale: 'en-GB', timeZone: 'UTC' });
  check(
    '500 formats constructed no new formatter',
    formatterConstructions() === before,
    `${before} → ${formatterConstructions()}`,
  );
}

console.log('\nparse failure is state, not an exception (R77)');
{
  const ctx = () => ({ locale: 'en-GB', timeZone: 'UTC' });
  const f = field(new Date('2026-09-04T00:00:00Z'), DateType, ctx);
  const good = f.value();

  f.input('2026-09-0'); // mid-typing: not a date yet
  check('the raw text is exactly what was typed', f.text() === '2026-09-0', f.text());
  check('an error is reported', f.error() !== null);
  check('the last good value survived', f.value().getTime() === good.getTime());

  f.input('2026-12-25');
  check('a valid keystroke updates the value', f.value().getUTCMonth() === 11, String(f.value()));
  check('and clears the error', f.error() === null);

  const wasCanonical = f.text();
  check('typing does not reformat under the caret', wasCanonical === '2026-12-25', wasCanonical);
  check('commit canonicalises, and only then', f.commit() && f.text() !== '2026-12-25', f.text());

  f.input('nonsense');
  check('commit refuses an invalid value', f.commit() === false);
  check('and the invalid text is still on screen', f.text() === 'nonsense', f.text());
  f.reset();
  check('reset goes back to the last good value', f.error() === null && f.text().length > 0, f.text());
}

console.log('\nthe presenter can read its own output, in every locale');
{
  // The check the first version of this suite did not have, and the reason it
  // passed while the parser was broken: every parse test fed it ISO text, which
  // Date.parse handles in any locale. Under de-DE, "04.09.2026" came back as
  // 8 April — silently, with ok: true. A German user committing the date their
  // own screen showed them would have moved it five months.
  for (const locale of ['en-GB', 'de-DE', 'en-US', 'fr-FR', 'ja-JP']) {
    const ctx = { locale, timeZone: 'UTC' };
    const day = new Date(Date.UTC(2026, 8, 4));
    const shown = DateType.present!.format(day, ctx);
    const back = DateType.present!.parse(shown, ctx);
    const same = back.ok && back.value.getTime() === day.getTime();
    check(`${locale}: parse(format(v)) is v`, same, `${shown} → ${back.ok ? back.value.toISOString() : back.error}`);
  }
  const de = { locale: 'de-DE', timeZone: 'UTC' };
  const us = { locale: 'en-US', timeZone: 'UTC' };
  const d1 = DateType.present!.parse('04.09.2026', de);
  const d2 = DateType.present!.parse('04/09/2026', us);
  check(
    'the same digits mean different days in different locales',
    d1.ok && d2.ok && d1.value.getUTCMonth() === 8 && d2.value.getUTCMonth() === 3,
    `${d1.ok && d1.value.toISOString()} / ${d2.ok && d2.value.toISOString()}`,
  );
  check('ISO is still accepted anywhere', DateType.present!.parse('2026-09-04', de).ok);
  check(
    'a month name round-trips too',
    DateType.present!.parse('4 Sept 2026', { locale: 'en-GB', timeZone: 'UTC' }).ok,
  );
  check('31 February is rejected, not rolled into March', !DateType.present!.parse('31.02.2026', de).ok);
  check('nonsense is still rejected', !DateType.present!.parse('hello', de).ok);
}

console.log('\na field can be committed twice');
{
  const de = () => ({ locale: 'de-DE', timeZone: 'UTC' });
  const f = field(new Date(Date.UTC(2026, 8, 4)), DateType, de);
  check('commit accepts the value it was given', f.commit());
  const once = f.text();
  check('commit accepts its own canonical output', f.commit(), `${once} → ${f.text()}`);
  check('and the text is stable', f.text() === once, `${once} vs ${f.text()}`);
  f.input('25.12.2026');
  check(
    'a locale-shaped date typed by hand is accepted',
    f.error() === null && f.value().getUTCMonth() === 11,
    String(f.error()),
  );
}

console.log('\none declaration site, routed per path');
{
  const Cents = customType<number, string, { locale: string }>('Cents', {
    codec: { encode: (n) => String(n), decode: (s) => Number(s) },
    present: {
      format: (n, ctx) => new Intl.NumberFormat(ctx.locale, { style: 'currency', currency: 'EUR' }).format(n / 100),
      parse: (t) =>
        /^\d+([.,]\d{1,2})?$/.test(t)
          ? { ok: true, value: Math.round(Number(t.replace(',', '.')) * 100) }
          : { ok: false, error: 'not money' },
    },
  });
  const types = { '/order/placedAt': DateType, '/order/total': Cents } as never;
  const encoded = encodeFor(new Date('2026-01-02T03:04:05Z'), '/order/placedAt', types);
  check('a typed path encodes through its codec', encoded === '2026-01-02T03:04:05.000Z', String(encoded));
  check('an untyped path passes through untouched', encodeFor(7, '/order/qty', types) === 7);
  check('and decodes back to the live type', (decodeFor(encoded, '/order/placedAt', types) as Date) instanceof Date);
  check('a second type on a different path is independent', decodeFor('1250', '/order/total', types) === 1250);
}

console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed');
process.exit(failures ? 1 : 0);
