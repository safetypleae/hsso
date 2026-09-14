import { passwordConditions, isValidSignupPassword, PASSWORD_POLICY_MESSAGE, PASSWORD_MAX_LENGTH } from './password-policy.js';
import { initEmailVerification } from './email-verification-ui.js';

// Account forms only. Navigation stays in the existing application view switcher.
const SIGNUP_ENDPOINT = '/api/auth/signup';
const EMAIL_PATTERN = /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/i;
const LIMITS = { name: 50, companyName: 100, departmentName: 100, position: 50, email: 254, password: PASSWORD_MAX_LENGTH, passwordConfirm: PASSWORD_MAX_LENGTH };
const SERVER_ERROR = '회원가입 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.';

export function initAuthUI(navigate) {
  const loginForm = document.querySelector('#login-form');
  const signupForm = document.querySelector('#signup-form');
  const signupButton = document.querySelector('#signup-submit');
  const signupMessage = document.querySelector('#signup-message');
  const loginMessage = document.querySelector('#login-message');
  const loginButton = document.querySelector('#login-submit');
  const headerLogin = document.querySelector('#header-login');
  const headerSession = document.querySelector('#header-session');
  const logoutButton = document.querySelector('#header-logout');
  const fields = [...signupForm.querySelectorAll('input')].filter(input => Object.hasOwn(LIMITS, input.name));
  let submitting = false;
  let loggingIn = false;
  let loggingOut = false;
  let sessionVersion = 0;
  let currentView;
  const emailVerification = initEmailVerification(signupForm, signupButton, () => submitting);

  function renderSession(authenticated) {
    headerLogin.hidden = authenticated;
    headerSession.hidden = !authenticated;
  }

  async function refreshSession() {
    const version = ++sessionVersion;
    try {
      const response = await fetch('/api/auth/me', { credentials: 'same-origin', cache: 'no-store', mode: 'same-origin', redirect: 'error' });
      const data = await response.json().catch(() => null);
      if (version !== sessionVersion) return null;
      if (response.status === 401) { renderSession(false); return false; }
      if (!response.ok || data?.ok !== true || typeof data.user?.id !== 'string') throw new Error('Session unavailable');
      renderSession(true);
      return true;
    } catch {
      if (version === sessionVersion) renderSession(false);
      return null;
    }
  }

  function notify(message) {
    const toast = document.querySelector('#toast');
    toast.textContent = message;
    toast.classList.add('show');
    setTimeout(() => toast.classList.remove('show'), 4000);
  }

  function showMessage(element, message) {
    element.textContent = message;
    element.hidden = false;
    element.focus();
  }

  function clearFieldError(input) {
    input.removeAttribute('aria-invalid');
    const error = document.getElementById(`${input.id}-error`);
    error.textContent = '';
    error.hidden = true;
  }

  function setFieldError(input, message) {
    input.setAttribute('aria-invalid', 'true');
    const error = document.getElementById(`${input.id}-error`);
    error.textContent = message;
    error.hidden = false;
  }

  function clearPasswords() {
    document.querySelectorAll('.auth-view input[type="password"]').forEach(input => { input.value = ''; });
    renderPasswordConditions();
  }

  function renderPasswordConditions() {
    const conditions = passwordConditions(signupForm.elements.password.value);
    for (const [key, label] of Object.entries({ length: '8자 이상', letter: '영문 포함', digit: '숫자 포함' })) {
      const item = document.getElementById(`signup-password-${key}`);
      item.textContent = `${conditions[key] ? '✓' : '○'} ${label}`;
      item.classList.toggle('is-met', conditions[key]);
    }
  }
  renderPasswordConditions();

  fields.forEach(input => input.addEventListener('input', () => {
    clearFieldError(input);
    if (input.name === 'password') {
      clearFieldError(signupForm.elements.passwordConfirm);
      renderPasswordConditions();
    }
    signupMessage.hidden = true;
  }));

  loginForm.addEventListener('submit', async event => {
    event.preventDefault();
    if (loggingIn || loggingOut) return;
    const email = loginForm.elements.email.value.trim().toLowerCase();
    const password = loginForm.elements.password.value;
    if (!email || !password.trim()) {
      showMessage(loginMessage, '이메일과 비밀번호를 입력해주세요.');
      return;
    }
    if (Array.from(email).length > 254 || Array.from(password).length < 8 || Array.from(password).length > 128) {
      showMessage(loginMessage, '이메일 또는 비밀번호가 올바르지 않습니다.');
      return;
    }
    loggingIn = true;
    ++sessionVersion; // Ignore an earlier /me response while login is in flight.
    loginButton.disabled = true;
    loginButton.textContent = '처리 중...';
    loginForm.setAttribute('aria-busy', 'true');
    loginMessage.hidden = true;
    [...loginForm.querySelectorAll('input')].forEach(input => { input.disabled = true; });
    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }), credentials: 'same-origin', mode: 'same-origin', redirect: 'error'
      });
      const data = await response.json().catch(() => null);
      if (response.status === 200 && data?.ok === true) {
        clearPasswords();
        navigate('home');
        const authenticated = await refreshSession();
        if (authenticated !== true) notify('로그인 상태를 확인할 수 없습니다. 다시 시도해주세요.');
      } else if (response.status === 401) {
        showMessage(loginMessage, '이메일 또는 비밀번호가 올바르지 않습니다.');
      } else {
        showMessage(loginMessage, '로그인 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.');
      }
    } catch {
      showMessage(loginMessage, '네트워크 연결을 확인한 후 다시 시도해주세요.');
    } finally {
      loggingIn = false;
      loginButton.disabled = false;
      loginButton.textContent = '로그인';
      loginForm.removeAttribute('aria-busy');
      [...loginForm.querySelectorAll('input')].forEach(input => { input.disabled = false; });
    }
  });

  logoutButton.addEventListener('click', async () => {
    if (loggingOut || loggingIn) return;
    loggingOut = true;
    ++sessionVersion;
    logoutButton.disabled = true;
    logoutButton.textContent = '처리 중...';
    try {
      const response = await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin', mode: 'same-origin', redirect: 'error' });
      const data = await response.json().catch(() => null);
      if (!response.ok || data?.ok !== true) throw new Error('Logout unavailable');
      renderSession(false);
      clearPasswords();
      navigate('home');
      headerLogin.focus({ preventScroll: true });
      notify('로그아웃되었습니다.');
    } catch {
      notify('로그아웃 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.');
    } finally {
      loggingOut = false;
      logoutButton.disabled = false;
      logoutButton.textContent = '로그아웃';
    }
  });

  signupForm.addEventListener('submit', async event => {
    event.preventDefault();
    if (submitting) return;
    signupMessage.hidden = true;
    const values = {};
    let firstInvalid;
    for (const input of fields) {
      clearFieldError(input);
      const value = input.type === 'password' ? input.value : input.value.trim();
      const length = Array.from(value).length;
      values[input.name] = value;
      let error = '';
      if (!value.trim()) error = '필수 항목입니다. 입력해주세요.';
      else if (length > LIMITS[input.name]) error = `${LIMITS[input.name]}자 이하로 입력해주세요.`;
      else if (input.name === 'password' && !isValidSignupPassword(value)) error = PASSWORD_POLICY_MESSAGE;
      else if (input.name === 'email') {
        const localPart = value.split('@')[0];
        if (!EMAIL_PATTERN.test(value) || localPart.startsWith('.') || localPart.endsWith('.') || localPart.includes('..')) {
          error = '올바른 이메일 주소를 입력해주세요.';
        }
      } else if (input.name === 'passwordConfirm' && value !== values.password) {
        error = '비밀번호가 일치하지 않습니다.';
      }
      if (error) {
        setFieldError(input, error);
        firstInvalid ||= input;
      }
    }
    if (firstInvalid) {
      firstInvalid.focus();
      return;
    }

    // Explicit allowlist: confirmation and any extra form fields never reach the API.
    const emailVerificationProof = emailVerification.getProof();
    if (!emailVerificationProof) {
      showMessage(signupMessage, '이메일 인증을 먼저 완료해주세요.');
      emailVerification.render();
      return;
    }
    const payload = {
      emailVerificationProof,
      email: values.email.toLowerCase(), password: values.password, name: values.name,
      companyName: values.companyName, departmentName: values.departmentName, position: values.position
    };
    submitting = true;
    emailVerification.render();
    signupButton.disabled = true;
    signupButton.textContent = '처리 중...';
    signupForm.setAttribute('aria-busy', 'true');
    fields.forEach(input => { input.disabled = true; });

    try {
      const response = await fetch(SIGNUP_ENDPOINT, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload), credentials: 'omit', mode: 'same-origin', redirect: 'error'
      });
      const result = await response.json().catch(() => null);
      if (response.status === 201 && result?.ok === true) {
        signupForm.reset();
        clearPasswords();
        loginForm.elements.email.value = payload.email;
        navigate('login');
        showMessage(loginMessage, '회원가입이 완료되었습니다.');
      } else {
        let message = SERVER_ERROR;
        if (response.status === 409 && result?.error === 'EMAIL_ALREADY_EXISTS') message = '이미 가입된 이메일입니다.';
        else if (response.status === 400 && result?.error === 'INVALID_PASSWORD') message = PASSWORD_POLICY_MESSAGE;
        else if (result?.error === 'EMAIL_VERIFICATION_REQUIRED') {
          message = '이메일 인증이 필요하거나 만료되었습니다. 다시 인증해주세요.';
          emailVerification.reset(message);
        }
        else if (response.status === 400) message = '입력한 정보를 다시 확인해주세요.';
        else if (response.status === 403) message = '요청을 처리할 수 없습니다.';
        showMessage(signupMessage, message);
      }
    } catch {
      showMessage(signupMessage, '네트워크 연결을 확인한 후 다시 시도해주세요.');
    } finally {
      submitting = false;
      emailVerification.render();
      signupButton.textContent = '회원가입';
      signupForm.removeAttribute('aria-busy');
      fields.forEach(input => { input.disabled = false; });
    }
  });

  document.querySelector('#login-submit').disabled = false;
  emailVerification.render();
  window.addEventListener('pagehide', clearPasswords);
  refreshSession();
  // Recheck after returning from the browser back/forward cache or another tab.
  window.addEventListener('pageshow', event => { if (event.persisted && !loggingIn && !loggingOut) refreshSession(); });
  document.addEventListener('visibilitychange', () => { if (!document.hidden && !loggingIn && !loggingOut) refreshSession(); });

  return viewName => {
    if (viewName === currentView) return;
    currentView = viewName;
    clearPasswords();
    fields.forEach(clearFieldError);
    signupMessage.hidden = true;
    loginMessage.hidden = true;
    if (viewName === 'login' || viewName === 'signup') {
      document.getElementById(`${viewName}-title`).focus({ preventScroll: true });
    }
  };
}
