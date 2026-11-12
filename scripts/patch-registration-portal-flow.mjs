import fs from 'node:fs';

const path = 'admin-setup/src/pages/RegistrationPortal.tsx';
let s = fs.readFileSync(path, 'utf8');
const changes = [];

if (!s.includes('filterRegistrationDetailsQuestions')) {
  s = s.replace(
    /from '\.\.\/lib\/registrationDefaultVisibility';/,
    `from '../lib/registrationDefaultVisibility';\nimport { filterRegistrationDetailsQuestions } from '../lib/portalRegistrationDetailsQuestions';\nimport {\n  contactFieldsComplete,\n  identityFromAnswers,\n  identityFromSubmission,\n  requiredQuestionsComplete,\n} from '../lib/registrationIdentitySync';\nimport type { RegistrationFlowMode } from '../lib/registrantPortal';`,
  );
  changes.push('imports');
}

if (!s.includes('[registrationFlowMode, setRegistrationFlowMode]')) {
  s = s.replace(
    /(const \[registrationOpen, setRegistrationOpen\] = useState\(true\);)/,
    `$1\n  const [registrationFlowMode, setRegistrationFlowMode] = useState<RegistrationFlowMode>('two_step');`,
  );
  changes.push('state');
}

if (!s.includes("select('registration_open, registration_flow_mode')")) {
  s = s.replace(".select('registration_open')", ".select('registration_open, registration_flow_mode')");
  changes.push('select');
}

if (!s.includes('setRegistrationFlowMode(')) {
  s = s.replace(
    /(if \(!cancelled\) setRegistrationOpen\(isOpen\);)/,
    `$1\n        if (!cancelled) {\n          setRegistrationFlowMode(\n            (settingsRow as { registration_flow_mode?: string } | null)?.registration_flow_mode === 'one_step'\n              ? 'one_step'\n              : 'two_step',\n          );\n        }`,
  );
  changes.push('load');
}

{
  const start = s.indexOf('const questionsForDisplay = useMemo(() => {');
  const endMarker = '}, [audience, questions]);';
  const end = s.indexOf(endMarker, start);
  if (start < 0 || end < 0) throw new Error('questionsForDisplay block not found');
  const replacement = `const questionsForDisplay = useMemo(() => {
    const dbAudience = resolveAudience(audience);
    const seenPrompts = new Set<string>();
    const base =
      registrationFlowMode === 'one_step'
        ? filterRegistrationDetailsQuestions(dbAudience, questions)
        : questions.filter((q) => {
            if (q.is_hidden) return false;
            if (!isStage1RegistrationQuestion(dbAudience, q.prompt)) return false;
            return true;
          });
    return base.filter((q) => {
      if (q.is_hidden) return false;
      const promptNorm = q.prompt.trim().toLowerCase();
      if (REGISTRATION_HEADER_FIELD_PROMPTS.has(promptNorm)) return false;
      if (dbAudience === 'vendor' && VENDOR_DEPRECATED_OPERATIONS_PROMPTS.has(promptNorm)) return false;
      if (dbAudience === 'vendor' && promptNorm === 'company logo url') return false;
      if (seenPrompts.has(promptNorm)) return false;
      seenPrompts.add(promptNorm);
      return true;
    });
  }, [audience, questions, registrationFlowMode]);`;
  s = s.slice(0, start) + replacement + s.slice(end + endMarker.length);
  changes.push('questions');
}

if (!s.includes('const profileComplete =')) {
  s = s.replace(
    /(const submissionId = crypto\.randomUUID\(\);)/,
    `const identity = identityFromAnswers(
        questionsForDisplay,
        answers,
        identityFromSubmission({
          first_name: firstName,
          last_name: lastName,
          email,
          company_name: companyName,
          job_title: jobTitle,
        }),
      );
      const profileComplete =
        registrationFlowMode === 'one_step' &&
        status === 'submitted' &&
        contactFieldsComplete(identity) &&
        requiredQuestionsComplete(questionsForDisplay, answers);

      $1`,
  );
  changes.push('profileComplete');
}

if (s.includes('profile_complete: false')) {
  s = s.replace('profile_complete: false', 'profile_complete: profileComplete');
  changes.push('profile_flag');
}
if (s.includes('matching_opt_in: false')) {
  s = s.replace(
    'matching_opt_in: false',
    "matching_opt_in: Boolean(profileComplete && status === 'submitted')",
  );
  changes.push('matching_flag');
}

s = s.replace(
  'When your organizer opens the next registration stage, sign in at ${publicPortalLoginUrl(eventId, portalRole)}.',
  "${registrationFlowMode === 'one_step' ? `Sign in anytime at ${publicPortalLoginUrl(eventId, portalRole)}.` : `When your organizer opens the next registration stage, sign in at ${publicPortalLoginUrl(eventId, portalRole)}.`}",
);
changes.push('success');

fs.writeFileSync(path, s);
console.log('OK:', changes.join(', '));
