# KBM Connect — ASVS 5.0 audit checklist and report template

You are a security auditor specializing in OWASP ASVS 5.0 compliance.

Review KBM CONNECT for security vulnerabilities and compliance issues.

SCOPE:
- Application: KBM Connect
- Type: Both (Web / API / Mobile)
- Framework: Expo/React Native (mobile), Vite/React (admin-setup/cadmin), Next.js (live-wall), Supabase Edge Functions (Deno), PostgreSQL (Supabase)
- Database: PostgreSQL / Supabase
- Uses AI: No — no Claude API or other first-party LLM integration in-app (assess AISVS as N/A with evidence; if AI is added later, re-run this section)

SECURITY CATEGORIES TO ASSESS:

1. AUTHENTICATION (OWASP V2)
   - Password policy enforcement (min 12 chars, complexity)
   - Password hashing (Argon2/bcrypt)
   - MFA implementation (TOTP, SMS, email)
   - Session management (expiration, regeneration)
   - Account lockout (after 5 failed attempts)

2. AUTHORIZATION (OWASP V4)
   - Role-Based Access Control (RBAC)
   - Permission checks on every endpoint
   - Least privilege enforced
   - No privilege escalation possible
   - Users cannot access others' data

3. INPUT VALIDATION (OWASP V5)
   - All inputs validated server-side
   - SQL injection prevention (parameterized queries)
   - NoSQL injection prevention
   - XSS prevention (input encoding)
   - Command injection prevention
   - File upload validation (type, size, content)
   - Business logic validation

4. ENCRYPTION (OWASP V6)
   - HTTPS/TLS 1.2+ enforced
   - Encryption at rest for sensitive data
   - Secrets in vault (not hardcoded)
   - HSTS header configured
   - Strong cipher suites

5. ERROR HANDLING & LOGGING (OWASP V7 & V10)
   - Generic error messages to users
   - Detailed errors logged server-side
   - Security events logged (logins, permission changes)
   - No sensitive data in logs
   - Audit trails maintained

6. DATA PROTECTION (OWASP V8)
   - Data inventory documented
   - PII encrypted at rest/transit
   - User rights implemented (view, correct, delete)
   - Data retention policy
   - GDPR/CCPA compliant
   - Backups encrypted

7. API SECURITY (OWASP V13)
   - Authentication required on all endpoints
   - Authorization verified per-request
   - Rate limiting enforced
   - CORS configured correctly
   - API versioning

8. CLOUD & INFRASTRUCTURE (OWASP V14)
   - No public S3 buckets / storage
   - Database not publicly accessible
   - IAM permissions follow least privilege
   - Backup & disaster recovery
   - Secrets in vault

9. DEPENDENCY MANAGEMENT (OWASP V11)
   - No known vulnerabilities
   - Unused packages removed

10. AI SECURITY (if using AI - OWASP AISVS 1.0)
    - No prompt injection vulnerabilities
    - AI data access restricted by permissions
    - Output validated before execution
    - Sensitive operations require human approval
    - AI interactions logged
    - Cost controls enforced

For EACH finding report:
1. SEVERITY (Critical/High/Medium/Low)
2. LOCATION (file:line)
3. ISSUE (what's wrong)
4. IMPACT (what could happen)
5. FIX (code example)

OUTPUT FORMAT:

## KBM Connect - Security Audit Report

### Summary
- Total Issues: X
- Critical: X
- High: X
- Medium: X
- Low: X

### Critical Findings (Must Fix Before Launch)
[List issues]

### High Findings (Should Fix Before Launch)
[List issues]

### Medium Findings (Fix within 30 days)
[List issues]

### Compliance Scorecard
| Category | Score | Status |
|----------|-------|--------|
| Authentication | /5 | ✅/⚠️/❌ |
| Authorization | /5 | ✅/⚠️/❌ |
| Input Validation | /5 | ✅/⚠️/❌ |
| Encryption | /5 | ✅/⚠️/❌ |
| Logging | /5 | ✅/⚠️/❌ |
| Data Protection | /5 | ✅/⚠️/❌ |
| API Security | /5 | ✅/⚠️/❌ |
| Cloud Security | /5 | ✅/⚠️/❌ |
| Dependencies | /5 | ✅/⚠️/❌ |

### Priority Remediation Plan
1. [Fix this first - blocks launch]
2. [Fix this second]
3. [Fix this within 30 days]
