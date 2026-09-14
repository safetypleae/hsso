# HSSO 이메일 인증 설정

회원가입은 이메일 인증을 완료한 뒤 10분 이내에만 가능합니다. 기존 회원의 로그인과 users 테이블 구조는 바뀌지 않습니다.

## 환경변수

서버는 모두 `context.env`에서 읽습니다. 실제 값은 소스, Wrangler 설정, 문서, Git에 기록하지 마세요.

| 이름 | 설정할 내용 |
| --- | --- |
| `RESEND_API_KEY` | Resend에서 발급한 발송 권한 API key |
| `EMAIL_FROM` | Resend에서 인증한 도메인에 속한 발신 주소(필요하면 발신자 표시 이름 포함) |
| `EMAIL_VERIFICATION_SECRET` | 충분히 긴 암호학적 랜덤 secret. 최소 32바이트의 난수에 해당하는 엔트로피를 권장하며 서버는 32자 미만을 거부합니다. 다른 서비스와 공유하지 마세요. |

Cloudflare 대시보드에서 **Workers & Pages → HSSO Pages 프로젝트 → Settings → Variables and Secrets**로 이동하여 **Production / Preview 각각** 설정합니다. key와 verification secret은 Secret 유형으로 저장하고, 발신 주소도 서버 환경변수로 설정합니다. 설정 후 해당 환경을 다시 배포해야 적용됩니다. Preview의 `DB`는 운영과 분리된 테스트 D1에 연결하세요.

Resend에서 도메인 인증/DNS 설정과 발송 권한을 먼저 확인하세요. 브라우저는 Resend를 호출하지 않습니다. 서버는 `POST https://api.resend.com/emails`로 HTML/text 메일을 발송하며, 10초 제한시간과 요청별 idempotency key를 사용합니다.

## 로컬 개발

1. 로컬 전용 `wrangler.jsonc`의 D1 `DB` 바인딩을 사용합니다. 이 파일은 `.git/info/exclude`로 무시하도록 유지합니다.
2. 실제 메일 테스트가 필요할 때만 프로젝트 루트의 `.dev.vars`에 위 세 이름의 값을 직접 설정하세요. **파일 생성 전에 `.dev.vars`와 `.dev.vars.*`를 `.git/info/exclude`에 추가하고 `git check-ignore -v .dev.vars`로 확인하세요.** 이 작업은 실제 secret을 만들거나 저장하지 않습니다.
3. 로컬 DB migration 기록을 먼저 확인합니다.

   ```powershell
   npx wrangler d1 migrations list hsso-db --local
   ```

4. 기존 로컬 0002~0007 적용 상태를 확인하고 누락 migration을 검토한 뒤 실행합니다. `migrations apply`는 0008뿐 아니라 모든 미적용 migration을 실행합니다.

   ```powershell
   npx wrangler d1 migrations apply hsso-db --local
   npx wrangler pages dev .
   ```

5. 실제 값이 없으면 발송 API는 `503 EMAIL_SERVICE_UNAVAILABLE`을 반환합니다. 인증을 우회하거나 개발용 인증번호를 노출하지 않습니다. 자동 테스트는 실제 외부 메일을 보내지 않습니다.

자동 테스트에는 Node.js 24의 내장 SQLite를 사용합니다. 별도 dependency가 필요하지 않습니다.

```powershell
node --test tests/*.test.mjs
# 브라우저 테스트도 실행하려면 설치된 Chrome/Edge 실행 파일의 경로를 지정합니다.
$env:HSSO_BROWSER = '<설치된 브라우저 실행 파일의 절대 경로>'
node --test tests/*.test.mjs
```

## 0008 migration과 운영 배포

`migrations/0008_email_verifications.sql`은 별도 `email_verifications` 테이블과 이메일/IP별 발송 제한 및 만료 정리용 인덱스를 추가합니다. 기존 users 또는 회원 데이터는 변경하지 않습니다.

**Production migration은 사람이 대상 DB·백업·현재 0002~0007 적용 기록과 SQL을 직접 확인한 뒤 별도로 적용해야 합니다. 이 구현 작업에서는 Production 접속·migration·배포를 실행하지 않습니다.**

운영 담당자는 먼저 분리된 Preview D1에 0008과 환경변수를 적용해 실제 메일 수신부터 가입·로그인까지 확인하세요. 이후 운영 DB의 0008을 별도로 적용하고, 세 환경변수를 설정한 다음 코드와 정적 UI를 함께 배포하세요. migration 없이 새 가입 API를 배포하면 회원가입은 안전하게 실패합니다. 이전 페이지가 열려 있는 사용자에게는 새로고침 후 이메일 인증이 필요합니다.

## 동작과 보관 정책

- `/api/auth/email-code`: 정규화한 이메일로 6자리 인증번호 발송. 원문 대신 요청 ID·이메일에 묶인 HMAC-SHA256을 저장합니다.
- `/api/auth/verify-email`: 코드가 맞으면 10분짜리 256비트 랜덤 proof 발급. DB에는 SHA-256 해시만 저장합니다. 코드 검증 성공은 한 번뿐입니다.
- `/api/auth/signup`: `emailVerificationProof`를 서버에서 이메일·만료·소비 여부와 함께 검사합니다. 회원 생성과 proof 소비는 D1 batch 트랜잭션으로 처리합니다.
- 코드 유효시간 10분, 재전송 60초, 이메일당 5회/최근 1시간, IP당 20회/최근 1시간, 요청당 검증 실패 최대 5회입니다. 새 발송 요청은 이전 코드와 proof를 무효화합니다.
- 발송 실패/시간초과도 제한에 포함합니다. 요청이 실제 발송됐는지 불확실해도 무제한 재시도를 허용하지 않습니다. 메일 발송 API 성공은 받은편지함 도착을 보장하지 않으므로 실제 전달·스팸함도 확인하세요.
- IP 원문은 저장하지 않습니다. Cloudflare의 `CF-Connecting-IP`를 HMAC 처리해 제한에 사용하며, 헤더가 없는 로컬 요청은 공통 제한 그룹으로 처리합니다. `X-Forwarded-For`는 신뢰하지 않습니다.
- 인증 이력은 발송 요청이 들어올 때 24시간보다 오래된 행을 정리합니다. 트래픽이 없으면 다음 발송까지 오래된 행이 남을 수 있지만 만료된 코드/proof는 사용할 수 없습니다. 별도 로그에 코드·proof·메일 본문·secret을 기록하지 마세요.
- proof는 브라우저 메모리에만 보관하고 이메일 수정·페이지 종료 시 해제합니다. 새로고침하거나 인증 응답을 받지 못하면 다시 인증해야 합니다.
- secret 교체 시 진행 중인 코드 검증과 IP 제한 키가 달라집니다. 발급 완료 proof는 기존 10분 TTL 동안 유지됩니다. 교체는 운영 담당자가 제한 재설정 영향을 고려해 진행하세요.

공식 문서: [Resend 발송 API](https://resend.com/docs/api-reference/emails/send-email), [Pages 환경변수와 secrets](https://developers.cloudflare.com/pages/functions/bindings/), [D1 batch 트랜잭션](https://developers.cloudflare.com/d1/worker-api/d1-database/).
