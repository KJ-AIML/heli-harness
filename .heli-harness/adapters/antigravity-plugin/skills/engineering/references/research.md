# Research basis

Use these sources as calibration, not as ritual. The skill distills them into local gates.

- Google Engineering Practices, small CLs: small self-contained changes are easier to review, reason about, merge, roll back, and design well. Source: https://google.github.io/eng-practices/review/developer/small-cls.html
- Google Engineering Practices, code review standard: approve changes that improve overall code health; do not accept changes that make code health worse outside emergencies. Source: https://google.github.io/eng-practices/review/reviewer/standard.html
- Google Engineering Practices, what to look for: review every human-written line, use whole-file/system context, and bring qualified reviewers for security, concurrency, privacy, accessibility, and similar specialist risks. Source: https://google.github.io/eng-practices/review/reviewer/looking-for.html
- GitHub Flow: branch, commit, open PR, request feedback, address review comments, merge after approval/checks, then delete the branch. Source: https://docs.github.com/en/get-started/using-github/github-flow
- DORA software delivery metrics: measure delivery as throughput plus instability: lead time, deployment frequency, failed deployment recovery time, change fail rate, and deployment rework rate. Source: https://dora.dev/guides/dora-metrics/
- NIST SSDF SP 800-218: secure software practices should be integrated into each SDLC, reducing vulnerabilities, mitigating impact, and addressing root causes. Source: https://csrc.nist.gov/pubs/sp/800/218/final
- OWASP ASVS: provides a basis for testing web application technical security controls and secure development requirements. Source: https://owasp.org/www-project-application-security-verification-standard/
- Google SRE service best practices: launch risk should consider error budgets; alerts should require action, become tickets, or just be logs; postmortems should focus on process and technology. Source: https://sre.google/sre-book/service-best-practices/
- Google Testing Blog, test sizes: smaller tests avoid network/external-system/sleep/thread coupling and are usually more deterministic; large tests have a different role. Source: https://testing.googleblog.com/2010/12/test-sizes.html
- Google Testing Blog, flaky tests: flaky tests reduce trust in presubmit signals and can hide real failures; track and fix root causes rather than normalizing false signals. Source: https://testing.googleblog.com/2016/05/flaky-tests-at-google-and-how-we.html
- Software Engineering at Google, documentation: documentation should be treated like code, live close to source, have ownership, undergo review, and help future readers understand APIs and decisions. Source: https://abseil.io/resources/swe-book/html/ch10.html
- Fowler, feature toggles: feature toggles separate deployment from release but need lifecycle discipline around categories, ownership, longevity, and dynamism. Source: https://martinfowler.com/articles/feature-toggles.html
