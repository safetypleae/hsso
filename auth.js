// Account forms only. Navigation stays in the existing application view switcher.
const SIGNUP_ENDPOINT = '/api/auth/signup';
const EMAIL_PATTERN = /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/i;
const LIMITS = { name: 50, companyName: 100, departmentName: 100, position: 50, email: 254, password: 128, passwordConfirm: 128 };
const SERVER_ERROR = '회원가입 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.';

export function initAuthUI(navigate) {
  const loginForm = document.querySelector('#login-form');
  const signupForm = document.querySelector('#signup-form');
  const signupButton = document.querySelector('#signup-submit');
  const signupMessage = document.querySelector('#signup-message');
  const loginMessage = document.querySelector('#login-message');
  const fields = [...signupForm.querySelectorAll('input')];
  let submitting = false;
  let currentView;

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
  }

  fields.forEach(input => input.addEventListener('input', () => {
    clearFieldError(input);
    if (input.name === 'password') clearFieldError(signupForm.elements.passwordConfirm);
    signupMessage.hidden = true;
  }));

  loginForm.addEventListener('submit', event => {
    event.preventDefault();
    loginForm.elements.password.value = '';
    showMessage(loginMessage, '로그인 기능은 다음 단계에서 연결됩니다.');
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
      else if (input.name === 'password' && length < 8) error = '비밀번호는 8자 이상 입력해주세요.';
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
    const payload = {
      email: values.email.toLowerCase(), password: values.password, name: values.name,
      companyName: values.companyName, departmentName: values.departmentName, position: values.position
    };
    submitting = true;
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
        else if (response.status === 400) message = '입력한 정보를 다시 확인해주세요.';
        else if (response.status === 403) message = '요청을 처리할 수 없습니다.';
        showMessage(signupMessage, message);
      }
    } catch {
      showMessage(signupMessage, '네트워크 연결을 확인한 후 다시 시도해주세요.');
    } finally {
      submitting = false;
      signupButton.disabled = false;
      signupButton.textContent = '회원가입';
      signupForm.removeAttribute('aria-busy');
      fields.forEach(input => { input.disabled = false; });
    }
  });

  document.querySelector('#login-submit').disabled = false;
  signupButton.disabled = false;
  window.addEventListener('pagehide', clearPasswords);

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
