// Signup only. Preserve the existing Unicode code-point length convention.
export const PASSWORD_POLICY_MESSAGE = '비밀번호는 8자 이상이며 영문과 숫자를 포함해야 합니다.';
export const PASSWORD_MAX_LENGTH = 128;

export function passwordConditions(password) {
  const value = typeof password === 'string' ? password : '';
  return {
    length: Array.from(value).length >= 8,
    letter: /[A-Za-z]/.test(value),
    digit: /[0-9]/.test(value)
  };
}

export function isValidSignupPassword(password) {
  return typeof password === 'string' && Array.from(password).length <= PASSWORD_MAX_LENGTH &&
    Object.values(passwordConditions(password)).every(Boolean);
}
