## Summary

Describe the user problem, the change, and its intended boundary.

## Verification

List the commands and browser/deployment checks that actually ran, including
results. Separate local, CI, provider, and Vercel evidence.

```text
npm run docs:check
npm run format:check
npm run lint -- --max-warnings=0
npm run typecheck
npm run test:coverage
npm run test:scripts
npm run build
```

## Checklist

- [ ] The change is focused and does not include unrelated rewrites.
- [ ] I added or updated regression coverage at the observable boundary.
- [ ] I did not commit credentials, access codes, cookies, private content,
      local paths, logs, Vercel linkage, Trellis local state, or generated
      reports.
- [ ] Public behavior and deployment/security boundaries match current code.
- [ ] I updated both `README.md` and `README_CN.md` when their shared product
      information changed.
- [ ] I updated the detailed English source-of-truth document when deployment,
      security, data, or model compatibility changed.
- [ ] I visually reviewed any updated README screenshots for current UI and
      sensitive data.
- [ ] I documented checks that were skipped or could not be verified.
