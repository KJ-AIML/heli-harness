# Sources — incident

## Incident management

- **Google SRE Book (2016), ch. 14 "Managing Incidents"** — the separation of mitigation from diagnosis, and incident response as a learned discipline rather than heroics.
  https://sre.google/sre-book/managing-incidents/
- **Google SRE Workbook, "Incident Response"** — "what changed?" as the first diagnostic question; most outages follow a change (deploy, config, flag, traffic).
  https://sre.google/workbook/incident-response/
- **PagerDuty Incident Response documentation** — open-sourced operational playbook; severity classification and the recorder/timeline role this skill compresses into a scratch file for solo work.
  https://response.pagerduty.com/

## Rollback over fix-forward

- **Google SRE Book, ch. 13 "Emergency Response"** — reverting to last known good as the default mitigation; the previous release is the best-tested artifact you have.
- **Accelerate / DORA research (Forsgren, Humble, Kim, 2018)** — MTTR as a core delivery metric; teams that restore fast do so by making rollback cheap, not by debugging fast under pressure.

## Blameless postmortems

- **John Allspaw, "Blameless PostMortems and a Just Culture" (Etsy, 2012)** — the founding articulation: naming people teaches the organization to hide details; systems framing surfaces them.
  https://www.etsy.com/codeascraft/blameless-postmortems/
- **Google SRE Book, ch. 15 "Postmortem Culture: Learning from Failure"** — action items with owners as the test of whether a postmortem changed anything.
  https://sre.google/sre-book/postmortem-culture/

## Honest notes

- The big-org playbooks assume an incident *commander* and multiple responders; this skill compresses the roles into one solo/agentic loop. What's deliberately kept: mitigation-first ordering, the timeline, the S3 gate under pressure, blameless framing. What's dropped: role assignment, comms rotations, severity matrices.
- "Most incidents are caused by a change" is an operational rule of thumb from the SRE literature, not a measured universal constant. It earns its place by making the first diagnostic step cheap and usually right.
