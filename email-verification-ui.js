// Signup-only state. Proof stays in memory and is never persisted in browser storage.
export function initEmailVerification(form, signupButton, isSubmitting) {
  const emailInput = form.elements.email;
  const sendButton = document.querySelector('#signup-send-code');
  const codeArea = document.querySelector('#signup-code-area');
  const codeInput = document.querySelector('#signup-code');
  const verifyButton = document.querySelector('#signup-verify-code');
  const message = document.querySelector('#signup-verification-message');
  const timer = document.querySelector('#signup-verification-timer');
  let state = {};
  let version = 0;
  let busy = false;
  let interval;
  const email = () => emailInput.value.trim().toLowerCase();
  const errors = {
    INVALID_EMAIL: '올바른 이메일 주소를 입력해주세요.',
    EMAIL_ALREADY_EXISTS: '이미 가입된 이메일입니다.',
    RESEND_TOO_SOON: '잠시 후 인증번호를 다시 받아주세요.',
    EMAIL_RATE_LIMITED: '이 이메일의 인증번호 발송 횟수를 초과했습니다. 잠시 후 다시 시도해주세요.',
    IP_RATE_LIMITED: '현재 네트워크의 인증번호 발송 횟수를 초과했습니다. 잠시 후 다시 시도해주세요.',
    INVALID_CODE: '인증번호가 올바르지 않습니다. 6자리 숫자를 확인해주세요.',
    CODE_ATTEMPTS_EXCEEDED: '인증번호를 5회 잘못 입력했습니다. 인증번호를 다시 받아주세요.',
    CODE_EXPIRED: '인증번호가 만료되었습니다. 인증번호를 다시 받아주세요.',
    CODE_UNAVAILABLE: '사용할 수 없는 인증번호입니다. 인증번호를 다시 받아주세요.',
    EMAIL_SERVICE_UNAVAILABLE: '이메일 인증을 사용할 수 없습니다. 잠시 후 다시 시도해주세요.',
    EMAIL_SEND_FAILED: '인증번호를 보내지 못했습니다. 잠시 후 다시 시도해주세요.'
  };
  function say(text) { message.textContent = text; }
  function getProof() {
    return state.email === email() && state.proofUntil > Date.now() ? state.proof : null;
  }
  function render() {
    const now = Date.now();
    if (state.proof && state.proofUntil <= now) {
      state.proof = null;
      say('이메일 인증 시간이 만료되었습니다. 인증번호를 다시 받아주세요.');
    } else if (state.requestId && state.codeUntil <= now) {
      state.requestId = null;
      say('인증번호가 만료되었습니다. 인증번호를 다시 받아주세요.');
    }
    const wait = Math.max(0, Math.ceil(((state.resendAt || 0) - now) / 1000));
    const verified = !!getProof();
    signupButton.disabled = isSubmitting() || !verified;
    sendButton.disabled = busy || isSubmitting() || wait > 0 || verified;
    sendButton.textContent = busy && !state.requestId ? '발송 중...' : wait ? `재전송까지 ${wait}초` : state.email ? '인증번호 재전송' : '인증번호 받기';
    verifyButton.disabled = busy || isSubmitting() || !state.requestId || verified;
    codeInput.disabled = busy || isSubmitting() || verified;
    codeArea.hidden = !state.showCode;
    const seconds = Math.max(0, Math.ceil((((verified ? state.proofUntil : state.codeUntil) || 0) - now) / 1000));
    timer.textContent = seconds > 0 ? `${verified ? '회원가입 완료까지' : '인증번호 유효시간'} ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}` : '';
  }
  function reset(text = '') {
    ++version;
    state = {};
    busy = false;
    codeInput.value = '';
    say(text);
    clearInterval(interval);
    render();
  }
  function startTimer() {
    clearInterval(interval);
    interval = setInterval(render, 1000);
  }
  async function post(path, body) {
    const response = await fetch(path, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      credentials: 'omit', mode: 'same-origin', redirect: 'error'
    });
    const data = await response.json().catch(() => null);
    return { response, data };
  }
  emailInput.addEventListener('input', () => reset('이메일 인증을 진행해주세요.'));
  form.addEventListener('reset', () => reset());
  sendButton.addEventListener('click', async () => {
    if (busy || isSubmitting() || getProof() || state.resendAt > Date.now()) return;
    const requestedEmail = email();
    if (!requestedEmail || !emailInput.checkValidity()) { say(errors.INVALID_EMAIL); emailInput.focus(); return; }
    const current = ++version;
    busy = true;
    // Resending invalidates local proof/code even if delivery is uncertain.
    state = { email: requestedEmail };
    codeInput.value = '';
    say('인증번호를 보내고 있습니다.');
    render();
    try {
      const { response, data } = await post('/api/auth/email-code', { email: requestedEmail });
      if (current !== version || requestedEmail !== email()) return;
      if (!response.ok || data?.ok !== true) {
        state.resendAt = Date.now() + Math.max(0, Number(data?.retryAfter) || 0) * 1000;
        say(errors[data?.error] || '인증번호 발송 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.');
      } else {
        state = { email: requestedEmail, requestId: data.requestId, showCode: true,
          codeUntil: Date.now() + data.expiresAt - data.serverTime,
          resendAt: Date.now() + data.resendAvailableAt - data.serverTime };
        say('인증번호를 보냈습니다. 이메일을 확인해주세요. 메일이 보이지 않으면 스팸함도 확인해주세요.');
      }
      startTimer();
    } catch { if (current === version) say('네트워크 연결을 확인한 후 다시 시도해주세요.'); }
    finally {
      if (current === version) { busy = false; render(); if (state.requestId) codeInput.focus(); }
    }
  });
  verifyButton.addEventListener('click', async () => {
    if (busy || isSubmitting() || !state.requestId || state.email !== email() || getProof()) return;
    if (!/^\d{6}$/.test(codeInput.value)) { say(errors.INVALID_CODE); codeInput.focus(); return; }
    const current = version;
    busy = true;
    render();
    try {
      const { response, data } = await post('/api/auth/verify-email', { email: state.email, requestId: state.requestId, code: codeInput.value });
      if (current !== version || state.email !== email()) return;
      if (!response.ok || data?.ok !== true) {
        say(errors[data?.error] || '인증 확인 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.');
        if (['CODE_EXPIRED', 'CODE_UNAVAILABLE', 'CODE_ATTEMPTS_EXCEEDED'].includes(data?.error)) state.requestId = null;
      } else {
        state.proof = data.proof;
        state.proofUntil = Date.now() + data.proofExpiresAt - data.serverTime;
        state.requestId = null;
        codeInput.value = '';
        say('이메일 인증이 완료되었습니다. 남은 시간 안에 회원가입을 완료해주세요.');
      }
    } catch { if (current === version) say('네트워크 연결을 확인한 후 다시 시도해주세요.'); }
    finally { if (current === version) { busy = false; render(); } }
  });
  window.addEventListener('pagehide', () => reset());
  render();
  return { getProof, render, reset };
}
