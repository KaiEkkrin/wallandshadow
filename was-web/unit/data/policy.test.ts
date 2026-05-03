import { emailIsValid, passwordIsValid } from './policy';

describe('emailIsValid', () => {
  describe('accepts well-formed addresses', () => {
    test.each([
      'a@b.c',
      'user@example.com',
      'user.name@example.com',
      'user+tag@example.com',
      'user_123@sub.example.co.uk',
      'a@b.c.d.e.f',
      'USER@EXAMPLE.COM',
      'a@b-c.de',
      "o'brien@example.com",
      'a@1.2',
    ])('%s', (email) => {
      expect(emailIsValid(email)).toBe(true);
    });
  });

  describe('rejects malformed addresses', () => {
    test.each([
      '',
      '@',
      '@b.c',
      'a@',
      'a@b',
      'a@b.',
      'a@.b',
      'no-at-sign',
      'a@@b.c',
      'a@b@c.d',
      'a b@c.d',
      'a@b c.d',
      ' a@b.c',
      'a@b.c ',
      'a\t@b.c',
      'a@b.c\n',
    ])('%j', (email) => {
      expect(emailIsValid(email)).toBe(false);
    });
  });

  // CodeQL flagged the legacy regex /^[^\s@]+@[^\s@]+\.[^\s@]+$/ for polynomial
  // backtracking on inputs of the form "!@!." + many "!." (the dot separator
  // overlaps with the surrounding [^\s@] classes). Guards against any future
  // rewrite that re-introduces the quadratic worst case.
  test('rejects the CodeQL adversarial input in linear time', () => {
    const adversarial = '!@!.' + '!.'.repeat(50000) + ' ';
    const start = Date.now();
    expect(emailIsValid(adversarial)).toBe(false);
    expect(Date.now() - start).toBeLessThan(100);
  });

  // The original regex /^[^\s@]+@[^\s@]+\.[^\s@]+$/ has surprising behaviour around
  // leading/trailing dots in the domain because the second [^\s@]+ accepts dots.
  // We pin these down so a refactor is provably equivalent rather than "stricter
  // by accident".
  describe('regex quirks (kept for backward compatibility)', () => {
    test.each([
      ['a@..b', true],   // domain begins with two dots — matches via 2nd seg = ".", \. = ".", 3rd seg = "b"
      ['a@b..', true],   // domain ends with two dots — matches via 2nd seg = "b", \. = ".", 3rd seg = "."
      ['a@.b.c', true],  // single leading dot, plus another dot inside
      ['a@b.c.', true],  // trailing dot but another dot inside
      ['a@.b', false],   // single leading dot, no other dot
      ['a@b.', false],   // single trailing dot, no other dot
      ['a@.', false],    // single dot only
      ['a@..', false],   // two dots only — every split has empty side
    ])('%j -> %s', (email, expected) => {
      expect(emailIsValid(email)).toBe(expected);
    });
  });
});

describe('passwordIsValid', () => {
  test.each([
    ['Abcdef12', true],
    ['password1', true],
    ['12345678a', true],
    ['short1A', false],       // too short
    ['12345678', false],      // no letter
    ['abcdefgh', false],      // no digit
    ['', false],
  ])('%j -> %s', (password, expected) => {
    expect(passwordIsValid(password)).toBe(expected);
  });
});
